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
 * `window.onmessage`, and reads what the UI posts back. The Library's writing
 * list is wired there, so this is the only place its replies can be driven.
 */

type Out = { type: string; [key: string]: unknown };
let outgoing: Out[] = [];
/** Each import of the UI adds document listeners; a later test must not hear an earlier one. */
let listeners: Array<[string, EventListenerOrEventListenerObject]> = [];

function componentEntry(docId: string): LibraryEntry {
  return {
    docId, kind: 'component', label: 'Button', componentName: 'Button', pageName: 'Components',
    sourceLabel: 'Components · Button', generatedAt: Date.now() - 60_000, sourceNodeId: '10:20',
    sourceExists: true, selfEdited: false, storedContentHash: 'stored', extractorVersion: EXTRACTOR_VERSION,
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

/** Open the Library on one component doc and return the drift pass id main was asked about. */
async function openLibrary(): Promise<string> {
  await import('../src/ui/ui-vnext');
  click('[data-view="library"]');
  dispatch({ type: 'library', entries: [componentEntry('doc-1')] });
  return lastOutgoing('requestDrift')['passId'] as string;
}

const gap = { kind: 'component', id: '10:20', name: 'Button' };

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
  vi.resetModules();
});

describe('Library writing replies', () => {
  it('stores component gaps from the current pass and shows the summary line', async () => {
    const passId = await openLibrary();
    dispatch({ type: 'driftSource', docId: 'doc-1', passId, node: serializedButton(), fileKey: 'f' });
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap] });
    expect(document.querySelector('.sl-library-writing-summary')?.textContent).toBe('1 description to write');
  });

  it('drops gaps from a pass that is not current', async () => {
    await openLibrary();
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId: 'stale', gaps: [gap] });
    expect(document.querySelector('.sl-library-writing-summary')).toBeNull();
  });

  it('opens a writing-only row without asking for a baseline', async () => {
    const passId = await openLibrary();
    // A failed check reads unavailable, so the row has nothing to compare.
    dispatch({ type: 'driftError', docId: 'doc-1', passId });
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap] });
    click('[data-library-disclosure="doc-1"]');
    expect(document.querySelector('[data-writing-key]')).not.toBeNull();
    expect(outgoing.some((m) => m.type === 'requestDocBaseline')).toBe(false);
  });

  it('a save sends one write; the reply toasts, clears the draft and checks the row again', async () => {
    const passId = await openLibrary();
    dispatch({ type: 'driftSource', docId: 'doc-1', passId, node: serializedButton(), fileKey: 'f' });
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap] });
    click('[data-library-disclosure="doc-1"]');
    type('[data-writing-key="component:10:20"]', 'Starts an action.');
    click('[data-writing-save="component:10:20"]');
    expect(lastOutgoing('writeDescriptions')).toEqual({
      type: 'writeDescriptions', docId: 'doc-1',
      items: [{ kind: 'component', id: '10:20', text: 'Starts an action.', origin: 'person' }],
    });
    const drifts = outgoing.filter((m) => m.type === 'requestDrift').length;
    dispatch({ type: 'descriptionsWritten', docId: 'doc-1', written: ['component:10:20'], failed: [] });
    expect(lastOutgoing('notify')['message']).toBe('1 description written into Figma.');
    expect(outgoing.filter((m) => m.type === 'requestDrift').length).toBe(drifts + 1);
    expect(document.querySelector<HTMLInputElement>('[data-writing-key="component:10:20"]')?.value ?? '').toBe('');
  });

  it('asks for the open row\'s change list again after a write re-checks it', async () => {
    const passId = await openLibrary();
    dispatch({ type: 'driftSource', docId: 'doc-1', passId, node: serializedButton(), fileKey: 'f' });
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap] });
    click('[data-library-disclosure="doc-1"]');
    const baselines = () => outgoing.filter((m) => m.type === 'requestDocBaseline').length;
    expect(baselines()).toBe(1);
    type('[data-writing-key="component:10:20"]', 'Starts an action.');
    click('[data-writing-save="component:10:20"]');
    dispatch({ type: 'descriptionsWritten', docId: 'doc-1', written: ['component:10:20'], failed: [] });
    const next = lastOutgoing('requestDrift')['passId'] as string;
    dispatch({ type: 'driftSource', docId: 'doc-1', passId: next, node: serializedButton(), fileKey: 'f' });
    expect(baselines()).toBe(2);
  });

  it('keeps the older Checked stamp after one row is checked again', async () => {
    const now = vi.spyOn(Date, 'now');
    const t0 = 1_800_000_000_000;
    now.mockReturnValue(t0);
    const passId = await openLibrary();
    dispatch({ type: 'driftError', docId: 'doc-1', passId });
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap] });
    expect(document.querySelector('.sl-library-check-label')?.textContent).toBe('Checked just now');
    now.mockReturnValue(t0 + 2 * 60 * 60_000);
    click('[data-library-disclosure="doc-1"]');
    type('[data-writing-key="component:10:20"]', 'Starts an action.');
    click('[data-writing-save="component:10:20"]');
    dispatch({ type: 'descriptionsWritten', docId: 'doc-1', written: ['component:10:20'], failed: [] });
    const next = lastOutgoing('requestDrift')['passId'] as string;
    dispatch({ type: 'driftError', docId: 'doc-1', passId: next });
    expect(document.querySelector('.sl-library-check-label')?.textContent).toMatch(/^Checked at /);
  });

  it('keeps text typed while Draft all was out', async () => {
    let resolve: (answers: { drafts: Record<string, string>; error?: unknown }) => void = () => {};
    vi.mocked(generateDescriptions).mockReturnValue(new Promise((r) => { resolve = r; }));
    const passId = await openLibrary();
    dispatch({ type: 'driftSource', docId: 'doc-1', passId, node: serializedButton(), fileKey: 'f' });
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap] });
    click('[data-library-disclosure="doc-1"]');
    click('[data-writing-draft-all]');
    type('[data-writing-key="component:10:20"]', 'Mine.');
    resolve({ drafts: { 'component:10:20': 'From the model.' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector<HTMLInputElement>('[data-writing-key="component:10:20"]')?.value).toBe('Mine.');
    click('[data-writing-save="component:10:20"]');
    expect(lastOutgoing('writeDescriptions')['items']).toEqual([
      { kind: 'component', id: '10:20', text: 'Mine.', origin: 'person' },
    ]);
  });

  it('lands the drafts that came back before a batch failed, and names the failure', async () => {
    // The UI is imported fresh per test, so the error class comes from the same module graph.
    const { ProseProxyError } = await import('@spec-layer/extractor');
    vi.mocked(generateDescriptions).mockResolvedValue({
      drafts: { 'component:10:20': 'Starts an action.' },
      error: new ProseProxyError('quota_exhausted', '2026-11-01T00:00:00Z'),
    });
    const passId = await openLibrary();
    dispatch({ type: 'driftSource', docId: 'doc-1', passId, node: serializedButton(), fileKey: 'f' });
    const slot = { kind: 'slot', id: '10:20', propertyName: 'Icon#1:2', name: 'Button / Icon' };
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap, slot] });
    click('[data-library-disclosure="doc-1"]');
    click('[data-writing-draft-all]');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector<HTMLInputElement>('[data-writing-key="component:10:20"]')?.value).toBe('Starts an action.');
    const notes = outgoing.filter((m) => m.type === 'notify').map((m) => m['message'] as string);
    expect(notes.some((n) => /AI writing uses this month/.test(n))).toBe(true);
    expect(notes.some((n) => n.startsWith('No draft came back'))).toBe(false);
  });

  it('a Foundation save reads the Foundation and the list once and leaves settled component rows alone', async () => {
    const foundation: LibraryEntry = {
      docId: 'doc-f', kind: 'foundation', label: 'Type', componentName: '', pageName: 'Foundations',
      sourceLabel: 'Text styles', generatedAt: Date.now() - 60_000, sourceNodeId: '',
      sourceExists: true, selfEdited: false, storedContentHash: 'f-hash', currentContentHash: 'f-hash',
      extractorVersion: EXTRACTOR_VERSION, foundationScope: { target: 'textStyles' },
    };
    const entries = [componentEntry('doc-1'), foundation];
    await import('../src/ui/ui-vnext');
    click('[data-view="library"]');
    dispatch({ type: 'library', entries });
    const passId = lastOutgoing('requestDrift')['passId'] as string;
    dispatch({
      type: 'foundation',
      dump: {
        fileKey: 'f', collections: [], externals: [], extractedAt: '2026-10-19T00:00:00.000Z', effectStyles: [],
        textStyles: [{
          id: 'S:1', name: 'Body/Medium', description: '', fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
          lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 }, paragraphSpacing: 0,
          paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE', boundVariables: {},
        }],
      },
    });
    dispatch({ type: 'driftSource', docId: 'doc-1', passId, node: serializedButton(), fileKey: 'f' });
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap] });
    const status = (docId: string) => document
      .querySelector(`.sl-library-row[data-doc-id="${docId}"] [data-library-status]`)?.getAttribute('data-library-status');
    const settled = status('doc-1');
    expect(settled).not.toBe('pending');
    expect(document.querySelector('.sl-library-row[data-doc-id="doc-f"] .sl-library-writing-summary')?.textContent)
      .toBe('1 description to write');

    const count = (t: string) => outgoing.filter((m) => m.type === t).length;
    const before = { foundation: count('requestFoundation'), library: count('requestLibrary'), drift: count('requestDrift') };
    dispatch({ type: 'descriptionsWritten', docId: 'doc-f', written: ['style:S:1'], failed: [] });
    expect(count('requestFoundation')).toBe(before.foundation + 1);
    expect(count('requestLibrary')).toBe(before.library + 1);

    // The rescan lands: the component row keeps its check and its gaps.
    dispatch({ type: 'library', entries });
    expect(count('requestDrift')).toBe(before.drift);
    expect(status('doc-1')).toBe(settled);
    expect(document.querySelector('.sl-library-row[data-doc-id="doc-1"] .sl-library-writing-summary')?.textContent)
      .toBe('1 description to write');
  });

  it('a save that wrote nothing reads nothing again', async () => {
    await openLibrary();
    const count = (t: string) => outgoing.filter((m) => m.type === t).length;
    const before = { foundation: count('requestFoundation'), library: count('requestLibrary'), drift: count('requestDrift') };
    dispatch({ type: 'descriptionsWritten', docId: 'doc-1', written: [], failed: [{ key: 'component:10:20', message: 'That component is no longer in this file.' }] });
    expect(count('requestFoundation')).toBe(before.foundation);
    expect(count('requestLibrary')).toBe(before.library);
    expect(count('requestDrift')).toBe(before.drift);
  });

  it('keeps the gaps of a check in flight across a resume', async () => {
    const passId = await openLibrary();
    click('[data-view="component"]');
    click('[data-view="library"]');
    dispatch({ type: 'libraryUnchanged' });
    dispatch({ type: 'driftSource', docId: 'doc-1', passId, node: serializedButton(), fileKey: 'f' });
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap] });
    expect(document.querySelector('.sl-library-writing-summary')?.textContent).toBe('1 description to write');
  });
});
