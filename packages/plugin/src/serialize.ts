import type {
  SerializedNode, PropertyDefinition, TokenRef, RefIdentity, LayoutInfo, RawEffect,
  EffectLayer, EffectBindings,
} from '@spec-layer/extractor';
import { effectLayerOf } from '@spec-layer/extractor';

/** VariableBindableEffectField. Shadows bind all five, blurs only `radius`,
 *  others none; a field an effect cannot bind simply has no entry. */
const EFFECT_FIELDS = ['color', 'radius', 'spread', 'offsetX', 'offsetY'] as const;

/** An instance's main component name and key. For a variant, the set's, not
 *  the combo name ("Size=Large, State=Default"). */
export function mainComponentRef(
  mc: { name: string; key: string; parent: { type: string; name: string; key: string } | null },
): { name: string; key: string } {
  if (mc.parent && mc.parent.type === 'COMPONENT_SET') {
    return { name: mc.parent.name, key: mc.parent.key };
  }
  return { name: mc.name, key: mc.key };
}

/** `collectionId` only when Figma gave one: absent is an absent key. */
export function variableRef(v: ResolvedVariable): RefIdentity {
  return {
    id: v.id, name: v.name, kind: 'variable', remote: v.remote,
    ...(v.collectionId ? { collectionId: v.collectionId } : {}),
  };
}

/** Null for a GRID style: no property read here binds one, so the id was not
 *  what it claimed and dropping it is honest. */
export function styleRef(s: ResolvedStyle): RefIdentity | null {
  return s.kind === 'grid-style'
    ? null
    : { id: s.id, name: s.name, kind: s.kind, remote: s.remote };
}

/** Ids and `remote` come from the API (`Variable.remote`), never from a failed
 *  lookup downstream. */
export interface ResolvedVariable {
  id: string;
  name: string;
  remote: boolean;
  collectionId: string;
}

/**
 * `kind` maps from `BaseStyle.type` (`PAINT | TEXT | EFFECT | GRID`). The
 * property an id was read from is a hint, not an answer; tokens.ts:100 records
 * an `effects` binding as unresolvable without it.
 */
export interface ResolvedStyle {
  id: string;
  name: string;
  remote: boolean;
  kind: 'paint-style' | 'text-style' | 'effect-style' | 'grid-style';
}

/** Injected, so this file has no Figma globals and runs under vitest. */
export interface NodeResolver {
  variable(id: string): Promise<ResolvedVariable | null>;
  style(id: string): Promise<ResolvedStyle | null>;
  mainComponent(node: unknown): Promise<{ name: string; key: string } | null>;
}

interface RawBoundVar { id: string }
type BoundVarValue = RawBoundVar | RawBoundVar[];
interface RawNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  key?: string;
  description?: string;
  documentationLinks?: Array<{ uri?: string }>;
  // `| symbol`: Figma returns figma.mixed from these four when a TEXT node's
  // ranges are not uniform. Without it tsc lets `fills.some(...)` throw.
  fills?: Array<{ type: string; color?: { r: number; g: number; b: number }; opacity?: number }> | symbol;
  fillStyleId?: string | symbol;
  strokes?: Array<{ type: string; color?: { r: number; g: number; b: number }; opacity?: number }> | symbol;
  strokeStyleId?: string | symbol;
  // The whole effect, so hardcoded geometry beside a bound colour is not lost.
  effects?: RawEffect[];
  opacity?: number;
  textStyleId?: string | symbol;
  effectStyleId?: string | symbol;
  // figma.mixed on non-uniform TEXT ranges: every read must check `typeof`.
  fontSize?: number | symbol;
  fontName?: { family: string; style: string } | symbol;
  layoutMode?: string;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  cornerRadius?: number | symbol;
  boundVariables?: Record<string, BoundVarValue>;
  componentPropertyDefinitions?: Record<string, {
    type: string;
    defaultValue?: string | boolean;
    variantOptions?: string[];
  }>;
  componentPropertyReferences?: {
    visible?: string;
    characters?: string;
    mainComponent?: string;
  } | null;
  children?: RawNode[];
}

/** Figma gives weight as a style name. Unknown falls back to 400, the stricter
 *  AA threshold, so it cannot produce a false pass. */
const WEIGHTS: Record<string, number> = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300,
  regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600,
  bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900,
};

function fontWeightOf(style: string): number {
  const key = style.toLowerCase().replace(/\s|-|italic|oblique/g, '');
  return WEIGHTS[key] ?? 400;
}

export async function serializeNode(node: RawNode, resolver: NodeResolver): Promise<SerializedNode> {
  const bindings: TokenRef[] = [];

  const bv = node.boundVariables ?? {};
  for (const [property, value] of Object.entries(bv)) {
    const entries: RawBoundVar[] = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (!entry?.id) continue;
      const v = await resolver.variable(entry.id);
      // Deduped on id, not name: two ids with one name are two bindings.
      if (v && !bindings.some((b) => b.property === property && b.id === v.id)) {
        bindings.push({ property, ...variableRef(v) });
      }
    }
  }

  // The source property decides the binding property; the style itself decides
  // its kind, never guessed from the property.
  const styleBinding = async (id: string, property: string): Promise<void> => {
    const s = await resolver.style(id);
    const ref = s ? styleRef(s) : null;
    if (ref) bindings.push({ property, ...ref });
  };
  // A lookup id must be a string: figma.mixed would ask about an id that does
  // not exist. "Is it styled" stays raw truthiness: a mixed id means some range
  // is style-bound, and narrowing it would flip hasUnboundPaint, a gap inside
  // specContentHash, so existing documents would falsely report an update.
  const fillStyleId = typeof node.fillStyleId === 'string' ? node.fillStyleId : '';
  const strokeStyleId = typeof node.strokeStyleId === 'string' ? node.strokeStyleId : '';
  const fillStyled = Boolean(node.fillStyleId);
  const strokeStyled = Boolean(node.strokeStyleId);
  if (fillStyleId) await styleBinding(fillStyleId, 'fills');
  if (strokeStyleId) await styleBinding(strokeStyleId, 'strokes');
  if (typeof node.textStyleId === 'string' && node.textStyleId) {
    await styleBinding(node.textStyleId, 'typography');
  }
  if (typeof node.effectStyleId === 'string' && node.effectStyleId) {
    await styleBinding(node.effectStyleId, 'effects');
  }

  const to2 = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
  const hex = (c: { r: number; g: number; b: number }) => `#${to2(c.r)}${to2(c.g)}${to2(c.b)}`;

  // Array.isArray, not `?? []`: figma.mixed is a symbol. Mixed fills get no
  // verdict, since a gap or hex for them would be a value nobody read.
  const fills = Array.isArray(node.fills) ? node.fills : [];
  const hasSolidFill = fills.some((f) => f.type === 'SOLID');
  const fillsBound = 'fills' in bv || fillStyled;
  const hasUnboundPaint = hasSolidFill && !fillsBound ? true : undefined;
  const solidFill = hasUnboundPaint ? fills.find((f) => f.type === 'SOLID' && f.color) : undefined;
  const unboundFill = solidFill?.color ? hex(solidFill.color) : undefined;

  // Gradients and images bind only to a style.
  const hasGradient = fills.some((f) => f.type.startsWith('GRADIENT_') || f.type === 'IMAGE');
  const hasUnboundGradient = hasGradient && !fillStyled ? true : undefined;

  const strokes = Array.isArray(node.strokes) ? node.strokes : [];
  const hasSolidStroke = strokes.some((s) => s.type === 'SOLID');
  const strokesBound = 'strokes' in bv || strokeStyled;
  const hasUnboundStroke = hasSolidStroke && !strokesBound ? true : undefined;
  const solidStroke = hasUnboundStroke ? strokes.find((s) => s.type === 'SOLID' && s.color) : undefined;
  const unboundStroke = solidStroke?.color ? hex(solidStroke.color) : undefined;

  const rawEffects = node.effects ?? [];
  const hasEffects = rawEffects.length > 0;
  const effectStyled = typeof node.effectStyleId === 'string' && Boolean(node.effectStyleId);
  // Keep when this fires: extractGaps keys the `effects` gap on it, and gaps
  // are inside specContentHash, so a change moves every drift baseline.
  const effectsBound = 'effects' in bv || effectStyled;
  const hasUnboundEffect = hasEffects && !effectsBound ? true : undefined;

  // Inlined whenever there is no effect style (a style points at the
  // foundation). Field bindings come from each effect's own boundVariables:
  // node-level boundVariables.effects has no field or layer identity.
  let effects: EffectLayer[] | undefined;
  if (hasEffects && !effectStyled) {
    effects = [];
    for (const raw of rawEffects) {
      const bv2 = (raw as { boundVariables?: Record<string, { id?: string }> }).boundVariables ?? {};
      const bindings: EffectBindings = {};
      for (const field of EFFECT_FIELDS) {
        const id = bv2[field]?.id;
        if (!id) continue;
        const v = await resolver.variable(id);
        if (v) bindings[field] = variableRef(v);
      }
      try {
        effects.push(effectLayerOf(raw, bindings));
      } catch {
        // Unmodelled, like an unknown `type`: a throw would reject the whole
        // Promise.all tree for one bad layer.
        effects.push({ type: 'unknown', figma_type: raw.type });
      }
    }
  }

  // Float32: 30% reads 0.30000001192092896, and the value lands in a gap that
  // specContentHash covers. Four decimals exceed Figma's percent field.
  const opacity = typeof node.opacity === 'number' && node.opacity !== 1
    ? Math.round(node.opacity * 10000) / 10000
    : undefined;

  // The typeof checks keep figma.mixed out.
  let text: { fontSize?: number; fontWeight?: number } | undefined;
  if (node.type === 'TEXT') {
    const size = typeof node.fontSize === 'number' ? node.fontSize : undefined;
    const name = node.fontName;
    const weight = name && typeof name === 'object' && 'style' in name
      ? fontWeightOf((name as { style: string }).style)
      : undefined;
    if (size !== undefined || weight !== undefined) {
      text = { ...(size !== undefined ? { fontSize: size } : {}), ...(weight !== undefined ? { fontWeight: weight } : {}) };
    }
  }

  let propertyDefinitions: Record<string, PropertyDefinition> | undefined;
  try {
    if (node.componentPropertyDefinitions) {
      const defs: Record<string, PropertyDefinition> = {};
      for (const [k, v] of Object.entries(node.componentPropertyDefinitions)) {
        defs[k] = {
          type: v.type as PropertyDefinition['type'],
          ...(v.defaultValue !== undefined ? { defaultValue: v.defaultValue } : {}),
          ...(v.variantOptions ? { variantOptions: v.variantOptions } : {}),
        };
      }
      if (Object.keys(defs).length > 0) propertyDefinitions = defs;
    }
  } catch {
    // Figma throws on variant children.
  }

  let mainComponent: { name: string; key: string } | undefined;
  if (node.type === 'INSTANCE') {
    const mc = await resolver.mainComponent(node);
    if (mc) mainComponent = mc;
  }

  // Positive numbers only.
  let layout: LayoutInfo | undefined;
  if (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL') {
    layout = { mode: node.layoutMode };
    const fields = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing'] as const;
    for (const k of fields) {
      const v = node[k];
      if (typeof v === 'number' && v > 0) layout[k] = v;
    }
  }
  if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    layout = { ...(layout ?? {}), cornerRadius: node.cornerRadius };
  }

  // Null outside a component; wrapped in case a node type rejects the read.
  let visibleProperty: string | undefined;
  try {
    const ref = node.componentPropertyReferences?.visible;
    if (typeof ref === 'string' && ref.length > 0) visibleProperty = ref;
  } catch {
    // Not a property-bearing node.
  }

  // Component roots only; findComponent() already resolves a variant to its set.
  const description = (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET')
    && typeof node.description === 'string' && node.description.trim() !== ''
    ? node.description.trim()
    : undefined;
  const documentationLinks = (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET')
    && Array.isArray(node.documentationLinks)
    ? node.documentationLinks
        .map((l) => (typeof l?.uri === 'string' ? l.uri.trim() : ''))
        .filter((uri) => uri !== '')
    : [];

  const children = node.children
    ? await Promise.all(node.children.map(c => serializeNode(c, resolver)))
    : undefined;

  const result: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible ?? true,
    ...(visibleProperty !== undefined ? { visibleProperty } : {}),
    ...(node.key !== undefined ? { key: node.key } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(documentationLinks.length > 0 ? { documentationLinks } : {}),
    ...(propertyDefinitions ? { propertyDefinitions } : {}),
    ...(bindings.length > 0 ? { bindings } : {}),
    ...(hasUnboundPaint ? { hasUnboundPaint } : {}),
    ...(unboundFill ? { unboundFill } : {}),
    ...(hasUnboundStroke ? { hasUnboundStroke } : {}),
    ...(unboundStroke ? { unboundStroke } : {}),
    ...(hasUnboundGradient ? { hasUnboundGradient } : {}),
    ...(hasUnboundEffect ? { hasUnboundEffect } : {}),
    ...(effects && effects.length > 0 ? { effects } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(mainComponent ? { mainComponent } : {}),
    ...(layout ? { layout } : {}),
    ...(text ? { text } : {}),
    ...(children ? { children } : {}),
  };

  return result;
}
