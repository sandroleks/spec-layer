/**
 * history.ts (view model): turns a version record's change list into the
 * groups the history pane renders. Pure.
 */
import type { LibraryChange, VersionRecord } from '@spec-layer/extractor';

export interface HistoryItem { label: string; from: string | null; to: string | null; scope: string | null }
export interface HistoryGroup { label: 'Components' | 'Foundations' | 'Removed'; items: HistoryItem[] }

const ENTITY_WORDS: Record<LibraryChange['entity'], string> = {
  component: 'component', property: 'property', option: 'option', variant_axis: 'variant axis',
  state: 'state', anatomy_part: 'part', binding: 'binding', value: 'value',
  collection: 'collection', mode: 'mode', token: 'token', token_value: 'token value', style: 'style',
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * "Button: state Hover removed", "Token color/primary renamed", "Token value
 * color/primary". A changed entity carries no verb: its from and to say what
 * moved. The rename shows the old name, since `name` is already the new one.
 */
export function describeChange(change: LibraryChange): string {
  const entity = ENTITY_WORDS[change.entity];
  const subject = change.component ? `${change.component}: ${entity} ` : `${capitalize(entity)} `;
  const name = change.kind === 'renamed' && change.from ? change.from : change.name;
  const verb = change.kind === 'changed' ? '' : ` ${change.kind}`;
  return `${subject}${name}${verb}`;
}

export function groupChanges(changes: LibraryChange[]): HistoryGroup[] {
  const removed: HistoryItem[] = [];
  const components: HistoryItem[] = [];
  const foundations: HistoryItem[] = [];
  for (const change of changes) {
    const item: HistoryItem = { label: describeChange(change), from: change.from, to: change.to, scope: change.scope };
    if (change.kind === 'removed' || change.kind === 'renamed') removed.push(item);
    else if (change.component !== null) components.push(item);
    else foundations.push(item);
  }
  const groups: HistoryGroup[] = [];
  if (removed.length > 0) groups.push({ label: 'Removed', items: removed });
  if (components.length > 0) groups.push({ label: 'Components', items: components });
  if (foundations.length > 0) groups.push({ label: 'Foundations', items: foundations });
  return groups;
}

export function bumpTone(bump: VersionRecord['bump']): 'danger' | 'accent' | 'success' | null {
  switch (bump) {
    case 'major': return 'danger';
    case 'minor': return 'accent';
    case 'initial': return 'success';
    case 'patch': return null;
  }
}

/** `breaking` is the word developers use for a major change, so it is allowed here. */
export function bumpLabel(bump: VersionRecord['bump']): string {
  switch (bump) {
    case 'major': return 'major, breaking';
    case 'initial': return 'first version';
    default: return bump;
  }
}
