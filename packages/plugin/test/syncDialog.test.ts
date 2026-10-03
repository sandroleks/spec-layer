import { describe, it, expect } from 'vitest';
import { planNext, replaceDialog, resultToast, nameList } from '../src/ui/syncDialog';
import type { SyncPlanItem } from '../src/syncPlan';
import type { SyncResult } from '../src/syncFigma';

function item(name: string, over: Partial<SyncPlanItem> = {}): SyncPlanItem {
  return {
    docId: `d-${name}`, nodeId: `n-${name}`, name,
    description: { action: 'write', origin: 'authored' },
    link: { action: 'write' },
    layers: [{ nodeId: 'l', action: 'write', proposed: { label: '', properties: [] }, ownIndex: -1 }],
    ...over,
  };
}
const RESULT: SyncResult = { descriptions: 1, links: 1, annotations: 2, components: 1, failed: [], noCategory: false, held: [] };

describe('planNext', () => {
  it('asks before writing, naming what it writes', () => {
    const next = planNext({ items: [item('Button')], skipped: [], fileLinkKnown: true });
    expect(next).toMatchObject({ kind: 'confirm', edited: [] });
    if (next.kind !== 'confirm') return;
    expect(next.dialog.title).toBe('Annotate Button in Dev Mode?');
    expect(next.dialog.body).toBe(
      'This writes 1 description, 1 annotation and 1 documentation link. ' +
      'Other files see the descriptions after you publish the library.',
    );
    expect(next.dialog.confirmLabel).toBe('Annotate');
  });

  it('flags AI text, kept edits and a missing file link', () => {
    const next = planNext({
      items: [
        item('Button', { description: { action: 'write', origin: 'ai' }, link: { action: 'skip', reason: 'noFileLink' } }),
        item('Input', { description: { action: 'keep', reason: 'editedInFigma' }, link: { action: 'skip', reason: 'noFileLink' } }),
      ],
      skipped: [], fileLinkKnown: false,
    });
    if (next.kind !== 'confirm') throw new Error(next.kind);
    expect(next.dialog.title).toBe('Annotate 2 components in Dev Mode?');
    expect(next.dialog.body).toContain('Written with AI and not yet edited: Button. Confirming is your review.');
    expect(next.dialog.body).toContain('Edits made in Figma are kept for Input. You can replace them next.');
    expect(next.dialog.body).toContain('save this file’s link in Settings, Export.');
    expect(next.edited).toEqual(['Input']);
  });

  it('goes straight to the replace step when only edits remain', () => {
    const next = planNext({
      items: [item('Input', { description: { action: 'keep', reason: 'editedInFigma' }, link: { action: 'same' }, layers: [] })],
      skipped: [], fileLinkKnown: true,
    });
    expect(next.kind).toBe('replace');
  });

  it('says so when there is nothing to write or nothing to sync', () => {
    const same = item('Button', { description: { action: 'same' }, link: { action: 'same' }, layers: [] });
    expect(planNext({ items: [same], skipped: [], fileLinkKnown: true })).toEqual({ kind: 'toast', message: 'Dev Mode already matches these docs.' });
    expect(planNext({ items: [], skipped: [{ name: 'B', reason: 'rebuildNeeded' }], fileLinkKnown: true }))
      .toEqual({ kind: 'toast', message: 'Rebuild this doc first, then annotate it in Dev Mode.' });
    expect(planNext({ items: [], skipped: [], fileLinkKnown: true }).kind).toBe('toast');
  });
});

describe('words', () => {
  it('lists names compactly', () => {
    expect(nameList(['A'])).toBe('A');
    expect(nameList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
  });

  it('marks the replace step as destructive and undoable', () => {
    const d = replaceDialog(['Input']);
    expect(d).toMatchObject({ title: 'Replace edits made in Figma?', confirmLabel: 'Replace', tone: 'danger' });
    expect(d.body).toContain('Undo puts it back.');
  });

  it('reports results, failures first', () => {
    expect(resultToast(RESULT).message).toBe('Annotated 1 component in Dev Mode. Publish the library so other files see the descriptions.');
    expect(resultToast({ ...RESULT, components: 0 }).message).toBe('Dev Mode already matches these docs.');
    expect(resultToast({ ...RESULT, failed: [{ name: 'Button', message: 'Nope' }] })).toEqual({ message: 'Couldn’t annotate Button: Nope', error: true });
    expect(resultToast({ ...RESULT, descriptions: 0, noCategory: true }).message).toBe('Annotated 1 component in Dev Mode. Annotations went in without the Spec Layer category.');
  });

  it('never uses an em dash', () => {
    const texts = [
      JSON.stringify(planNext({ items: [item('A', { description: { action: 'write', origin: 'ai' } })], skipped: [], fileLinkKnown: false })),
      JSON.stringify(replaceDialog(['A'])), resultToast(RESULT).message,
    ];
    for (const t of texts) expect(t).not.toMatch(/—/);
  });
});
