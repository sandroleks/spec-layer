/**
 * The words Annotate in Dev Mode shows: the confirm dialog built from a plan, the
 * second step that replaces what was set in Figma, and the result toast. Pure,
 * so every sentence is tested. Sentence case, second person, no em dashes.
 */
import type { SyncPlanResult, SyncResult, SyncSkip, SyncSkipReason } from '../syncFigma';
import { countPlan, type SyncCounts } from '../syncPlan';
import { nameList } from '../syncText';
import type { ConfirmDialogOptions } from './shell/confirmDialog';

export { nameList };

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const verb = (names: readonly string[], one: string, many: string): string => (names.length === 1 ? one : many);
/** Ends a message from Figma as a sentence. */
const sentence = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`);

export type SyncNext =
  | { kind: 'confirm'; dialog: ConfirmDialogOptions }
  | { kind: 'replace'; dialog: ConfirmDialogOptions }
  | { kind: 'toast'; message: string; error?: boolean };

function aiReplaceSentence(names: readonly string[]): string {
  return `The doc’s text for ${nameList(names)} includes text written with AI that nobody has edited, so replacing is your review.`;
}

/** Writes the doc's text over values a person set, changed or removed in Figma. */
export function replaceDialog(held: readonly string[], heldAi: readonly string[] = []): ConfirmDialogOptions {
  const sentences = [
    `${nameList(held)} ${verb(held, 'has', 'have')} a description, link or annotation that was set or removed in Figma.`,
    'Replacing writes the doc’s text in its place.',
    ...(heldAi.length ? [aiReplaceSentence(heldAi)] : []),
    // The description is part of the drift baseline, so replacing one moves it.
    'A doc whose description is replaced then shows Update available.',
    'You can undo this right after.',
  ];
  return { title: 'Replace what was set in Figma?', body: sentences.join(' '), confirmLabel: 'Replace', tone: 'danger' };
}

function changeSentences(c: SyncCounts): string[] {
  const out: string[] = [];
  const writes: string[] = [];
  if (c.descriptions) writes.push(plural(c.descriptions, 'description', 'descriptions'));
  if (c.annotations) writes.push(plural(c.annotations, 'annotation', 'annotations'));
  if (c.links) writes.push(plural(c.links, 'documentation link', 'documentation links'));
  if (writes.length) out.push(`This writes ${nameList(writes)}.`);
  const lead = (): string => (out.length ? 'It' : 'This');
  if (c.cleared) {
    out.push(c.cleared === 1
      ? `${lead()} clears 1 description whose doc no longer has Usage text.`
      : `${lead()} clears ${c.cleared} descriptions whose docs no longer have Usage text.`);
  }
  if (c.removed) {
    out.push(c.removed === 1
      ? `${lead()} removes 1 annotation from a part the doc no longer numbers.`
      : `${lead()} removes ${c.removed} annotations from parts the docs no longer number.`);
  }
  return out;
}

function updateFirstSentence(names: readonly string[]): string {
  return names.length === 1
    ? `Update the doc for ${names[0]} first to annotate its parts.`
    : `Update the docs for ${nameList(names)} first to annotate their parts.`;
}

const SKIP_ORDER: readonly SyncSkipReason[] = ['rebuildNeeded', 'sourceMissing', 'recordUnreadable', 'unreadable'];

/** One sentence per reason a doc was left out. */
function skippedSentences(skipped: readonly SyncSkip[]): string[] {
  const out: string[] = [];
  for (const reason of SKIP_ORDER) {
    const group = skipped.filter((s) => s.reason === reason);
    if (!group.length) continue;
    const names = group.map((s) => s.name);
    const list = nameList(names);
    if (reason === 'rebuildNeeded') out.push(`${list} ${verb(names, 'needs', 'need')} a rebuild first.`);
    if (reason === 'sourceMissing') out.push(`${list} ${verb(names, 'has', 'have')} no source component in this file.`);
    if (reason === 'recordUnreadable') {
      out.push(`${list} ${verb(names, 'has', 'have')} an annotation record this version can’t read, so ${verb(names, 'it’s', 'they’re')} left alone.`);
    }
    if (reason === 'unreadable') out.push(`Couldn’t read ${list} (${group[0].message ?? 'no details'}).`);
  }
  return out;
}

/** What to show for a fresh plan. */
export function planNext(plan: SyncPlanResult): SyncNext {
  const c = countPlan(plan.items);
  const skipped = skippedSentences(plan.skipped);
  if (plan.items.length === 0) {
    if (plan.skipped.length === 0) return { kind: 'toast', message: 'There are no component docs to annotate in this file.' };
    if (plan.skipped.every((s) => s.reason === 'rebuildNeeded')) {
      return {
        kind: 'toast',
        message: plan.skipped.length === 1
          ? 'Rebuild this doc first, then annotate it in Dev Mode.'
          : 'Rebuild these docs first, then annotate them in Dev Mode.',
      };
    }
    return { kind: 'toast', message: ['Nothing to annotate in Dev Mode yet.', ...skipped].join(' ') };
  }
  const changes = changeSentences(c);
  const waiting = c.updateFirst.length ? [updateFirstSentence(c.updateFirst)] : [];
  if (changes.length === 0) {
    if (c.edited.length) return { kind: 'replace', dialog: replaceDialog(c.edited, c.keptAi) };
    if (!waiting.length && !skipped.length) return { kind: 'toast', message: 'Dev Mode already matches these docs.' };
    return { kind: 'toast', message: ['Nothing to annotate in Dev Mode yet.', ...waiting, ...skipped].join(' ') };
  }
  const sentences = [...changes];
  if (c.aiWritten.length) {
    sentences.push(`Some of the text for ${nameList(c.aiWritten)} was written with AI and nobody has edited it. Confirming is your review.`);
  }
  if (c.edited.length) {
    sentences.push(`Descriptions, links and annotations set or removed in Figma are kept for ${nameList(c.edited)}. You can replace them next.`);
  }
  sentences.push(...waiting, ...skipped);
  if (!plan.fileLinkKnown) {
    sentences.push('To set documentation links too, save this file’s link in Settings, Export.');
  }
  if (c.descriptions || c.cleared) sentences.push('Other files see the descriptions after you publish the library.');
  const one = plan.items.length === 1;
  return {
    kind: 'confirm',
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
    const names = nameList(r.failed.map((f) => f.name));
    const changed = r.components ? ` Changes went into ${plural(r.components, 'component', 'components')}.` : '';
    return { message: `Couldn’t fully annotate ${names}: ${sentence(r.failed[0].message)}${changed}`, error: true };
  }
  if (r.components === 0) {
    return { message: r.held.length ? 'Nothing new to annotate. What was set in Figma is kept.' : 'Dev Mode already matches these docs.' };
  }
  const done = `Annotated ${plural(r.components, 'component', 'components')} in Dev Mode.`;
  const tail = r.descriptions ? ' Publish the library so other files see the descriptions.' : '';
  const category = r.noCategory ? ' Annotations went in without the Spec Layer category.' : '';
  return { message: done + tail + category };
}
