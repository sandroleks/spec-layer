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
    let resolve: (answers: Record<string, string>) => void = () => {};
    vi.mocked(generateDescriptions).mockReturnValue(new Promise((r) => { resolve = r; }));
    const passId = await openLibrary();
    dispatch({ type: 'driftSource', docId: 'doc-1', passId, node: serializedButton(), fileKey: 'f' });
    dispatch({ type: 'writingGaps', docId: 'doc-1', passId, gaps: [gap] });
    click('[data-library-disclosure="doc-1"]');
    click('[data-writing-draft-all]');
    type('[data-writing-key="component:10:20"]', 'Mine.');
    resolve({ 'component:10:20': 'From the model.' });
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector<HTMLInputElement>('[data-writing-key="component:10:20"]')?.value).toBe('Mine.');
    click('[data-writing-save="component:10:20"]');
    expect(lastOutgoing('writeDescriptions')['items']).toEqual([
      { kind: 'component', id: '10:20', text: 'Mine.', origin: 'person' },
    ]);
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
