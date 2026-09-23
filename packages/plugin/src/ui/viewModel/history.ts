/**
 * history.ts (view model): turns a version record's change list into the
 * cards the history pane renders, and names a bump in plain words. Pure.
 *
 * One card per subject (each component by name, and Foundations), so an
 * item never repeats the component it belongs to. Inside a card, breaking
 * changes (removed, renamed) read first, then additions, then value changes.
 */
import type { ChangeKind, LibraryChange, VersionRecord } from '@spec-layer/extractor';

export interface HistoryItem {
  kind: ChangeKind;
  /** The sentence, without the values: `from` and `to` render beside it. */
  text: string;
  from: string | null;
  to: string | null;
  /** A second muted line, or null when the sentence already carries it. */
  scope: string | null;
}
export interface HistoryCard { label: string; items: HistoryItem[] }

const FOUNDATIONS = 'Foundations';

/** removed and renamed break consumers, so they lead; additions next; value changes last. */
const KIND_RANK: Record<ChangeKind, number> = { removed: 0, renamed: 0, added: 1, changed: 2 };

/** `layout:Container` reads "Layout of Container changed"; the id shapes come from libraryDiff.ts. */
function valueSentence(id: string): string {
  const at = id.indexOf(':');
  if (at < 0) return `${id} changed`;
  const kind = id.slice(0, at);
  const rest = id.slice(at + 1);
  if (kind === 'layout') return `Layout of ${rest} changed`;
  if (kind === 'effects') return `Effects of ${rest} changed`;
  if (kind === 'unbound') return `Unbound value at ${rest} changed`;
  return `${id} changed`;
}

/** "added" or "removed" for those kinds, else "changed"; renames are handled per entity. */
const verbOf = (kind: ChangeKind): string => (kind === 'added' || kind === 'removed' ? kind : 'changed');

/**
 * The sentence for one change and the scope line that should follow it.
 * Where the scope is part of the sentence (an option's axis, a mode's
 * collection, a token value's mode) the returned scope is null so the pane
 * never prints it twice. Values are never in the sentence: the pane renders
 * `from` struck through beside `to`.
 */
export function describeChange(change: LibraryChange): { text: string; scope: string | null } {
  const { kind, name, scope } = change;
  const from = change.from ?? '';
  switch (change.entity) {
    case 'component':
      if (kind === 'renamed') return { text: `Component renamed from ${from}`, scope: null };
      return { text: `Component ${verbOf(kind)}`, scope: null };
    case 'variant_axis':
      if (kind === 'changed' || kind === 'renamed') return { text: `Default of ${name} changed`, scope };
      return { text: `Variant property ${name} ${kind}`, scope };
    case 'option':
      // libraryDiff.ts diffs options as plain strings, so an option is only
      // ever added or removed, and always carries its axis as the scope.
      if (kind === 'added') return { text: `Value ${name} added to ${scope}`, scope: null };
      return { text: `Value ${name} removed from ${scope}`, scope: null };
    case 'property':
      return { text: `Property ${name} ${verbOf(kind)}`, scope };
    case 'state':
      return { text: `State ${name} ${verbOf(kind)}`, scope };
    case 'anatomy_part':
      return { text: `Part ${name} ${verbOf(kind)}`, scope };
    case 'binding':
      if (kind === 'added') return { text: `${name} bound to`, scope };
      if (kind === 'removed') return { text: `${name} no longer bound to`, scope };
      return { text: name, scope };
    case 'value':
      return { text: valueSentence(change.id), scope };
    case 'collection':
      if (kind === 'renamed') return { text: `Collection ${from} renamed to ${name}`, scope };
      return { text: `Collection ${name} ${verbOf(kind)}`, scope };
    case 'mode':
      // A mode is only ever added, removed, or renamed, and always carries its
      // collection's name as the scope (libraryDiff.ts diffFoundation).
      if (kind === 'renamed') return { text: `Mode ${from} renamed to ${name} in ${scope}`, scope: null };
      if (kind === 'added') return { text: `Mode ${name} added to ${scope}`, scope: null };
      return { text: `Mode ${name} removed from ${scope}`, scope: null };
    case 'token':
      if (kind === 'renamed') return { text: `Variable ${from} renamed to ${name}`, scope };
      return { text: `Variable ${name} ${verbOf(kind)}`, scope };
    case 'token_value':
      // modeName() in libraryDiff.ts always names the mode, falling back to its key.
      return { text: `${name} in ${scope}`, scope: null };
    case 'style':
      // A rename drops its struck values (groupChanges), so both names go in the sentence.
      if (kind === 'renamed') return { text: `Style ${from} renamed to ${name}`, scope };
      return { text: `Style ${name} ${verbOf(kind)}`, scope };
  }
}

export function groupChanges(changes: LibraryChange[]): HistoryCard[] {
  const cards = new Map<string, HistoryItem[]>();
  for (const change of changes) {
    const label = change.component ?? FOUNDATIONS;
    const { text, scope } = describeChange(change);
    // A rename's names are in the sentence; struck values would repeat them.
    const renamed = change.kind === 'renamed';
    const item: HistoryItem = { kind: change.kind, text, from: renamed ? null : change.from, to: renamed ? null : change.to, scope };
    const items = cards.get(label);
    if (items) items.push(item);
    else cards.set(label, [item]);
  }
  // Foundations first, then components in the change list's order (the proxy
  // sorts changes foundation first, then by component name, so this only
  // matters for a list that arrived unsorted). Within a card, rank first and
  // the list's order second.
  const ordered = [...cards].sort(([a], [b]) => Number(b === FOUNDATIONS) - Number(a === FOUNDATIONS));
  return ordered.map(([label, items]) => ({
    label,
    items: items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind] || a.index - b.index)
      .map(({ item }) => item),
  }));
}

export function bumpTone(bump: VersionRecord['bump']): 'danger' | 'accent' | 'success' | null {
  switch (bump) {
    case 'major': return 'danger';
    case 'minor': return 'accent';
    case 'initial': return 'success';
    case 'patch': return null;
  }
}

/** The badge word. Plain, capitalized; the meaning is in bumpExplanation. */
export function bumpLabel(bump: VersionRecord['bump']): string {
  switch (bump) {
    case 'major': return 'Major';
    case 'minor': return 'Minor';
    case 'patch': return 'Patch';
    case 'initial': return 'First version';
  }
}

/** One sentence for the badge's tooltip. Says what happened, not what semver calls it. */
export function bumpExplanation(bump: VersionRecord['bump']): string {
  switch (bump) {
    case 'major': return 'Something was removed or renamed. Code that used it may break.';
    case 'minor': return 'Something was added. Existing code keeps working.';
    // Styles are structural (libraryDiff.ts STRUCTURAL): adding, removing or
    // renaming one is never a patch, and a style's values are covered by "Values".
    case 'patch': return 'Values, bindings, or text changed. No component, property, variable, or mode was added or removed.';
    case 'initial': return 'The first publish. Nothing to compare against.';
  }
}
