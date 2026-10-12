import { describe, it, expect } from 'vitest';
import { planNext, replaceDialog, resultToast, nameList } from '../src/ui/syncDialog';
import type { SyncPlanItem } from '../src/syncPlan';
import type { SyncResult } from '../src/syncFigma';

function item(name: string, over: Partial<SyncPlanItem> = {}): SyncPlanItem {
  return {
    docId: `d-${name}`, nodeId: `n-${name}`, name,
    description: { action: 'write', origin: 'authored' },
    link: { action: 'write' },
    layers: [{ nodeId: 'l', action: 'write', proposed: { label: '', properties: [] }, proposedHash: 'p', ownIndex: -1 }],
    orphans: [],
    updateFirst: false,
    ...over,
  };
}
const SAME = { description: { action: 'same' as const }, link: { action: 'same' as const }, layers: [] };
const ALL = { kind: 'all' } as const;
const DOC = { kind: 'doc', docId: 'd-Input' } as const;
const RESULT: SyncResult = {
  descriptions: 1, links: 1, annotations: 2, removed: 0, components: 1, failed: [], noCategory: false, held: [], heldAi: [], heldNew: [],
};

describe('planNext', () => {
  it('asks before writing, naming what it writes', () => {
    const next = planNext({ items: [item('Button')], skipped: [], fileLinkKnown: true }, ALL);
    expect(next.kind).toBe('confirm');
    if (next.kind !== 'confirm') return;
    expect(next.dialog.title).toBe('Annotate Button in Dev Mode?');
    // Publishing is said by the result toast, once something was written.
    expect(next.dialog.body).toBe('This writes 1 description, 1 annotation and 1 documentation link.');
    expect(next.dialog.notes).toEqual([]);
    expect(next.dialog.confirmLabel).toBe('Annotate');
  });

  it('flags AI text, kept values and a missing file link', () => {
    const next = planNext({
      items: [
        item('Button', { description: { action: 'write', origin: 'mixed' }, link: { action: 'skip', reason: 'noFileLink' } }),
        item('Input', { description: { action: 'keep', reason: 'writtenBeforeSync' }, link: { action: 'skip', reason: 'noFileLink' } }),
      ],
      skipped: [], fileLinkKnown: false }, ALL);
    if (next.kind !== 'confirm') throw new Error(next.kind);
    expect(next.dialog.title).toBe('Annotate 2 components in Dev Mode?');
    expect(next.dialog.body).toBe('This writes 1 description and 2 annotations.');
    // Most important first: the AI text to read, then what stays, then setup.
    expect(next.dialog.notes).toEqual([
      'The description for Button includes text written with AI that nobody has edited. Read it in the doc before you annotate.',
      'Input keeps the changes made in Figma to its description. You can replace them after this.',
      'To add documentation links too, save this file’s link in Settings, on the Export tab.',
    ]);
  });

  it('names only the kinds of value kept, across components', () => {
    const next = planNext({
      items: [
        item('Button'),
        item('Input', { link: { action: 'keep', reason: 'editedInFigma' } }),
        item('Card', { layers: [{ nodeId: 'l', action: 'keep', reason: 'editedInFigma', proposed: { label: '', properties: [] }, proposedHash: 'p', ownIndex: 0 }] }),
      ],
      skipped: [], fileLinkKnown: true }, ALL);
    if (next.kind !== 'confirm') throw new Error(next.kind);
    expect(next.dialog.notes).toEqual([
      'Input and Card keep the changes made in Figma to their links and annotations. You can replace them after this.',
    ]);
  });

  it('names what it clears and removes', () => {
    const next = planNext({
      items: [item('Button', {
        description: { action: 'clear' }, link: { action: 'same' },
        orphans: [{ nodeId: 'x', action: 'remove', ownIndex: 0 }, { nodeId: 'y', action: 'drop', ownIndex: -1 }],
      })],
      skipped: [], fileLinkKnown: true }, ALL);
    if (next.kind !== 'confirm') throw new Error(next.kind);
    expect(next.dialog.body).toBe(
      'This writes 1 annotation. It clears 1 description whose doc no longer has Usage text. ' +
      'It removes 1 annotation from a part the doc no longer numbers.',
    );
  });

  it('says which docs need an Update before their parts are annotated', () => {
    const waiting = item('Card', { ...SAME, updateFirst: true });
    const next = planNext({ items: [item('Button'), waiting], skipped: [], fileLinkKnown: true }, ALL);
    if (next.kind !== 'confirm') throw new Error(next.kind);
    expect(next.dialog.notes).toContain('Update the doc for Card first to annotate its parts.');
    expect(planNext({ items: [waiting], skipped: [], fileLinkKnown: true }, ALL))
      .toEqual({ kind: 'toast', message: 'Nothing to annotate in Dev Mode yet. Update the doc for Card first to annotate its parts.' });
  });

  it('names skipped docs by reason', () => {
    const next = planNext({
      items: [item('Button')],
      skipped: [
        { name: 'Card', reason: 'rebuildNeeded' }, { name: 'Chip', reason: 'rebuildNeeded' },
        { name: 'Old: Documentation', reason: 'sourceMissing' },
        { name: 'Tag', reason: 'recordUnreadable' },
        { name: 'Menu', reason: 'unreadable', message: 'boom' },
      ],
      fileLinkKnown: true }, ALL);
    if (next.kind !== 'confirm') throw new Error(next.kind);
    expect(next.dialog.notes).toEqual([
      'Card and Chip need a rebuild first.',
      'Old: Documentation has no source component in this file.',
      'Tag has an annotation record this version can’t read, so it’s left alone.',
      'Couldn’t read Menu (boom).',
    ]);
  });

  it('offers Replace from a row when only kept values remain, saying nothing is new first', () => {
    const next = planNext({
      items: [item('Input', { description: { action: 'keep', reason: 'editedInFigma', origin: 'ai' }, link: { action: 'same' }, layers: [] })],
      skipped: [], fileLinkKnown: true }, DOC);
    if (next.kind !== 'replace') throw new Error(next.kind);
    expect(next.dialog.body).toBe(
      'Nothing new to annotate. Input has changes made in Figma to its description. Replacing writes the doc’s text over them.',
    );
    expect(next.dialog.notes).toEqual([
      'The description for Input includes text written with AI that nobody has edited. Read it in the doc before you replace.',
      'A replaced description makes its doc show Update available.',
      'You can undo this right after.',
    ]);
  });

  it('names kept values in a toast for a run over every component', () => {
    const kept = (name: string): SyncPlanItem =>
      item(name, { description: { action: 'keep', reason: 'writtenBeforeSync', origin: 'authored' }, link: { action: 'same' }, layers: [] });
    expect(planNext({ items: [kept('Input')], skipped: [], fileLinkKnown: true }, ALL)).toEqual({
      kind: 'toast',
      message: 'Nothing new to annotate. What was set in Figma is kept for Input. To replace it, annotate the component from its Library row.',
    });
    expect(planNext({ items: [kept('Input'), kept('Card')], skipped: [], fileLinkKnown: true }, ALL)).toEqual({
      kind: 'toast',
      message: 'Nothing new to annotate. What was set in Figma is kept for Input and Card. To replace them, annotate each component from its Library row.',
    });
  });

  it('says so when there is nothing to write or nothing to annotate', () => {
    expect(planNext({ items: [item('Button', SAME)], skipped: [], fileLinkKnown: true }, ALL))
      .toEqual({ kind: 'toast', message: 'Dev Mode already matches these docs.' });
    expect(planNext({ items: [], skipped: [{ name: 'B', reason: 'rebuildNeeded' }], fileLinkKnown: true }, ALL))
      .toEqual({ kind: 'toast', message: 'Rebuild this doc first, then annotate it in Dev Mode.' });
    expect(planNext({ items: [], skipped: [{ name: 'B', reason: 'rebuildNeeded' }, { name: 'C', reason: 'rebuildNeeded' }], fileLinkKnown: true }, ALL))
      .toEqual({ kind: 'toast', message: 'Rebuild these docs first, then annotate them in Dev Mode.' });
    expect(planNext({ items: [], skipped: [{ name: 'Old: Documentation', reason: 'sourceMissing' }], fileLinkKnown: true }, ALL))
      .toEqual({ kind: 'toast', message: 'Nothing to annotate in Dev Mode yet. Old: Documentation has no source component in this file.' });
    expect(planNext({ items: [], skipped: [], fileLinkKnown: true }, ALL))
      .toEqual({ kind: 'toast', message: 'There are no component docs to annotate in this file.' });
  });
});

describe('words', () => {
  it('lists names compactly', () => {
    expect(nameList(['A'])).toBe('A');
    expect(nameList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
  });

  it('marks the replace step as destructive, and claims only an undo made right after', () => {
    const d = replaceDialog(['Input']);
    expect(d).toMatchObject({ title: 'Replace changes made in Figma?', confirmLabel: 'Replace', tone: 'danger' });
    // After a run the kinds are not known, so all three are named, joined by or.
    expect(d.body).toBe('Input has changes made in Figma to its description, link or annotations. Replacing writes the doc’s text over them.');
    expect(d.notes).toEqual(['A replaced description makes its doc show Update available.', 'You can undo this right after.']);
    const two = replaceDialog(['Input', 'Card'], ['Card']);
    expect(two.body).toMatch(/^Input and Card have changes made in Figma to their descriptions, links or annotations\./);
    expect(two.notes?.[0]).toBe('The description for Card includes text written with AI that nobody has edited. Read it in the doc before you replace.');
    // A kept link alone never mentions Update available.
    expect(replaceDialog(['Input'], [], undefined, { description: false, link: true, annotations: false }).notes)
      .toEqual(['You can undo this right after.']);
  });

  it('reports results, failures first', () => {
    expect(resultToast(RESULT).message).toBe('Annotated 1 component in Dev Mode. Publish the library so other files see the descriptions.');
    expect(resultToast({ ...RESULT, components: 0 }).message).toBe('Dev Mode already matches these docs.');
    expect(resultToast({ ...RESULT, components: 0, held: ['Input'] }).message).toBe('Nothing new to annotate. What was set in Figma is kept.');
    expect(resultToast({ ...RESULT, components: 0, failed: [{ name: 'Button', message: 'Nope' }] }))
      .toEqual({ message: 'Couldn’t fully annotate Button: Nope.', error: true });
    expect(resultToast({ ...RESULT, components: 3, failed: [{ name: 'Button', message: 'Nope.' }, { name: 'Card', message: 'Other' }] }))
      .toEqual({ message: 'Couldn’t fully annotate Button and Card: Nope. Changes went into 3 components.', error: true });
    expect(resultToast({ ...RESULT, descriptions: 0, noCategory: true }).message).toBe('Annotated 1 component in Dev Mode. Annotations went in without the Spec Layer category.');
  });

  it('never uses an em or en dash', () => {
    const texts = [
      JSON.stringify(planNext({
        items: [item('A', { description: { action: 'write', origin: 'ai' }, updateFirst: true, orphans: [{ nodeId: 'x', action: 'remove', ownIndex: 0 }] }),
          item('B', { description: { action: 'keep', reason: 'editedInFigma', origin: 'ai' } })],
        skipped: [{ name: 'C', reason: 'recordUnreadable' }, { name: 'D', reason: 'unreadable', message: 'm' }], fileLinkKnown: false }, ALL)),
      JSON.stringify(replaceDialog(['A'], ['A'])), resultToast(RESULT).message,
      resultToast({ ...RESULT, failed: [{ name: 'A', message: 'm' }] }).message,
    ];
    for (const t of texts) expect(t).not.toMatch(/[—–]/);
  });
});
