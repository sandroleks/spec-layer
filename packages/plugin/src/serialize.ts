import type { SerializedNode, PropertyDefinition, TokenRef, LayoutInfo } from '@spec-layer/extractor';

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

/** Injected resolver — keeps serialize.ts free of Figma globals so it runs under vitest. */
export interface NodeResolver {
  variableName(id: string): Promise<string | null>;
  styleName(id: string): Promise<string | null>;
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
  effects?: Array<{ type: string }>;
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
      const token = await resolver.variableName(entry.id);
      if (token && !bindings.some((b) => b.property === property && b.token === token)) {
        bindings.push({ property, token });
      }
    }
  }

  // --- Resolve style ids ---
  if (node.fillStyleId) {
    const token = await resolver.styleName(node.fillStyleId);
    if (token) bindings.push({ property: 'fills', token });
  }
  if (node.strokeStyleId) {
    const token = await resolver.styleName(node.strokeStyleId);
    if (token) bindings.push({ property: 'strokes', token });
  }
  if (typeof node.textStyleId === 'string' && node.textStyleId) {
    const token = await resolver.styleName(node.textStyleId);
    if (token) bindings.push({ property: 'typography', token });
  }
  if (typeof node.effectStyleId === 'string' && node.effectStyleId) {
    const token = await resolver.styleName(node.effectStyleId);
    if (token) bindings.push({ property: 'effects', token });
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
  // That value is written verbatim into a gap string ("hardcoded opacity (...)")
  // which IS covered by specContentHash, so leaving it unrounded puts float noise
  // in front of the reader and in the drift baseline. Four decimals is well past
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
