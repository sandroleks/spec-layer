import type { SerializedNode } from './tree';
import type { ComponentProp } from './props';
import { cleanPropName, siblingPartNames } from './naming';

/** One layer of a slot's default content: its part name, its Figma type, and
 *  for an instance the component it shows. */
export interface SlotContentItem {
  part: string;
  type: string;
  component?: string;
}

/** How a layer of default content is named where it is drawn: the component
 *  an instance shows, else its part name. */
export const slotContentLabel = (item: SlotContentItem): string => item.component ?? item.part;

/** A slot's child limits in words, the same on canvas and in a change list:
 *  "exactly 1 item", "1 to 3 items", "at least 1 item", "at most 3 items",
 *  or null when Figma states no limit. */
export function slotLimitsText(min: number | undefined, max: number | undefined): string | null {
  const items = (n: number): string => `${n} ${n === 1 ? 'item' : 'items'}`;
  if (min !== undefined && max !== undefined) return min === max ? `exactly ${items(min)}` : `${min} to ${items(max)}`;
  if (min !== undefined) return `at least ${items(min)}`;
  if (max !== undefined) return `at most ${items(max)}`;
  return null;
}

/** A property fact the extractor cannot document as asked. Reported by
 *  validate(); no canvas draws it, so no hash covers it. */
export type PropertyIssue =
  | { kind: 'unresolved-slot-content'; property: string; key: string }
  | { kind: 'unlinked-slot'; part: string; slotProperty: string | null }
  | { kind: 'unsupported-property-type'; property: string; figmaType: string };

export interface SeparatedSlots {
  /** The tree with every own slot emptied. */
  root: SerializedNode;
  /** By slot node id: the direct, visible children it held. */
  defaultContent: ReadonlyMap<string, SlotContentItem[]>;
  issues: PropertyIssue[];
}

/** A slot node: Figma's SLOT type. A frame bound to a SLOT property becomes
 *  one (probed 2026-10-04), so the reference is checked as well. */
export const isSlot = (node: SerializedNode): boolean =>
  node.type === 'SLOT' || node.slotProperty !== undefined;

/**
 * Empties the component's own slots, so default content is an example of what
 * goes in and never a part, a related component, a token rule or an unbound
 * value. Every walk reads the returned tree, so they all agree without each
 * learning about slots.
 *
 * Own means no INSTANCE between the slot and the root. A slot inside a nested
 * instance belongs to that instance's component, and content a designer put
 * there is fixed content of this one, so it stays.
 *
 * A component without slots comes back as the same object, node for node.
 */
/** The root's SLOT property keys, raw (with the `#id` suffix). */
export function slotPropertyKeys(root: SerializedNode): Set<string> {
  return new Set(
    Object.entries(root.propertyDefinitions ?? {})
      .filter(([, def]) => def.type === 'SLOT')
      .map(([key]) => key),
  );
}

export function separateSlotContent(root: SerializedNode): SeparatedSlots {
  const defaultContent = new Map<string, SlotContentItem[]>();
  const slotDefinitions = slotPropertyKeys(root);
  const unlinked = new Map<string, PropertyIssue>();

  function visit(node: SerializedNode): SerializedNode {
    if (node.type === 'INSTANCE') return node;
    if (isSlot(node)) {
      const kids = node.children ?? [];
      const names = siblingPartNames(kids);
      defaultContent.set(node.id, kids.filter((c) => c.visible).map((c) => ({
        part: names.get(c)!,
        type: c.type,
        ...(c.type === 'INSTANCE' && c.mainComponent ? { component: c.mainComponent.name } : {}),
      })));
      if (node.slotProperty === undefined || !slotDefinitions.has(node.slotProperty)) {
        // Each variant has its own slot node for one property: report once.
        const issue: PropertyIssue = { kind: 'unlinked-slot', part: node.name, slotProperty: node.slotProperty ?? null };
        unlinked.set(JSON.stringify([node.name, node.slotProperty ?? null]), issue);
      }
      if (!node.children) return node;
      const { children: _dropped, ...emptied } = node;
      return emptied;
    }
    if (!node.children) return node;
    const children = node.children.map(visit);
    return children.every((c, i) => c === node.children![i]) ? node : { ...node, children };
  }

  const separated = visit(root);
  const issues: PropertyIssue[] = [];
  for (const [key, def] of Object.entries(root.propertyDefinitions ?? {})) {
    for (const p of def.slot?.preferred ?? []) {
      if (p.name === null) issues.push({ kind: 'unresolved-slot-content', property: cleanPropName(key), key: p.key });
    }
  }
  issues.push(...unlinked.values());
  return { root: separated, defaultContent, issues };
}

/**
 * Each SLOT property's default content in one variant, by cleaned property
 * name: what its own slot there held. A property with no slot in that variant
 * is absent, never an empty slot. Only own slots count, as above.
 */
export function slotDefaultsByProperty(
  root: SerializedNode,
  variant: SerializedNode,
  defaultContent: ReadonlyMap<string, SlotContentItem[]>,
): Map<string, SlotContentItem[]> {
  const out = new Map<string, SlotContentItem[]>();
  // A slot linked to a property the component no longer defines is unlinked
  // (reported above), so it never answers for a defined one.
  const defined = slotPropertyKeys(root);
  const visit = (node: SerializedNode): void => {
    if (node.type === 'INSTANCE') return;
    if (isSlot(node) && node.slotProperty !== undefined && defined.has(node.slotProperty)) {
      const name = cleanPropName(node.slotProperty);
      if (!out.has(name)) out.set(name, defaultContent.get(node.id) ?? []);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(variant);
  return out;
}

/**
 * The slot facts a Properties row draws, from either source: the extracted
 * prop on canvas (`slotView`) or the artifact's `api.slots` entry in
 * Markdown, so both print the same words.
 */
export interface SlotView {
  /** Preferred components by name, in Figma's order; null where unnamed. */
  preferred: (string | null)[];
  preferredOnly?: boolean;
  minChildren?: number;
  maxChildren?: number;
  emptyByDefault?: boolean;
  /** Absent when the default variant has no slot for the property. */
  defaultContent?: SlotContentItem[];
}

export function slotView(prop: ComponentProp): SlotView {
  const s = prop.slot;
  return {
    preferred: (s?.preferred ?? []).map((p) => p.name),
    ...(s?.preferredOnly ? { preferredOnly: true } : {}),
    ...(s?.minChildren !== undefined ? { minChildren: s.minChildren } : {}),
    ...(s?.maxChildren !== undefined ? { maxChildren: s.maxChildren } : {}),
    ...(s?.emptyByDefault ? { emptyByDefault: true } : {}),
    ...(prop.defaultContent ? { defaultContent: prop.defaultContent } : {}),
  };
}

/**
 * A slot's Values cell: preferred components by name, an unnamed key counted
 * and never named, "only these" when Figma allows nothing else, then the
 * limits. Empty when Figma states none of these.
 */
export function slotValuesText(view: SlotView): string {
  const named = view.preferred.filter((name): name is string => name !== null);
  const missing = view.preferred.length - named.length;
  const listed = [...named, ...(missing > 0 ? [`${missing} ${missing === 1 ? 'component' : 'components'} not found`] : [])];
  const preferred = listed.length > 0
    ? `${listed.join(' · ')}${view.preferredOnly ? ', only these' : ''}`
    : '';
  return [preferred, slotLimitsText(view.minChildren, view.maxChildren) ?? ''].filter((t) => t !== '').join('; ');
}

/**
 * A slot's Default cell: what the default variant's slot holds, or Empty.
 * Figma's display-empty-by-default setting does not empty the component
 * (probed 2026-10-04), so it is named beside the content, not instead of it.
 * Blank when the default variant has no slot for the property.
 */
export function slotDefaultText(view: SlotView): string {
  const emptyByDefault = view.emptyByDefault === true;
  if (!view.defaultContent) return emptyByDefault ? 'Display empty by default' : '';
  const note = emptyByDefault ? ' (display empty by default)' : '';
  const content = view.defaultContent.length > 0
    ? view.defaultContent.map(slotContentLabel).join(' · ')
    : 'Empty';
  return `${content}${note}`;
}
