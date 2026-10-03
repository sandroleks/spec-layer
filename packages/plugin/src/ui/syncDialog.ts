/**
 * The words Annotate in Dev Mode shows: the confirm dialog built from a plan, the
 * second step that replaces edits made in Figma, and the result toast. Pure,
 * so every sentence is tested. Sentence case, second person, no em dashes.
 */
import type { SyncPlanResult, SyncResult } from '../syncFigma';
import { countPlan, type SyncCounts } from '../syncPlan';
import type { ConfirmDialogOptions } from './shell/confirmDialog';

/** Up to three names, then a count, so a long file never floods the dialog. */
export function nameList(names: readonly string[]): string {
  if (names.length <= 3) {
    return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export type SyncNext =
  | { kind: 'confirm'; dialog: ConfirmDialogOptions; edited: string[] }
  | { kind: 'replace'; dialog: ConfirmDialogOptions }
  | { kind: 'toast'; message: string; error?: boolean };

/** Writes the doc's text over values a person changed in Figma. */
export function replaceDialog(edited: readonly string[]): ConfirmDialogOptions {
  return {
    title: 'Replace edits made in Figma?',
    body: `${nameList(edited)} ${edited.length === 1 ? 'has' : 'have'} a description, link or annotation ` +
      'that was changed in Figma. Replacing writes the doc’s text over it. Undo puts it back.',
    confirmLabel: 'Replace',
    tone: 'danger',
  };
}

function writesSentence(c: SyncCounts): string {
  const parts: string[] = [];
  if (c.descriptions) parts.push(plural(c.descriptions, 'description', 'descriptions'));
  if (c.annotations) parts.push(plural(c.annotations, 'annotation', 'annotations'));
  if (c.links) parts.push(plural(c.links, 'documentation link', 'documentation links'));
  return `This writes ${nameList(parts)}.`;
}

/** What to show for a fresh plan. */
export function planNext(plan: SyncPlanResult): SyncNext {
  const c = countPlan(plan.items);
  if (plan.items.length === 0) {
    return plan.skipped.some((s) => s.reason === 'rebuildNeeded')
      ? { kind: 'toast', message: 'Rebuild this doc first, then annotate it in Dev Mode.' }
      : { kind: 'toast', message: 'There are no component docs to annotate in this file.' };
  }
  const writes = c.descriptions + c.annotations + c.links;
  if (writes === 0) {
    return c.edited.length
      ? { kind: 'replace', dialog: replaceDialog(c.edited) }
      : { kind: 'toast', message: 'Dev Mode already matches these docs.' };
  }
  const sentences = [writesSentence(c)];
  if (c.aiWritten.length) {
    sentences.push(`Written with AI and not yet edited: ${nameList(c.aiWritten)}. Confirming is your review.`);
  }
  if (c.edited.length) {
    sentences.push(`Edits made in Figma are kept for ${nameList(c.edited)}. You can replace them next.`);
  }
  if (!plan.fileLinkKnown) {
    sentences.push('To set documentation links too, save this file’s link in Settings, Export.');
  }
  sentences.push('Other files see the descriptions after you publish the library.');
  const one = plan.items.length === 1;
  return {
    kind: 'confirm',
    edited: c.edited,
    dialog: {
      title: one ? `Annotate ${plan.items[0].name} in Dev Mode?` : `Annotate ${plural(plan.items.length, 'component', 'components')} in Dev Mode?`,
      body: sentences.join(' '),
      confirmLabel: 'Annotate',
    },
  };
}

/** The toast after a run. */
export function resultToast(r: SyncResult): { message: string; error?: boolean } {
  if (r.failed.length) {
    const first = r.failed[0];
    return { message: `Couldn’t annotate ${first.name}: ${first.message}`, error: true };
  }
  if (r.components === 0) return { message: 'Dev Mode already matches these docs.' };
  const done = `Annotated ${plural(r.components, 'component', 'components')} in Dev Mode.`;
  const tail = r.descriptions ? ' Publish the library so other files see the descriptions.' : '';
  const category = r.noCategory ? ' Annotations went in without the Spec Layer category.' : '';
  return { message: done + tail + category };
}
