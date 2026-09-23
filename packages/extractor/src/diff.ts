/**
 * diff.ts: the semantic diff behind the Library's "Show changes".
 *
 * Pure and Figma-free. Two layers: a keyed-list core (diffKeyed) that the later
 * `spec-layer diff` command reuses with its own v5 keys, and group builders that
 * turn two hash projections into the ChangeGroup[] a Library row renders.
 *
 * The diff input is the hash input. componentChangeGroups takes two
 * SpecHashProjection values and foundationChangeGroups two FoundationUnitContent
 * values: exactly the objects specContentHash and foundationContentHash hash.
 * Comparing anything else could disagree with the "Update available" badge.
 */
import { canonicalEqual, type SpecHashProjection } from './hash';
import type {
  FoundationGlyph, FoundationRow, FoundationTextMetrics, FoundationUnitContent,
  FoundationValue, FoundationVariableRow,
} from './foundation';
import { compareCodeUnits } from './v5/diagnostics';
import { matchesVariant } from './resolve';

export interface ListDiff<T> {
  added: T[];
  removed: T[];
  changed: { before: T; after: T }[];
  /** Same key sequence set and equal values, different order. */
  reordered: boolean;
}

/**
 * Diff two lists by identity key.
 *
 * Output order follows the `after` list for added and changed and the `before`
 * list for removed, so a caller never sorts and no locale is involved.
 * Duplicate keys within one list are paired positionally; surplus items are
 * reported as added or removed, never silently merged. `equal` defaults to
 * canonical equality, so "changed" means "would hash differently".
 */
export function diffKeyed<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
  equal: (a: T, b: T) => boolean = canonicalEqual,
): ListDiff<T> {
  const beforeByKey = new Map<string, T[]>();
  for (const item of before) {
    const k = key(item);
    const group = beforeByKey.get(k);
    if (group) group.push(item);
    else beforeByKey.set(k, [item]);
  }

  // How many `after` items have claimed each key so far. The nth `after` item
  // with a key pairs with the nth `before` item with that key.
  const consumed = new Map<string, number>();
  const added: T[] = [];
  const changed: { before: T; after: T }[] = [];
  for (const item of after) {
    const k = key(item);
    const index = consumed.get(k) ?? 0;
    consumed.set(k, index + 1);
    const priors = beforeByKey.get(k);
    if (!priors || index >= priors.length) {
      added.push(item);
      continue;
    }
    const prior = priors[index];
    if (!equal(prior, item)) changed.push({ before: prior, after: item });
  }

  const removed: T[] = [];
  const seen = new Map<string, number>();
  for (const item of before) {
    const k = key(item);
    const index = seen.get(k) ?? 0;
    seen.set(k, index + 1);
    if (index >= (consumed.get(k) ?? 0)) removed.push(item);
  }

  // With nothing added, removed or changed, every value is equal, so the only
  // remaining difference is order. JSON.stringify rather than a joined string
  // so no separator character can collide with a key.
  const reordered = added.length === 0 && removed.length === 0 && changed.length === 0
    && JSON.stringify(before.map(key)) !== JSON.stringify(after.map(key));

  return { added, removed, changed, reordered };
}

// ---------------------------------------------------------------------------
// Group builders
// ---------------------------------------------------------------------------

/**
 * One line of a change list. `text` is the change; `scope` is an optional
 * second, quieter line saying which variants it reaches ("1 of 64 variants:
 * size Large · others at default"). Absent scope means the whole document.
 */
export interface ChangeItem { text: string; scope?: string }
export interface ChangeGroup { label: string; items: ChangeItem[] }

/** Builders push plain strings for scope-less items; groups() normalizes. */
type Draft = string | ChangeItem;

/** The one line a group shows when only its order moved. */
const REORDERED = 'Order changed, values unchanged';

/**
 * A stored baseline is not validated past "projection is an object", so a
 * list may be missing or malformed. Treat anything that is not an array as an
 * empty list rather than throwing: a half-readable baseline still explains
 * what it can.
 */
function list<T>(value: readonly T[] | undefined | null): readonly T[] {
  return Array.isArray(value) ? value : [];
}

function stringSetItems(
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
  added: (value: string) => string,
  removed: (value: string) => string,
): string[] {
  const d = diffKeyed(list(before), list(after), (s) => s);
  const items = [...d.added.map(added), ...d.removed.map(removed)];
  if (d.reordered) items.push(REORDERED);
  return items;
}

function pushReordered(items: Draft[]): void {
  if (!items.includes(REORDERED)) items.push(REORDERED);
}

/** Only groups with at least one item, in the order given. */
function groups(entries: readonly [string, readonly Draft[]][]): ChangeGroup[] {
  return entries
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({
      label,
      items: items.map((item) => (typeof item === 'string' ? { text: item } : item)),
    }));
}

/** Subject first, value after a colon, so a long description still reads. */
function scalarItem(label: string, before: string | undefined, after: string | undefined): string {
  if (before === undefined) return `${label} added: ${after}`;
  if (after === undefined) return `${label} removed: ${before}`;
  return `${label}: ${before} changed to ${after}`;
}

// ---------------------------------------------------------------------------
// Foundation
// ---------------------------------------------------------------------------

/**
 * One formatter per value kind so item copy is uniform. Nothing is invented:
 * an unresolved value names its reason and never a guessed number, and an
 * alias with no resolution shows only its reference.
 */
export function formatFoundationValue(value: FoundationValue): string {
  switch (value.kind) {
    case 'color':
      return value.alpha < 1 ? `${value.hex} at ${Math.round(value.alpha * 100)}%` : value.hex;
    case 'number':
      return String(value.value);
    case 'string':
      return value.value;
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'alias': {
      const reference = `{${value.targetCollection}/${value.targetName}}`;
      return value.resolved ? `${reference} resolving to ${formatFoundationValue(value.resolved)}` : reference;
    }
    case 'unresolved':
      return `unresolved (${value.reason})`;
  }
}

function formatLineHeight(lineHeight: FoundationTextMetrics['lineHeight']): string {
  if (lineHeight.unit === 'AUTO') return 'auto';
  if (lineHeight.value === undefined) return 'unknown';
  return lineHeight.unit === 'PERCENT' ? `${lineHeight.value}%` : String(lineHeight.value);
}

function formatSpacing(spacing: FoundationTextMetrics['letterSpacing']): string {
  return spacing.unit === 'PERCENT' ? `${spacing.value}%` : String(spacing.value);
}

/** The metrics line the frame draws, minus the chips; default case and decoration are silent there too. */
export function formatTextMetrics(metrics: FoundationTextMetrics): string {
  const parts = [
    `${metrics.fontFamily} ${metrics.fontStyle} ${metrics.fontSize}/${formatLineHeight(metrics.lineHeight)}`,
    `letter spacing ${formatSpacing(metrics.letterSpacing)}`,
    `paragraph spacing ${metrics.paragraphSpacing}px`,
  ];
  if (metrics.textCase !== 'ORIGINAL') parts.push(metrics.textCase.toLowerCase().replace(/_/g, ' '));
  if (metrics.textDecoration !== 'NONE') parts.push(metrics.textDecoration.toLowerCase());
  return parts.join(', ');
}

const GLYPH_NOUN: Record<FoundationGlyph, string> = {
  bar: 'a bar', radius: 'a rounded square', stroke: 'a stroke', opacity: 'an opacity swatch',
  fontSize: 'a font size sample', lineHeight: 'a line height sample', letterSpacing: 'a letter spacing sample',
};

/** True for a baseline written before Plan 3, which has no `codeSyntax` on any variable row. */
function isPrePlan3(before: FoundationUnitContent): boolean {
  return list(before.rows).some((row) =>
    (row.kind === 'variable' && (row as Partial<FoundationVariableRow>).codeSyntax === undefined)
    || (row.kind === 'textStyle' && (row.metrics as Partial<FoundationTextMetrics>).boundTokens === undefined));
}

/** Figma's own names for a variable's type, lowercase, in place of the API enum. */
const VARIABLE_TYPE_LABEL: Record<string, string> = {
  FLOAT: 'number', COLOR: 'color', STRING: 'string', BOOLEAN: 'boolean',
};

function rowTypeLabel(row: FoundationRow): string {
  return row.kind === 'textStyle' ? 'text style'
    : row.kind === 'effectStyle' ? 'effect style'
    : VARIABLE_TYPE_LABEL[row.resolvedType] ?? row.resolvedType;
}

function formatPart(part: FoundationUnitContent['part']): string | undefined {
  return part ? `${part.index + 1} of ${part.total}` : undefined;
}

/**
 * Groups, in order: Layout, Tokens, Descriptions, Modes, Part. Empty groups
 * are dropped; `[]` means nothing differs, which for two inputs that hash
 * differently should not happen.
 */
export function foundationChangeGroups(
  before: FoundationUnitContent,
  after: FoundationUnitContent,
): ChangeGroup[] {
  const tokens: Draft[] = [];
  const descriptions: Draft[] = [];

  // A baseline written before Plan 3 has no codeSyntax/glyph/full text metrics
  // at all, so diffing those fields against the current projection would
  // report every row as changed. One Layout item explains the whole move
  // instead, so the badge never shows "Update available" over an empty list.
  const layout: Draft[] = [];
  const prePlan3 = isPrePlan3(before);
  if (prePlan3) {
    layout.push(before.rows.some((r) => r.kind === 'textStyle')
      ? 'Updating adds full type metrics to this doc'
      : 'Updating adds reference names and scale drawings to this doc');
  }

  const rows = diffKeyed(list(before.rows), list(after.rows), (row) => row.name);
  for (const row of rows.added) tokens.push(`${row.name} added`);
  for (const row of rows.removed) tokens.push(`${row.name} removed`);
  for (const { before: b, after: a } of rows.changed) {
    const typeChanged = b.kind !== a.kind
      || (b.kind === 'variable' && a.kind === 'variable' && b.resolvedType !== a.resolvedType);
    if (typeChanged) {
      // Comparing a colour to a number cell by cell says nothing.
      tokens.push(`${a.name}: type ${rowTypeLabel(b)} changed to ${rowTypeLabel(a)}`);
    } else if (b.kind === 'variable' && a.kind === 'variable') {
      // Cells added or removed follow the mode set, which the Modes group
      // already explains; only a value that moved is a token item. The cell
      // reorder flag is ignored on purpose, not overlooked: unitContent builds
      // `cells` and `modeNames` from one `modes` array in one order, so
      // cells[i].modeName is always modeNames[i]. A cell-only reorder is
      // therefore unreachable, and a reorder of the modes themselves reaches
      // the user through the Modes group.
      const cells = diffKeyed(list(b.cells), list(a.cells), (cell) => cell.modeName);
      for (const { before: cb, after: ca } of cells.changed) {
        tokens.push(`${a.name} in ${ca.modeName}: ${formatFoundationValue(cb.value)} changed to ${formatFoundationValue(ca.value)}`);
      }
      if (!prePlan3) {
        const syntax = diffKeyed(
          Object.entries(b.codeSyntax).map(([platform, id]) => ({ platform, id })),
          Object.entries(a.codeSyntax).map(([platform, id]) => ({ platform, id })),
          (e) => e.platform,
        );
        for (const e of syntax.added) tokens.push(`${a.name}: ${e.platform} reference name added (${e.id})`);
        for (const e of syntax.removed) tokens.push(`${a.name}: ${e.platform} reference name removed (${e.id})`);
        for (const { before: sb, after: sa } of syntax.changed) {
          tokens.push(`${a.name}: ${sa.platform} reference name ${sb.id} changed to ${sa.id}`);
        }
        if (b.glyph !== a.glyph) {
          tokens.push(a.glyph
            ? `${a.name}: now drawn as ${GLYPH_NOUN[a.glyph]}`
            : `${a.name}: no longer drawn to scale`);
        }
      }
    } else if (b.kind === 'textStyle' && a.kind === 'textStyle' && !prePlan3 && !canonicalEqual(b.metrics, a.metrics)) {
      tokens.push(`${a.name}: ${formatTextMetrics(b.metrics)} changed to ${formatTextMetrics(a.metrics)}`);
    } else if (b.kind === 'effectStyle' && a.kind === 'effectStyle'
      && (!canonicalEqual(b.layers, a.layers) || !canonicalEqual(b.boundTokens, a.boundTokens))) {
      tokens.push(`${a.name}: effect layers changed`);
    }
    if (b.description !== a.description) descriptions.push(`Description of ${a.name} changed`);
  }
  if (rows.reordered) pushReordered(tokens);

  const modes = [
    ...stringSetItems(before.modeNames, after.modeNames,
      (mode) => `Mode ${mode} added`, (mode) => `Mode ${mode} removed`),
    ...stringSetItems(before.omittedModeNames, after.omittedModeNames,
      (mode) => `Mode ${mode} is now left out`, (mode) => `Mode ${mode} is no longer left out`),
  ];

  const part: string[] = [];
  if (before.collectionName !== after.collectionName) {
    part.push(`Collection: ${before.collectionName} changed to ${after.collectionName}`);
  }
  if (before.group !== after.group) part.push(scalarItem('Group', before.group, after.group));
  if (!canonicalEqual(before.part, after.part)) part.push(scalarItem('Part', formatPart(before.part), formatPart(after.part)));

  return groups([
    ['Layout', layout],
    ['Tokens', tokens],
    ['Descriptions', descriptions],
    ['Modes', modes],
    ['Part', part],
  ]);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type TokenEntry = SpecHashProjection['tokens'][number];
type GapEntry = SpecHashProjection['gaps'][number];
export type Combo = Record<string, string>;

/** Axis order is not identity: two rules with the same axes and values are the same rule. */
function conditionsKey(conditions: Record<string, string[]>): string {
  return JSON.stringify(Object.entries(conditions ?? {}).sort(([a], [b]) => compareCodeUnits(a, b)));
}

/** "a, b and c" for a list of words, "a" alone, "a and b" for two. */
function joinWords(words: readonly string[], last: string): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} ${last} ${words[words.length - 1]}`;
}

/** Axes that accept the same values, in first-axis order, so they share one clause. */
function clauseGroups(conditions: Record<string, string[]>): { axes: string[]; values: string[] }[] {
  const byValues = new Map<string, { axes: string[]; values: string[] }>();
  for (const [axis, values] of Object.entries(conditions ?? {})) {
    const k = JSON.stringify(values);
    const group = byValues.get(k);
    if (group) group.axes.push(axis);
    else byValues.set(k, { axes: [axis], values });
  }
  return [...byValues.values()];
}

/**
 * " when size is Large and hover and disabled are False", or "" when
 * unconditioned. Used by the rule-identity fallback only; the per-variant path
 * puts its scope on a second line via describeScope.
 */
function formatConditions(conditions: Record<string, string[]>): string {
  const clauses = clauseGroups(conditions).map(({ axes, values }) =>
    `${joinWords(axes, 'and')} ${axes.length > 1 ? 'are' : 'is'} ${joinWords(values, 'or')}`);
  return clauses.length > 0 ? ` when ${clauses.join(' and ')}` : '';
}

function tokenLabel(rule: TokenEntry): string {
  return `${rule.part} / ${rule.property}${formatConditions(rule.conditions)}`;
}

export function comboKey(values: Combo): string {
  return JSON.stringify(Object.entries(values ?? {}).sort(([a], [b]) => compareCodeUnits(a, b)));
}

/**
 * The distinct tokens bound on one (part, property) in one variant: what
 * resolveTokensForVariant resolves for it, as a sorted set so two cells compare
 * by content. A set, not a list: several layers can share a part name, and the
 * minimizer's rules can overlap for one token, so the same name may resolve
 * more than once for a variant without that being a design fact.
 * `bindingCells` expands a projection's minimized rules back over its variant
 * instances, which is the shape the canvas Tokens table renders and the shape
 * a designer edits one variant at a time.
 *
 * Keyed on `part`, not `path`, because SpecHashProjection carries only `part`:
 * `path` stays out of the hash (see specHashProjection in hash.ts), and the
 * diff input is the hash input. So two same-named parts in different
 * subtrees share one cell here, and a change to either reads as a change to
 * the pair. Fixing that means adding `path` to the projection, which moves
 * specContentHash for every committed document, so it waits for the next
 * EXTRACTOR_VERSION bump (review 2026-09-23). The same applies to ruleItems
 * below. libraryDiff.ts, which reads the v5 artifact rather than the
 * projection, already keys on `path`.
 */
type CellsByProperty = Map<string, { part: string; property: string; cells: Map<string, string[]> }>;

function bindingCells(projection: SpecHashProjection): CellsByProperty {
  const sets = new Map<string, { part: string; property: string; cells: Map<string, Set<string>> }>();
  for (const variant of list(projection.variantInstances)) {
    const vk = comboKey(variant.values);
    for (const rule of list(projection.tokens)) {
      if (!matchesVariant(rule.conditions ?? {}, variant.values ?? {})) continue;
      const pk = JSON.stringify([rule.part, rule.property]);
      let entry = sets.get(pk);
      if (!entry) sets.set(pk, (entry = { part: rule.part, property: rule.property, cells: new Map() }));
      const tokens = entry.cells.get(vk);
      if (tokens) tokens.add(rule.token);
      else entry.cells.set(vk, new Set([rule.token]));
    }
  }
  const out: CellsByProperty = new Map();
  for (const [pk, { part, property, cells }] of sets) {
    out.set(pk, { part, property, cells: new Map([...cells].map(([vk, tokens]) => [vk, [...tokens].sort(compareCodeUnits)])) });
  }
  return out;
}

/**
 * The axes of a variant grid and each axis's value order: the declared
 * `variants` axis order and option order where available, then anything else
 * the instances actually carry, in first-seen order. Only values some variant
 * carries are kept, so a declared option nobody uses is never named as changed.
 * Exported for libraryDiff.ts, which feeds it the v5 artifact's declared axes.
 */
export function axisModel(
  declared: readonly { prop: string; values: readonly string[] }[],
  universe: readonly Combo[],
): Map<string, string[]> {
  const axes = new Map<string, string[]>();
  for (const axis of declared) {
    if (!axes.has(axis.prop)) axes.set(axis.prop, [...axis.values]);
  }
  for (const combo of universe) {
    for (const [axis, value] of Object.entries(combo)) {
      const values = axes.get(axis);
      if (!values) axes.set(axis, [value]);
      else if (!values.includes(value)) values.push(value);
    }
  }
  for (const [axis, values] of axes) {
    const carried = new Set(universe.map((c) => c[axis]));
    const kept = values.filter((v) => carried.has(v));
    if (kept.length === 0) axes.delete(axis);
    else axes.set(axis, kept);
  }
  return axes;
}

/** Each variant axis's default value, as Figma records it on the component set. */
function variantDefaults(projection: SpecHashProjection): Map<string, string> {
  const defaults = new Map<string, string>();
  for (const prop of list(projection.props)) {
    if (prop.kind === 'variant' && typeof prop.default === 'string') defaults.set(prop.name, prop.default);
  }
  return defaults;
}

/**
 * The fewest, widest conditions that select exactly `subset` out of
 * `universe`: a greedy cover. Each rule starts from one uncovered variant
 * pinned on every axis, then each axis in turn is freed entirely if every
 * variant that admits is in the subset, or else widened value by value under
 * the same test. A rule never admits a variant outside the subset, so no line
 * names a variant that did not change; a subset that is not one product of
 * axis values takes more than one line rather than an inaccurate one.
 */
export function coverConditions(
  subset: readonly Combo[],
  universe: readonly Combo[],
  axes: Map<string, string[]>,
): { conditions: Record<string, string[]>; count: number }[] {
  // Every combo's key once. The greedy below probes admissibility once per
  // axis and once per axis value per rule, and each probe used to
  // re-stringify the whole universe; the proxy runs this on every publish.
  const universeKeys = universe.map(comboKey);
  const subsetKeys = subset.map(comboKey);
  const inSubset = new Set(subsetKeys);
  const selection = (conditions: Map<string, Set<string> | null>): number[] => {
    const selected: number[] = [];
    for (let i = 0; i < universe.length; i++) {
      const combo = universe[i];
      let admitted = true;
      for (const [axis, allowed] of conditions) {
        if (allowed !== null && !allowed.has(combo[axis])) { admitted = false; break; }
      }
      if (admitted) selected.push(i);
    }
    return selected;
  };
  const admissible = (conditions: Map<string, Set<string> | null>): boolean =>
    selection(conditions).every((i) => inSubset.has(universeKeys[i]));

  const uncovered = new Set(inSubset);
  const rules: { conditions: Record<string, string[]>; count: number }[] = [];
  for (let s = 0; s < subset.length; s++) {
    if (!uncovered.has(subsetKeys[s])) continue;
    const start = subset[s];
    const conditions = new Map<string, Set<string> | null>([...axes.keys()].map((axis) => [axis, new Set([start[axis]])]));
    for (const [axis, values] of axes) {
      const freed = new Map(conditions).set(axis, null);
      if (admissible(freed)) {
        conditions.set(axis, null);
        continue;
      }
      const allowed = conditions.get(axis)!;
      for (const value of values) {
        if (allowed.has(value)) continue;
        const widened = new Map(conditions).set(axis, new Set([...allowed, value]));
        if (admissible(widened)) allowed.add(value);
      }
    }
    const selected = selection(conditions);
    for (const i of selected) uncovered.delete(universeKeys[i]);
    const rule: Record<string, string[]> = {};
    for (const [axis, values] of axes) {
      const allowed = conditions.get(axis);
      if (allowed) rule[axis] = values.filter((v) => allowed.has(v));
    }
    rules.push({ conditions: rule, count: selected.length });
  }
  return rules;
}

/**
 * The scope line under a token item: "1 of 64 variants: type Primary · size
 * Large · others at default". Axes pinned to their Figma default collapse into
 * "others at default" once there are at least two of them and something else is
 * named; a scope pinned on every axis, all at default, is "the default
 * variant". An axis with no recorded default is always spelled out. No scope
 * at all when the conditions are empty: the change reaches every variant.
 */
export function describeScope(
  conditions: Record<string, string[]>,
  count: number,
  total: number,
  axisCount: number,
  defaults: Map<string, string>,
): string | undefined {
  const entries = Object.entries(conditions);
  if (entries.length === 0) return undefined;
  const atDefault = entries.filter(([axis, values]) => values.length === 1 && defaults.get(axis) === values[0]);
  const named = entries.filter(([axis]) => !atDefault.some(([a]) => a === axis));
  let detail: string;
  if (named.length === 0 && atDefault.length === axisCount) {
    detail = 'the default variant';
  } else {
    const collapse = atDefault.length >= 2 && named.length >= 1;
    const shown = Object.fromEntries(collapse ? named : entries);
    const clauses = clauseGroups(shown).map(({ axes, values }) => `${axes.join(', ')} ${values.join(' or ')}`);
    if (collapse) clauses.push('others at default');
    detail = clauses.join(' · ');
  }
  return `${count} of ${total} variants: ${detail}`;
}

function setDifference(a: readonly string[], b: readonly string[]): string[] {
  return a.filter((x) => !b.includes(x));
}

/**
 * Token items. Compared per variant, not per rule: a rule's conditions are
 * recomputed over the whole grid by extractTokens, so rebinding one variant
 * splits one general rule into several specific ones, and a diff keyed by
 * conditions reads that single edit as several rules added and one removed.
 * Both sides are expanded over their variant instances and compared cell by
 * cell; cells that moved the same way are described together, with the fewest
 * conditions that select exactly them on a second scope line. A cell that kept
 * some tokens and swapped others reports only the tokens that moved. Variants
 * present on one side only are the Variants group's story and are not
 * repeated here.
 *
 * Returns null when a side carries no variant instances, which a valid
 * projection never does; the caller then falls back to rule identity so a
 * half-readable baseline still explains what it can.
 */
function tokenItems(before: SpecHashProjection, after: SpecHashProjection): ChangeItem[] | null {
  const beforeVariants = list(before.variantInstances);
  const afterVariants = list(after.variantInstances);
  if (beforeVariants.length === 0 || afterVariants.length === 0) return null;

  const beforeKeys = new Set(beforeVariants.map((v) => comboKey(v.values)));
  const seen = new Set<string>();
  const shared: Combo[] = [];
  for (const variant of afterVariants) {
    const k = comboKey(variant.values);
    if (beforeKeys.has(k) && !seen.has(k)) {
      seen.add(k);
      shared.push(variant.values);
    }
  }
  const axes = axisModel(list(after.variants), shared);
  const defaults = variantDefaults(after);
  const beforeCells = bindingCells(before);
  const afterCells = bindingCells(after);

  const items: ChangeItem[] = [];
  const properties = [...afterCells.keys(), ...[...beforeCells.keys()].filter((k) => !afterCells.has(k))];
  for (const pk of properties) {
    const entry = afterCells.get(pk) ?? beforeCells.get(pk)!;
    const label = `${entry.part} / ${entry.property}`;
    const b = beforeCells.get(pk)?.cells;
    const a = afterCells.get(pk)?.cells;
    // One bucket per distinct movement, in the order first seen walking the
    // after grid, holding the variants that moved that way.
    const buckets = new Map<string, { text: string; combos: Combo[] }>();
    for (const combo of shared) {
      const k = comboKey(combo);
      const from = b?.get(k);
      const to = a?.get(k);
      if (canonicalEqual(from, to)) continue;
      let text: string;
      // A cell that lost its only binding reads the same as one that lost some
      // of several, so both land in one bucket and share one scope line.
      if (!from) text = `${label}: bound to ${to!.join(', ')}`;
      else if (!to) text = `${label}: no longer bound to ${from.join(', ')}`;
      else {
        const lost = setDifference(from, to);
        const gained = setDifference(to, from);
        if (lost.length > 0 && gained.length > 0) text = `${label}: ${lost.join(', ')} changed to ${gained.join(', ')}`;
        else if (gained.length > 0) text = `${label}: also bound to ${gained.join(', ')}`;
        else text = `${label}: no longer bound to ${lost.join(', ')}`;
      }
      const bucket = buckets.get(text);
      if (bucket) bucket.combos.push(combo);
      else buckets.set(text, { text, combos: [combo] });
    }
    for (const { text, combos } of buckets.values()) {
      for (const { conditions, count } of coverConditions(combos, shared, axes)) {
        const scope = describeScope(conditions, count, shared.length, axes.size, defaults);
        items.push(scope ? { text, scope } : { text });
      }
    }
  }
  return items;
}

/** Rule-identity fallback for a projection missing its variant instances.
 *  Keyed on `part` for the reason bindingCells gives: the projection has no `path`. */
function ruleItems(before: SpecHashProjection, after: SpecHashProjection): Draft[] {
  const tokens: Draft[] = [];
  const rules = diffKeyed(list(before.tokens), list(after.tokens),
    (rule) => JSON.stringify([rule.part, rule.property, conditionsKey(rule.conditions)]));
  for (const rule of rules.added) tokens.push(`${tokenLabel(rule)}: bound to ${rule.token}`);
  for (const rule of rules.removed) tokens.push(`${tokenLabel(rule)}: no longer bound to ${rule.token}`);
  for (const { before: b, after: a } of rules.changed) {
    tokens.push(`${tokenLabel(a)}: ${b.token} changed to ${a.token}`);
  }
  if (rules.reordered) pushReordered(tokens);
  return tokens;
}

function gapLabel(gap: GapEntry): string {
  return `${gap.part} / ${gap.property} (${String(gap.issue).replace(/-/g, ' ')})`;
}

function formatList(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join(', ') : 'none';
}

function formatDefault(value: string | boolean | undefined): string {
  return value === undefined ? 'no default' : String(value);
}

function formatGapValue(value: number | string | undefined): string {
  return value === undefined ? 'no value' : String(value);
}

/** Figma's words for a property type; `instanceSwap` is a code name. */
function formatPropKind(kind: string): string {
  return kind === 'instanceSwap' ? 'instance swap' : kind;
}

/** Figma's layer type as the layers panel says it, lowercase: FRAME reads "frame". */
function formatLayerType(type: string): string {
  return String(type).toLowerCase().replace(/_/g, ' ');
}

function formatValues(values: Record<string, string>): string {
  const entries = Object.entries(values ?? {}).map(([axis, value]) => `${axis}=${value}`);
  return entries.length > 0 ? entries.join(', ') : 'none';
}

/**
 * Groups, in order: Name, Properties, Variants, Anatomy, States, Tokens,
 * Unbound values, Layout, Related. `description` is content, not identity,
 * and lands under Name alongside the component's own name. `figmaKey`,
 * `figmaFile`, `figmaNode` and `anatomyComponentId` are hashed identity, not
 * content, so a change in any of them is one "Source identity changed" line
 * under Name. The file name and the documentation links are not in the
 * projection, so they are not itemized: the diff input is the hash input.
 */
export function componentChangeGroups(
  before: SpecHashProjection,
  after: SpecHashProjection,
): ChangeGroup[] {
  const name: string[] = [];
  if (before.name !== after.name) name.push(`Name: ${before.name} changed to ${after.name}`);
  if (before.description !== after.description) {
    name.push(scalarItem('Description', before.description || undefined, after.description || undefined));
  }
  if (
    before.figmaKey !== after.figmaKey
    || before.figmaFile !== after.figmaFile
    || before.figmaNode !== after.figmaNode
    || before.anatomyComponentId !== after.anatomyComponentId
  ) {
    name.push('Source identity changed');
  }

  const properties: string[] = [];
  const props = diffKeyed(list(before.props), list(after.props), (prop) => prop.name);
  for (const prop of props.added) properties.push(`Property ${prop.name} added`);
  for (const prop of props.removed) properties.push(`Property ${prop.name} removed`);
  for (const { before: b, after: a } of props.changed) {
    if (b.kind !== a.kind) {
      properties.push(`Property ${a.name}: type ${formatPropKind(b.kind)} changed to ${formatPropKind(a.kind)}`);
    }
    if (!canonicalEqual(b.options, a.options)) {
      properties.push(`Property ${a.name}: values ${formatList(b.options)} changed to ${formatList(a.options)}`);
    }
    if (b.default !== a.default) {
      properties.push(`Property ${a.name}: default ${formatDefault(b.default)} changed to ${formatDefault(a.default)}`);
    }
  }
  if (props.reordered) pushReordered(properties);

  const variants: string[] = [];
  const axes = diffKeyed(list(before.variants), list(after.variants), (axis) => axis.prop);
  for (const axis of axes.added) variants.push(`Variant property ${axis.prop} added`);
  for (const axis of axes.removed) variants.push(`Variant property ${axis.prop} removed`);
  for (const { before: b, after: a } of axes.changed) {
    variants.push(`Variant property ${a.prop}: values ${formatList(b.values)} changed to ${formatList(a.values)}`);
  }
  if (axes.reordered) pushReordered(variants);
  const instances = diffKeyed(list(before.variantInstances), list(after.variantInstances), (v) => v.nodeId);
  for (const v of instances.added) variants.push(`Variant ${v.name} added`);
  for (const v of instances.removed) variants.push(`Variant ${v.name} removed`);
  for (const { before: b, after: a } of instances.changed) {
    if (b.name !== a.name) variants.push(`Variant ${b.name} renamed to ${a.name}`);
    if (!canonicalEqual(b.values, a.values)) {
      variants.push(`Variant ${a.name}: values ${formatValues(b.values)} changed to ${formatValues(a.values)}`);
    }
  }
  if (instances.reordered) pushReordered(variants);

  const anatomy: string[] = [];
  const parts = diffKeyed(list(before.anatomy), list(after.anatomy), (part) => part.id);
  for (const part of parts.added) anatomy.push(`Part ${part.name} added`);
  for (const part of parts.removed) anatomy.push(`Part ${part.name} removed`);
  for (const { before: b, after: a } of parts.changed) {
    if (b.name !== a.name) anatomy.push(`Part ${b.name} renamed to ${a.name}`);
    // `nested` is derived from the type (anatomy.ts: type === 'INSTANCE'), so
    // the type line already reports every change to it; no line of its own.
    if (b.type !== a.type) {
      anatomy.push(`Part ${a.name}: type ${formatLayerType(b.type)} changed to ${formatLayerType(a.type)}`);
    }
  }
  if (parts.reordered) pushReordered(anatomy);

  const states = stringSetItems(before.states, after.states,
    (state) => `State ${state} added`, (state) => `State ${state} removed`);

  const tokens = tokenItems(before, after) ?? ruleItems(before, after);

  const unbound: string[] = [];
  const gaps = diffKeyed(list(before.gaps), list(after.gaps),
    (gap) => JSON.stringify([gap.part, gap.property, gap.issue]));
  for (const gap of gaps.added) {
    unbound.push(`${gapLabel(gap)} added${gap.value !== undefined ? `: ${gap.value}` : ''}`);
  }
  for (const gap of gaps.removed) unbound.push(`${gapLabel(gap)} removed`);
  for (const { before: b, after: a } of gaps.changed) {
    unbound.push(`${gapLabel(a)}: ${formatGapValue(b.value)} changed to ${formatGapValue(a.value)}`);
  }
  if (gaps.reordered) pushReordered(unbound);

  const layout: string[] = [];
  const layouts = diffKeyed(list(before.layout), list(after.layout), (entry) => entry.part);
  for (const entry of layouts.added) layout.push(`Layout of ${entry.part} added: ${entry.summary}`);
  for (const entry of layouts.removed) layout.push(`Layout of ${entry.part} removed`);
  for (const { before: b, after: a } of layouts.changed) {
    layout.push(`Layout of ${a.part}: ${b.summary} changed to ${a.summary}`);
  }
  if (layouts.reordered) pushReordered(layout);

  const related = stringSetItems(before.related, after.related,
    (value) => `Related ${value} added`, (value) => `Related ${value} removed`);

  return groups([
    ['Name', name],
    ['Properties', properties],
    ['Variants', variants],
    ['Anatomy', anatomy],
    ['States', states],
    ['Tokens', tokens],
    ['Unbound values', unbound],
    ['Layout', layout],
    ['Related', related],
  ]);
}
