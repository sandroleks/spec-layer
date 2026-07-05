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
  fills?: Array<{ type: string; color?: { r: number; g: number; b: number } }>;
  fillStyleId?: string;
  strokeStyleId?: string;
  textStyleId?: string | symbol;
  effectStyleId?: string | symbol;
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

  // --- hasUnboundPaint ---
  const hasSolid = Array.isArray(node.fills) && node.fills.some(f => f.type === 'SOLID');
  const fillsBound = 'fills' in bv;
  const hasStyleId = Boolean(node.fillStyleId);
  const hasUnboundPaint = hasSolid && !fillsBound && !hasStyleId ? true : undefined;
  let unboundFill: string | undefined;
  if (hasUnboundPaint) {
    const solid = (node.fills ?? []).find((f) => f.type === 'SOLID' && f.color);
    if (solid?.color) {
      const to2 = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
      unboundFill = `#${to2(solid.color.r)}${to2(solid.color.g)}${to2(solid.color.b)}`;
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
    ...(mainComponent ? { mainComponent } : {}),
    ...(layout ? { layout } : {}),
    ...(children ? { children } : {}),
  };

  return result;
}
