/**
 * diff.ts: the semantic diff behind the Library's "Review detected changes".
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
import { canonicalEqual } from './hash';
import type {
  FoundationRow, FoundationTextMetrics, FoundationUnitContent, FoundationValue,
} from './foundation';

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

export interface ChangeGroup { label: string; items: string[] }

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

function pushReordered(items: string[]): void {
  if (!items.includes(REORDERED)) items.push(REORDERED);
}

/** Only groups with at least one item, in the order given. */
function groups(entries: readonly [string, string[]][]): ChangeGroup[] {
  return entries
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function scalarItem(label: string, before: string | undefined, after: string | undefined): string {
  if (before === undefined) return `Added ${label.toLowerCase()} ${after}`;
  if (after === undefined) return `Removed ${label.toLowerCase()} ${before}`;
  return `${label} ${before} changed to ${after}`;
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

/** "family style size/lineHeight", the same line the frame draws. */
export function formatTextMetrics(metrics: FoundationTextMetrics): string {
  return `${metrics.fontFamily} ${metrics.fontStyle} ${metrics.fontSize}/${formatLineHeight(metrics.lineHeight)}`;
}

function rowTypeLabel(row: FoundationRow): string {
  return row.kind === 'textStyle' ? 'text style' : row.resolvedType;
}

function formatPart(part: FoundationUnitContent['part']): string | undefined {
  return part ? `${part.index + 1} of ${part.total}` : undefined;
}

/**
 * Groups, in order: Tokens, Descriptions, Modes, Part. Empty groups are
 * dropped; `[]` means nothing differs, which for two inputs that hash
 * differently should not happen.
 */
export function foundationChangeGroups(
  before: FoundationUnitContent,
  after: FoundationUnitContent,
): ChangeGroup[] {
  const tokens: string[] = [];
  const descriptions: string[] = [];

  const rows = diffKeyed(list(before.rows), list(after.rows), (row) => row.name);
  for (const row of rows.added) tokens.push(`Added ${row.name}`);
  for (const row of rows.removed) tokens.push(`Removed ${row.name}`);
  for (const { before: b, after: a } of rows.changed) {
    const typeChanged = b.kind !== a.kind
      || (b.kind === 'variable' && a.kind === 'variable' && b.resolvedType !== a.resolvedType);
    if (typeChanged) {
      // Comparing a colour to a number cell by cell says nothing.
      tokens.push(`${a.name}: type ${rowTypeLabel(b)} changed to ${rowTypeLabel(a)}`);
    } else if (b.kind === 'variable' && a.kind === 'variable') {
      // Cells added or removed follow the mode set, which the Modes group
      // already explains; only a value that moved is a token item.
      const cells = diffKeyed(list(b.cells), list(a.cells), (cell) => cell.modeName);
      for (const { before: cb, after: ca } of cells.changed) {
        tokens.push(`${a.name} in ${ca.modeName}: ${formatFoundationValue(cb.value)} changed to ${formatFoundationValue(ca.value)}`);
      }
    } else if (b.kind === 'textStyle' && a.kind === 'textStyle' && !canonicalEqual(b.metrics, a.metrics)) {
      tokens.push(`${a.name}: ${formatTextMetrics(b.metrics)} changed to ${formatTextMetrics(a.metrics)}`);
    }
    if (b.description !== a.description) descriptions.push(`Description of ${a.name} changed`);
  }
  if (rows.reordered) pushReordered(tokens);

  const modes = [
    ...stringSetItems(before.modeNames, after.modeNames,
      (mode) => `Added mode ${mode}`, (mode) => `Removed mode ${mode}`),
    ...stringSetItems(before.omittedModeNames, after.omittedModeNames,
      (mode) => `Mode ${mode} is now left out`, (mode) => `Mode ${mode} is no longer left out`),
  ];

  const part: string[] = [];
  if (before.collectionName !== after.collectionName) {
    part.push(`Collection ${before.collectionName} changed to ${after.collectionName}`);
  }
  if (before.group !== after.group) part.push(scalarItem('Group', before.group, after.group));
  if (!canonicalEqual(before.part, after.part)) part.push(scalarItem('Part', formatPart(before.part), formatPart(after.part)));

  return groups([
    ['Tokens', tokens],
    ['Descriptions', descriptions],
    ['Modes', modes],
    ['Part', part],
  ]);
}
