// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTRACTOR_VERSION } from '@spec-layer/extractor';
import type { SerializedNode } from '@spec-layer/extractor';
import type { LibraryEntry } from '../src/messages';
import { generateDescriptions } from '../src/ui/ai';

vi.mock('../src/ui/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/ai')>()),
  generateDescriptions: vi.fn(),
}));

/**
 * Mounts the real UI entry point in happy-dom, plays main-thread replies into
 * `window.onmessage`, and reads what the UI posts back. The Writing view is
 * wired there, so this is the only place its replies can be driven.
 */

type Out = { type: string; [key: string]: unknown };
let outgoing: Out[] = [];
/** Each import of the UI adds document listeners; a later test must not hear an earlier one. */
let listeners: Array<[string, EventListenerOrEventListenerObject]> = [];

/** A component doc whose link records its sections, so its writing state can be known. */
function componentEntry(docId: string, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    docId, kind: 'component', label: 'Button', componentName: 'Button', pageName: 'Components',
    sourceLabel: 'Components · Button', generatedAt: Date.now() - 60_000, sourceNodeId: '10:20',
    sourceExists: true, selfEdited: false, storedContentHash: 'stored', extractorVersion: EXTRACTOR_VERSION,
    unwrittenSections: [], sections: [],
    ...extra,
  };
}

function serializedButton(): SerializedNode {
  return { id: '10:20', name: 'Button', type: 'COMPONENT', visible: true, key: 'k' };
}

function dispatch(pluginMessage: Record<string, unknown>): void {
  const handler = window.onmessage as ((event: MessageEvent) => void) | null;
  handler?.(new MessageEvent('message', { data: { pluginMessage } }));
}

function lastOutgoing(type: string): Out {
  const found = [...outgoing].reverse().find((m) => m.type === type);
  if (!found) throw new Error(`no outgoing ${type}`);
  return found;
}

const count = (t: string): number => outgoing.filter((m) => m.type === t).length;

function click(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function type(selector: string, value: string): void {
  const el = document.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Open Writing on the given docs and return the drift pass id main was asked about. */
async function openWriting(entries: LibraryEntry[] = [componentEntry('doc-1')]): Promise<string> {
  await import('../src/ui/ui-vnext');
  click('[data-view="writing"]');
  dispatch({ type: 'library', entries });
  return lastOutgoing('requestDrift')['passId'] as string;
}

/** One doc's check and its gaps, as main sends them. */
function settle(passId: string, gaps: unknown[], docId = 'doc-1'): void {
  dispatch({ type: 'driftSource', docId, passId, node: serializedButton(), fileKey: 'f' });
  dispatch({ type: 'writingGaps', docId, passId, gaps });
}

const gap = { kind: 'component', id: '10:20', name: 'Button' };
const slot = { kind: 'slot', id: '10:20', propertyName: 'Icon#1:2', name: 'Button / Icon' };
const GAP_KEY = 'component:10:20';
const SLOT_KEY = 'slot:10:20:Icon#1:2';

/** A text styles Foundation doc. */
function foundationEntry(docId = 'doc-f'): LibraryEntry {
  return {
    docId, kind: 'foundation', label: 'Type', componentName: '', pageName: 'Foundations',
    sourceLabel: 'Text styles', generatedAt: Date.now() - 60_000, sourceNodeId: '',
    sourceExists: true, selfEdited: false, storedContentHash: 'f-hash', currentContentHash: 'f-hash',
    extractorVersion: EXTRACTOR_VERSION, foundationScope: { target: 'textStyles' },
  };
}

/** A Foundation dump with one text style, described or not. */
function styleDump(description: string): Record<string, unknown> {
  return {
    fileKey: 'f', collections: [], externals: [], extractedAt: '2026-10-19T00:00:00.000Z', effectStyles: [],
    textStyles: [{
      id: 'S:1', name: 'Body/Medium', description, fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
      lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 }, paragraphSpacing: 0,
      paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE', boundVariables: {},
    }],
  };
}
const STYLE_KEY = 'style:S:1';

/** Copy for AI on a component row, as the Library row menu sends it. */
function startCopy(docId: string): void {
  const button = document.createElement('button');
  button.dataset.libraryAction = 'copy';
  button.dataset.docId = docId;
  document.body.append(button);
  button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  button.remove();
}

const taskKeys = (docId = 'doc-1'): string[] => [...document.querySelectorAll<HTMLElement>(`[data-writing-group="${docId}"] .sl-writing-task`)]
  .map((el) => el.dataset.writingTask ?? '');
const doneKeys = (docId = 'doc-1'): string[] => [...document.querySelectorAll<HTMLElement>(`[data-writing-group="${docId}"] .sl-writing-task.is-done`)]
  .map((el) => el.dataset.writingTask ?? '');
const groupCount = (docId = 'doc-1'): string | null | undefined =>
  document.querySelector(`[data-writing-group="${docId}"] .sl-writing-count`)?.textContent;

beforeEach(() => {
  outgoing = [];
  (globalThis as unknown as { __DRIFT_TIMING__: boolean }).__DRIFT_TIMING__ = false;
  listeners = [];
  const add = document.addEventListener.bind(document) as (t: string, l: EventListenerOrEventListenerObject, o?: unknown) => void;
  vi.spyOn(document, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    listeners.push([type, listener]);
    add(type, listener, options);
  }) as typeof document.addEventListener);
  vi.spyOn(window, 'postMessage').mockImplementation(((message: { pluginMessage: Out }) => {
    outgoing.push(message.pluginMessage);
  }) as typeof window.postMessage);
});

afterEach(() => {
  for (const [type, listener] of listeners) document.removeEventListener(type, listener);
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.mocked(generateDescriptions).mockReset();
  vi.resetModules();
});

describe('Writing view', () => {
  it('asks for the library on arrival, shows loading rows, then the groups', async () => {
    await import('../src/ui/ui-vnext');
    click('[data-view="writing"]');
    expect(count('requestLibrary')).toBe(1);
    expect(document.querySelector('.sl-writing-screen .sl-loading-rows')).not.toBeNull();
    expect(document.querySelector('[data-writing-group]')).toBeNull();
    dispatch({ type: 'library', entries: [componentEntry('doc-1')] });
    const passId = lastOutgoing('requestDrift')['passId'] as string;
    settle(passId, [gap]);
    expect(document.querySelector('.sl-loading-rows')).toBeNull();
    expect(taskKeys()).toEqual([GAP_KEY]);
    expect(groupCount()).toBe('0 of 1 done');
  });

  it('claims nothing to write only once the read succeeded', async () => {
    await import('../src/ui/ui-vnext');
    click('[data-view="writing"]');
    dispatch({ type: 'libraryError', message: 'The library could not be read.' });
    expect(document.querySelector('[data-writing-unknown]')?.textContent).toContain('Some docs could not be read.');
    expect(document.querySelector('.sl-writing-list')?.textContent).not.toContain('Nothing to write');
    click('[data-library-refresh]');
    dispatch({ type: 'library', entries: [] });
    expect(document.querySelector('[data-writing-unknown]')).toBeNull();
    expect(document.querySelector('.sl-writing-list')?.textContent).toContain('Nothing to write');
  });

  it('adds a doc\'s tasks from the current pass and drops a stale one', async () => {
    const passId = await openWriting();
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId: 'stale', gaps: [gap] });
    expect(document.querySelector('[data-writing-group]')).toBeNull();
    settle(passId, [gap]);
    expect(taskKeys()).toEqual([GAP_KEY]);
  });

  it('shows a doc whose check failed without asking for a baseline', async () => {
    const passId = await openWriting();
    dispatch({ type: 'driftError', docId: 'doc-1', passId });
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap] });
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    expect(document.querySelector(`[data-writing-key="${GAP_KEY}"]`)).not.toBeNull();
    expect(count('requestDocBaseline')).toBe(0);
  });

  it('expands one task per group; a second click collapses it', async () => {
    const passId = await openWriting();
    settle(passId, [gap, slot]);
    expect(document.querySelector('.sl-writing-field')).toBeNull();
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    expect(document.querySelector(`[data-writing-key="${GAP_KEY}"]`)).not.toBeNull();
    click(`[data-writing-toggle="${SLOT_KEY}"]`);
    expect(document.querySelector(`[data-writing-key="${GAP_KEY}"]`)).toBeNull();
    expect(document.querySelector(`[data-writing-key="${SLOT_KEY}"]`)).not.toBeNull();
    click(`[data-writing-toggle="${SLOT_KEY}"]`);
    expect(document.querySelector('.sl-writing-field')).toBeNull();
  });

  it('a save sends one write; the reply toasts, clears the draft and checks the row again', async () => {
    const passId = await openWriting();
    settle(passId, [gap]);
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    type(`[data-writing-key="${GAP_KEY}"]`, 'Starts an action.');
    click(`[data-writing-save="${GAP_KEY}"]`);
    expect(lastOutgoing('writeDescriptions')).toEqual({
      type: 'writeDescriptions', docId: 'doc-1',
      items: [{ kind: 'component', id: '10:20', text: 'Starts an action.', origin: 'person' }],
    });
    const drifts = count('requestDrift');
    dispatch({ type: 'descriptionsWritten', docId: 'doc-1', written: [GAP_KEY], failed: [] });
    expect(lastOutgoing('notify')['message']).toBe('1 description written into Figma.');
    expect(count('requestDrift')).toBe(drifts + 1);
    expect(document.querySelector<HTMLInputElement>(`[data-writing-key="${GAP_KEY}"]`)?.value ?? '').toBe('');
  });

  it('marks a written task done once the re-check no longer lists it, sinks it, and moves the count', async () => {
    const passId = await openWriting();
    settle(passId, [gap, slot]);
    expect(groupCount()).toBe('0 of 2 done');
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    type(`[data-writing-key="${GAP_KEY}"]`, 'Starts an action.');
    click(`[data-writing-save="${GAP_KEY}"]`);
    dispatch({ type: 'descriptionsWritten', docId: 'doc-1', written: [GAP_KEY], failed: [] });
    // The re-check is out: the task is not closed on the write's word alone.
    expect(doneKeys()).toEqual([]);
    const next = lastOutgoing('requestDrift')['passId'] as string;
    dispatch({ type: 'driftSource', docId: 'doc-1', passId: next, node: serializedButton(), fileKey: 'f' });
    expect(doneKeys()).toEqual([]);
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId: next, gaps: [slot] });
    expect(taskKeys()).toEqual([SLOT_KEY, GAP_KEY]);
    expect(doneKeys()).toEqual([GAP_KEY]);
    expect(groupCount()).toBe('1 of 2 done');
    // A done task has no body, so the expanded field went with it.
    expect(document.querySelector(`[data-writing-key="${GAP_KEY}"]`)).toBeNull();
  });

  it('closes a saved description of a doc built before the section list', async () => {
    // A 7.0.0 link records no section list.
    const { unwrittenSections: _omitted, ...older } = componentEntry('doc-1');
    const passId = await openWriting([older]);
    settle(passId, [gap]);
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    type(`[data-writing-key="${GAP_KEY}"]`, 'Starts an action.');
    click(`[data-writing-save="${GAP_KEY}"]`);
    dispatch({ type: 'descriptionsWritten', docId: 'doc-1', written: [GAP_KEY], failed: [] });
    settle(lastOutgoing('requestDrift')['passId'] as string, []);
    expect(taskKeys()).toEqual([GAP_KEY]);
    expect(doneKeys()).toEqual([GAP_KEY]);
    expect(groupCount()).toBe('1 of 1 done');
  });

  it('keeps a gap two docs share apart: expanding and closing it under one leaves the other', async () => {
    const passId = await openWriting([componentEntry('doc-1'), componentEntry('doc-2', { label: 'Button copy' })]);
    settle(passId, [gap], 'doc-1');
    settle(passId, [gap], 'doc-2');
    expect(taskKeys('doc-1')).toEqual([GAP_KEY]);
    expect(taskKeys('doc-2')).toEqual([GAP_KEY]);
    click(`[data-writing-group="doc-1"] [data-writing-toggle="${GAP_KEY}"]`);
    expect(document.querySelector(`[data-writing-group="doc-1"] [data-writing-key="${GAP_KEY}"]`)).not.toBeNull();
    expect(document.querySelector(`[data-writing-group="doc-2"] [data-writing-key="${GAP_KEY}"]`)).toBeNull();
    type(`[data-writing-group="doc-1"] [data-writing-key="${GAP_KEY}"]`, 'Starts an action.');
    click(`[data-writing-group="doc-1"] [data-writing-save="${GAP_KEY}"]`);
    expect(lastOutgoing('writeDescriptions')['docId']).toBe('doc-1');
    dispatch({ type: 'descriptionsWritten', docId: 'doc-1', written: [GAP_KEY], failed: [] });
    const next = lastOutgoing('requestDrift');
    expect(next['docId']).toBe('doc-1');
    settle(next['passId'] as string, [], 'doc-1');
    expect(doneKeys('doc-1')).toEqual([GAP_KEY]);
    expect(groupCount('doc-1')).toBe('1 of 1 done');
    expect(doneKeys('doc-2')).toEqual([]);
    expect(taskKeys('doc-2')).toEqual([GAP_KEY]);
    expect(groupCount('doc-2')).toBe('0 of 1 done');
  });

  it('brings a done task back as open when a later pass lists it again', async () => {
    const passId = await openWriting();
    settle(passId, [gap, slot]);
    dispatch({ type: 'descriptionsWritten', docId: 'doc-1', written: [GAP_KEY], failed: [] });
    const next = lastOutgoing('requestDrift')['passId'] as string;
    settle(next, [slot]);
    expect(doneKeys()).toEqual([GAP_KEY]);
    click('[data-library-refresh]');
    dispatch({ type: 'library', entries: [componentEntry('doc-1')] });
    // The rescan cleared the gaps and the check is out: nothing more closes.
    expect(doneKeys()).toEqual([GAP_KEY]);
    const again = lastOutgoing('requestDrift')['passId'] as string;
    settle(again, [gap, slot]);
    expect(doneKeys()).toEqual([]);
    expect(taskKeys()).toEqual([GAP_KEY, SLOT_KEY]);
    expect(groupCount()).toBe('0 of 2 done');
  });

  it('closes a task a refresh no longer lists, once its doc is checked again', async () => {
    const passId = await openWriting();
    settle(passId, [gap, slot]);
    click('[data-library-refresh]');
    dispatch({ type: 'library', entries: [componentEntry('doc-1')] });
    const again = lastOutgoing('requestDrift')['passId'] as string;
    // A failed check knows nothing: the task neither closes nor shows.
    dispatch({ type: 'driftError', docId: 'doc-1', passId: again });
    expect(doneKeys()).toEqual([]);
    click('[data-library-refresh]');
    dispatch({ type: 'library', entries: [componentEntry('doc-1')] });
    settle(lastOutgoing('requestDrift')['passId'] as string, [slot]);
    expect(doneKeys()).toEqual([GAP_KEY]);
    expect(taskKeys()).toEqual([SLOT_KEY, GAP_KEY]);
  });

  it('opens a section in its doc, and Clear draft drops a draft', async () => {
    const passId = await openWriting([componentEntry('doc-1', { unwrittenSections: ['whenToUse'], sections: ['whenToUse'] })]);
    settle(passId, [gap]);
    const sectionKey = 'section:doc-1:whenToUse';
    click(`[data-writing-toggle="${sectionKey}"]`);
    click('[data-writing-open="whenToUse"]');
    expect(lastOutgoing('focusDocSection')).toEqual({ type: 'focusDocSection', docId: 'doc-1', sectionId: 'whenToUse' });
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    type(`[data-writing-key="${GAP_KEY}"]`, 'Starts an action.');
    // The Clear button comes with the next paint after typing.
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    click(`[data-writing-clear="${GAP_KEY}"]`);
    expect(document.querySelector<HTMLInputElement>(`[data-writing-key="${GAP_KEY}"]`)?.value).toBe('');
    click(`[data-writing-save="${GAP_KEY}"]`);
    expect(count('writeDescriptions')).toBe(0);
  });

  it('Draft all makes one call for the group\'s open fields without drafts', async () => {
    vi.mocked(generateDescriptions).mockResolvedValue({ drafts: {} });
    const passId = await openWriting([componentEntry('doc-1', { unwrittenSections: ['whenToUse'], sections: ['whenToUse'] })]);
    settle(passId, [gap, slot]);
    click(`[data-writing-toggle="${SLOT_KEY}"]`);
    type(`[data-writing-key="${SLOT_KEY}"]`, 'Mine.');
    click('[data-writing-draft-all]');
    await new Promise((r) => setTimeout(r, 0));
    expect(generateDescriptions).toHaveBeenCalledTimes(1);
    const items = vi.mocked(generateDescriptions).mock.calls[0]?.[0].items ?? [];
    expect(items.map((i) => i.key)).toEqual([GAP_KEY]);
  });

  it('keeps text typed while Draft all was out', async () => {
    let resolve: (answers: { drafts: Record<string, string>; error?: unknown }) => void = () => {};
    vi.mocked(generateDescriptions).mockReturnValue(new Promise((r) => { resolve = r; }));
    const passId = await openWriting();
    settle(passId, [gap]);
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    click('[data-writing-draft-all]');
    type(`[data-writing-key="${GAP_KEY}"]`, 'Mine.');
    resolve({ drafts: { [GAP_KEY]: 'From the model.' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector<HTMLInputElement>(`[data-writing-key="${GAP_KEY}"]`)?.value).toBe('Mine.');
    click(`[data-writing-save="${GAP_KEY}"]`);
    expect(lastOutgoing('writeDescriptions')['items']).toEqual([
      { kind: 'component', id: '10:20', text: 'Mine.', origin: 'person' },
    ]);
  });

  it('lands the drafts that came back before a batch failed, and names the failure', async () => {
    // The UI is imported fresh per test, so the error class comes from the same module graph.
    const { ProseProxyError } = await import('@spec-layer/extractor');
    vi.mocked(generateDescriptions).mockResolvedValue({
      drafts: { [GAP_KEY]: 'Starts an action.' },
      error: new ProseProxyError('quota_exhausted', '2026-11-01T00:00:00Z'),
    });
    const passId = await openWriting();
    settle(passId, [gap, slot]);
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    click('[data-writing-draft-all]');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector<HTMLInputElement>(`[data-writing-key="${GAP_KEY}"]`)?.value).toBe('Starts an action.');
    const notes = outgoing.filter((m) => m.type === 'notify').map((m) => m['message'] as string);
    expect(notes.some((n) => /AI writing uses this month/.test(n))).toBe(true);
    expect(notes.some((n) => n.startsWith('No draft came back'))).toBe(false);
  });

  it('keeps the older Checked stamp after one row is checked again', async () => {
    const now = vi.spyOn(Date, 'now');
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    const passId = await openWriting();
    dispatch({ type: 'driftError', docId: 'doc-1', passId });
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap] });
    expect(document.querySelector('.sl-library-check-label')?.textContent).toBe('Checked just now');
    now.mockReturnValue(t0 + 2 * 60 * 60_000);
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    type(`[data-writing-key="${GAP_KEY}"]`, 'Starts an action.');
    click(`[data-writing-save="${GAP_KEY}"]`);
    dispatch({ type: 'descriptionsWritten', docId: 'doc-1', written: [GAP_KEY], failed: [] });
    const next = lastOutgoing('requestDrift')['passId'] as string;
    dispatch({ type: 'driftError', docId: 'doc-1', passId: next });
    expect(document.querySelector('.sl-library-check-label')?.textContent).toMatch(/^Checked at /);
  });

  it('a Foundation save reads the Foundation and the list once and leaves settled component docs alone', async () => {
    const foundation: LibraryEntry = {
      docId: 'doc-f', kind: 'foundation', label: 'Type', componentName: '', pageName: 'Foundations',
      sourceLabel: 'Text styles', generatedAt: Date.now() - 60_000, sourceNodeId: '',
      sourceExists: true, selfEdited: false, storedContentHash: 'f-hash', currentContentHash: 'f-hash',
      extractorVersion: EXTRACTOR_VERSION, foundationScope: { target: 'textStyles' },
    };
    const entries = [componentEntry('doc-1'), foundation];
    const passId = await openWriting(entries);
    const textStyle = {
      id: 'S:1', name: 'Body/Medium', description: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
      lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 }, paragraphSpacing: 0,
      paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE', boundVariables: {},
    };
    const dump = (description: string) => ({
      fileKey: 'f', collections: [], externals: [], extractedAt: '2026-10-19T00:00:00.000Z', effectStyles: [],
      textStyles: [{ ...textStyle, description }],
    });
    dispatch({ type: 'foundation', dump: dump('') });
    settle(passId, [gap]);
    expect(taskKeys('doc-f')).toEqual(['style:S:1']);
    expect(taskKeys('doc-1')).toEqual([GAP_KEY]);

    const before = { foundation: count('requestFoundation'), library: count('requestLibrary'), drift: count('requestDrift') };
    dispatch({ type: 'descriptionsWritten', docId: 'doc-f', written: ['style:S:1'], failed: [] });
    expect(count('requestFoundation')).toBe(before.foundation + 1);
    expect(count('requestLibrary')).toBe(before.library + 1);

    // The rescan lands: the component doc keeps its check and its gaps.
    dispatch({ type: 'library', entries });
    expect(count('requestDrift')).toBe(before.drift);
    expect(taskKeys('doc-1')).toEqual([GAP_KEY]);
    expect(doneKeys('doc-1')).toEqual([]);

    // The Foundation reads again with the description filled: its task is done.
    dispatch({ type: 'foundation', dump: dump('Body copy.') });
    expect(doneKeys('doc-f')).toEqual(['style:S:1']);
  });

  it('holds the writes while a Copy run is out, and a Foundation save landing then reads only the Foundation', async () => {
    const passId = await openWriting([componentEntry('doc-1'), foundationEntry()]);
    dispatch({ type: 'foundation', dump: styleDump('') });
    settle(passId, [gap]);
    click(`[data-writing-group="doc-1"] [data-writing-toggle="${GAP_KEY}"]`);
    type(`[data-writing-key="${GAP_KEY}"]`, 'Starts an action.');
    startCopy('doc-1');
    expect(count('requestDocProse')).toBe(1);
    const field = document.querySelector<HTMLInputElement>(`[data-writing-key="${GAP_KEY}"]`);
    expect(field?.disabled).toBe(false);
    expect(field?.value).toBe('Starts an action.');
    expect(document.querySelector<HTMLButtonElement>(`[data-writing-save="${GAP_KEY}"]`)?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(`[data-writing-clear="${GAP_KEY}"]`)?.disabled).toBe(true);
    click(`[data-writing-save="${GAP_KEY}"]`);
    expect(count('writeDescriptions')).toBe(0);

    // A Foundation save sent before the run began lands in the middle of it.
    const before = { foundation: count('requestFoundation'), library: count('requestLibrary') };
    dispatch({ type: 'descriptionsWritten', docId: 'doc-f', written: [STYLE_KEY], failed: [] });
    expect(count('requestFoundation')).toBe(before.foundation + 1);
    expect(count('requestLibrary')).toBe(before.library);
  });

  it('a Foundation save landing during a refresh reads only the Foundation and leaves the refresh its own carry', async () => {
    const passId = await openWriting([componentEntry('doc-1'), foundationEntry()]);
    dispatch({ type: 'foundation', dump: styleDump('') });
    settle(passId, [gap]);
    click('[data-library-refresh]');
    const before = { foundation: count('requestFoundation'), library: count('requestLibrary'), drift: count('requestDrift') };
    dispatch({ type: 'descriptionsWritten', docId: 'doc-f', written: [STYLE_KEY], failed: [] });
    expect(count('requestFoundation')).toBe(before.foundation + 1);
    expect(count('requestLibrary')).toBe(before.library);
    // The refresh's reply carries nothing, so the component doc is checked again.
    dispatch({ type: 'library', entries: [componentEntry('doc-1'), foundationEntry()] });
    expect(count('requestDrift')).toBe(before.drift + 1);
  });

  it('a save that wrote nothing reads nothing again', async () => {
    await openWriting();
    const before = { foundation: count('requestFoundation'), library: count('requestLibrary'), drift: count('requestDrift') };
    dispatch({ type: 'descriptionsWritten', docId: 'doc-1', written: [], failed: [{ key: GAP_KEY, message: 'That component is no longer in this file.' }] });
    expect(count('requestFoundation')).toBe(before.foundation);
    expect(count('requestLibrary')).toBe(before.library);
    expect(count('requestDrift')).toBe(before.drift);
  });

  it('keeps the gaps of a check in flight across a resume', async () => {
    const passId = await openWriting();
    click('[data-view="component"]');
    click('[data-view="writing"]');
    dispatch({ type: 'libraryUnchanged' });
    settle(passId, [gap]);
    expect(taskKeys()).toEqual([GAP_KEY]);
  });

  it('leaves no writing pieces in the Library', async () => {
    const passId = await openWriting();
    settle(passId, [gap]);
    click(`[data-writing-toggle="${GAP_KEY}"]`);
    expect(document.querySelector('.sl-writing-field')).not.toBeNull();
    click('[data-view="library"]');
    dispatch({ type: 'libraryUnchanged' });
    expect(document.querySelector('.sl-library-screen, .sl-library-list, .sl-library-row')).not.toBeNull();
    expect(document.querySelector('.sl-writing-field')).toBeNull();
    expect(document.querySelector('[data-writing-group]')).toBeNull();
    expect(document.querySelector('[data-library-filter="writing"]')).toBeNull();
  });
});
