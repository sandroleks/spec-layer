import type { SerializedNode, PropertyDefinition, TokenRef, RefIdentity, LayoutInfo, RawEffect } from '@spec-layer/extractor';

/**
 * Resolve the reference name/key for an instance's main component. When the main
 * component is a variant inside a component set, the set carries the real name/key,
 * so prefer it over the variant's combo name (e.g. "Size=Large, State=Default").
 */
export function mainComponentRef(
  mc: { name: string; key: string; parent: { type: string; name: string; key: string } | null },
): { name: string; key: string } {
  if (mc.parent && mc.parent.type === 'COMPONENT_SET') {
    return { name: mc.parent.name, key: mc.parent.key };
  }
  return { name: mc.name, key: mc.key };
}

/** A resolved variable as a reference identity. `collectionId` is spread in only
 *  when Figma gave one, so an absent collection is an absent key. */
export function variableRef(v: ResolvedVariable): RefIdentity {
  return {
    id: v.id, name: v.name, kind: 'variable', remote: v.remote,
    ...(v.collectionId ? { collectionId: v.collectionId } : {}),
  };
}

/** A resolved style as a reference identity, or null for a GRID style. No node
 *  property this file reads can produce a grid binding, so a grid style here
 *  means the id was not what it claimed and dropping it is the honest result. */
export function styleRef(s: ResolvedStyle): RefIdentity | null {
  return s.kind === 'grid-style'
    ? null
    : { id: s.id, name: s.name, kind: s.kind, remote: s.remote };
}

/** What Figma says about a variable a node binds. Ids and `remote` come from the
 *  API (`Variable.remote`), never from a failed lookup somewhere downstream. */
export interface ResolvedVariable {
  id: string;
  name: string;
  remote: boolean;
  collectionId: string;
}

/**
 * What Figma says about a style a node binds.
 *
 * `kind` maps from `BaseStyle.type`, which is a closed four-value union
 * (`PAINT | TEXT | EFFECT | GRID`). Asking the style is the point: the property
 * a style id was read from is a strong hint and not an answer, and an `effects`
 * binding in particular is the one the property map at tokens.ts:100 records as
 * unresolvable without it.
 */
export interface ResolvedStyle {
  id: string;
  name: string;
  remote: boolean;
  kind: 'paint-style' | 'text-style' | 'effect-style' | 'grid-style';
}

/** Injected resolver — keeps serialize.ts free of Figma globals so it runs under vitest. */
export interface NodeResolver {
  variable(id: string): Promise<ResolvedVariable | null>;
  style(id: string): Promise<ResolvedStyle | null>;
  mainComponent(node: unknown): Promise<{ name: string; key: string } | null>;
}

// Structurally-typed shapes for what we read off the raw Figma node.
interface RawBoundVar { id: string }
type BoundVarValue = RawBoundVar | RawBoundVar[];
interface RawNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  key?: string;
  fills?: Array<{ type: string; color?: { r: number; g: number; b: number }; opacity?: number }>;
  fillStyleId?: string;
  strokes?: Array<{ type: string; color?: { r: number; g: number; b: number }; opacity?: number }>;
  strokeStyleId?: string;
  // The whole effect object, not just its type. Reading only `.length` is what
  // made a shadow with a variable-bound colour and hardcoded radius, offset and
  // spread count as fully bound while silently dropping every geometry value.
  effects?: RawEffect[];
  opacity?: number;
  textStyleId?: string | symbol;
  effectStyleId?: string | symbol;
  // Figma returns figma.mixed (a symbol) for these when a TEXT node's range
  // isn't uniform. Typing the symbol keeps callers from smuggling it through
  // as a bogus number/object — every read site must check `typeof` first.
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
  children?: RawNode[];
}

/**
 * Figma exposes weight as a style NAME, not a number. Map the common ladder;
 * anything unrecognized falls back to 400, which yields the stricter AA
 * threshold and so cannot produce a false pass.
 */
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

  // --- Resolve boundVariables ---
  const bv = node.boundVariables ?? {};
  for (const [property, value] of Object.entries(bv)) {
    // Resolve ALL entries of array-valued variables.
    const entries: RawBoundVar[] = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (!entry?.id) continue;
      const v = await resolver.variable(entry.id);
      // Deduped on the resolved ID, not on the name: two ids resolving to one
      // name are two bindings, which is exactly what this change stops losing.
      if (v && !bindings.some((b) => b.property === property && b.id === v.id)) {
        bindings.push({ property, ...variableRef(v) });
      }
    }
  }

  // --- Resolve style ids ---
  // The property each id was read from decides the BINDING property; the style
  // itself decides what kind of thing it is. Those are two different questions
  // and this task stops answering the second by guessing at the first.
  const styleBinding = async (id: string, property: string): Promise<void> => {
    const s = await resolver.style(id);
    const ref = s ? styleRef(s) : null;
    if (ref) bindings.push({ property, ...ref });
  };
  if (node.fillStyleId) await styleBinding(node.fillStyleId, 'fills');
  if (node.strokeStyleId) await styleBinding(node.strokeStyleId, 'strokes');
  if (typeof node.textStyleId === 'string' && node.textStyleId) {
    await styleBinding(node.textStyleId, 'typography');
  }
  if (typeof node.effectStyleId === 'string' && node.effectStyleId) {
    await styleBinding(node.effectStyleId, 'effects');
  }

  // --- Unbound paints, effects and opacity ---
  const to2 = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
  const hex = (c: { r: number; g: number; b: number }) => `#${to2(c.r)}${to2(c.g)}${to2(c.b)}`;

  const fills = node.fills ?? [];
  const hasSolidFill = fills.some((f) => f.type === 'SOLID');
  const fillsBound = 'fills' in bv || Boolean(node.fillStyleId);
  const hasUnboundPaint = hasSolidFill && !fillsBound ? true : undefined;
  const solidFill = hasUnboundPaint ? fills.find((f) => f.type === 'SOLID' && f.color) : undefined;
  const unboundFill = solidFill?.color ? hex(solidFill.color) : undefined;

  // Gradients and images can't bind to a colour variable, only to a style, so a
  // style id is the only thing that makes them intentional.
  const hasGradient = fills.some((f) => f.type.startsWith('GRADIENT_') || f.type === 'IMAGE');
  const hasUnboundGradient = hasGradient && !node.fillStyleId ? true : undefined;

  const strokes = node.strokes ?? [];
  const hasSolidStroke = strokes.some((s) => s.type === 'SOLID');
  const strokesBound = 'strokes' in bv || Boolean(node.strokeStyleId);
  const hasUnboundStroke = hasSolidStroke && !strokesBound ? true : undefined;
  const solidStroke = hasUnboundStroke ? strokes.find((s) => s.type === 'SOLID' && s.color) : undefined;
  const unboundStroke = solidStroke?.color ? hex(solidStroke.color) : undefined;

  const hasEffects = (node.effects ?? []).length > 0;
  const effectsBound = 'effects' in bv || (typeof node.effectStyleId === 'string' && Boolean(node.effectStyleId));
  const hasUnboundEffect = hasEffects && !effectsBound ? true : undefined;

  // Figma's opacity is float32-backed, so 30% comes back as 0.30000001192092896.
  // That value is written verbatim into the gap's `value` field, which IS
  // covered by specContentHash, so leaving it unrounded puts float noise in
  // front of the reader and in the drift baseline. Four decimals is well past
  // anything Figma's own percent field can express.
  const opacity = typeof node.opacity === 'number' && node.opacity !== 1
    ? Math.round(node.opacity * 10000) / 10000
    : undefined;

  // --- Text metrics (TEXT nodes only) ---
  // `fontSize`/`fontName` come back as figma.mixed (a symbol) when a TEXT node's
  // range isn't uniform; the typeof checks below keep that symbol from slipping
  // through as a bogus number or object.
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

  // --- componentPropertyDefinitions ---
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
    // Figma throws on variant children — silently skip.
  }

  // --- mainComponent (INSTANCE nodes) ---
  let mainComponent: { name: string; key: string } | undefined;
  if (node.type === 'INSTANCE') {
    const mc = await resolver.mainComponent(node);
    if (mc) mainComponent = mc;
  }

  // --- layout (auto-layout values + corner radius; only positive numbers) ---
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

  // --- Recurse children ---
  const children = node.children
    ? await Promise.all(node.children.map(c => serializeNode(c, resolver)))
    : undefined;

  const result: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible ?? true,
    ...(node.key !== undefined ? { key: node.key } : {}),
    ...(propertyDefinitions ? { propertyDefinitions } : {}),
    ...(bindings.length > 0 ? { bindings } : {}),
    ...(hasUnboundPaint ? { hasUnboundPaint } : {}),
    ...(unboundFill ? { unboundFill } : {}),
    ...(hasUnboundStroke ? { hasUnboundStroke } : {}),
    ...(unboundStroke ? { unboundStroke } : {}),
    ...(hasUnboundGradient ? { hasUnboundGradient } : {}),
    ...(hasUnboundEffect ? { hasUnboundEffect } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(mainComponent ? { mainComponent } : {}),
    ...(layout ? { layout } : {}),
    ...(text ? { text } : {}),
    ...(children ? { children } : {}),
  };

  return result;
}
