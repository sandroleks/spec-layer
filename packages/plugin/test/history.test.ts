import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LibraryChange, VersionLog } from '@spec-layer/extractor';
import { groupChanges, bumpTone, bumpLabel, bumpExplanation, describeChange } from '../src/ui/viewModel/history';

const change = (over: Partial<LibraryChange>): LibraryChange => ({
  kind: 'changed', entity: 'token_value', component: null, id: 'V1', name: 'color/primary',
  from: '#000000', to: '#111111', scope: 'Light', bump: 'patch', ...over,
});

describe('groupChanges', () => {
  it('makes one card per subject, Foundations first, with breaking changes, then additions, then value changes', () => {
    const cards = groupChanges([
      change({}),
      change({ component: 'Button', entity: 'binding', id: 'Container / fill', name: 'Container / fill', from: 'a', to: 'b', scope: '1 of 2 variants: size Large' }),
      change({ component: 'Button', kind: 'added', entity: 'option', id: 'size/Huge', name: 'Huge', from: null, to: null, scope: 'size', bump: 'minor' }),
      change({ component: 'Button', kind: 'removed', entity: 'state', id: 'Hover', name: 'Hover', from: null, to: null, scope: null, bump: 'major' }),
      change({ kind: 'renamed', entity: 'token', id: 'V2', name: 'color/brand', from: 'color/primary', to: 'color/brand', scope: null, bump: 'major' }),
    ]);
    expect(cards.map((c) => c.label)).toEqual(['Foundations', 'Button']);
    expect(cards[0].items.map((i) => i.text)).toEqual(['Token color/brand renamed from color/primary', 'color/primary in Light']);
    // A rename's old and new names are in the sentence, so no struck value.
    expect(cards[0].items[0]).toMatchObject({ kind: 'renamed', from: null, to: null, scope: null });
    expect(cards[0].items[1]).toEqual({ kind: 'changed', text: 'color/primary in Light', from: '#000000', to: '#111111', scope: null });
    expect(cards[1].items.map((i) => i.text)).toEqual(['State Hover removed', 'Option Huge added to size', 'Container / fill']);
    expect(cards[1].items[1].scope).toBeNull();
    expect(cards[1].items[2]).toEqual({ kind: 'changed', text: 'Container / fill', from: 'a', to: 'b', scope: '1 of 2 variants: size Large' });
  });

  it('returns no cards for no changes and keeps the change list order within a rank', () => {
    expect(groupChanges([])).toEqual([]);
    const cards = groupChanges([
      change({ component: 'Button', kind: 'added', entity: 'state', id: 'A', name: 'A', scope: null, bump: 'minor' }),
      change({ component: 'Button', kind: 'added', entity: 'state', id: 'B', name: 'B', scope: null, bump: 'minor' }),
    ]);
    expect(cards[0].items.map((i) => i.text)).toEqual(['State A added', 'State B added']);
  });

  it('puts Foundations first even when the foundation change arrives last', () => {
    const cards = groupChanges([
      change({ component: 'Button', kind: 'added', entity: 'state', id: 'A', name: 'A', scope: null, bump: 'minor' }),
      change({}),
    ]);
    expect(cards.map((c) => c.label)).toEqual(['Foundations', 'Button']);
  });
});

describe('describeChange', () => {
  const t = (over: Partial<LibraryChange>) => describeChange(change(over));
  it('names every component entity in plain words without the component prefix', () => {
    expect(t({ component: 'Button', entity: 'component', kind: 'added', name: 'Button' })).toEqual({ text: 'Component added', scope: null });
    expect(t({ component: 'Button', entity: 'component', kind: 'removed', name: 'Button' })).toEqual({ text: 'Component removed', scope: null });
    expect(t({ component: 'Button', entity: 'component', kind: 'renamed', name: 'Button', from: 'Btn' })).toEqual({ text: 'Renamed from Btn', scope: null });
    expect(t({ component: 'Button', entity: 'variant_axis', kind: 'added', name: 'hover', to: 'True, False', scope: null })).toEqual({ text: 'Axis hover added', scope: null });
    expect(t({ component: 'Button', entity: 'variant_axis', kind: 'removed', name: 'hover', scope: null })).toEqual({ text: 'Axis hover removed', scope: null });
    expect(t({ component: 'Button', entity: 'variant_axis', kind: 'changed', name: 'size', scope: null })).toEqual({ text: 'Default of size changed', scope: null });
    expect(t({ component: 'Button', entity: 'option', kind: 'added', name: 'Huge', scope: 'size' })).toEqual({ text: 'Option Huge added to size', scope: null });
    expect(t({ component: 'Button', entity: 'option', kind: 'removed', name: 'Huge', scope: 'size' })).toEqual({ text: 'Option Huge removed from size', scope: null });
    expect(t({ component: 'Button', entity: 'property', kind: 'added', name: 'icon', to: 'instanceSwap', scope: null })).toEqual({ text: 'Property icon added', scope: null });
    expect(t({ component: 'Button', entity: 'property', kind: 'changed', name: 'icon', scope: null })).toEqual({ text: 'Property icon changed', scope: null });
    expect(t({ component: 'Button', entity: 'state', kind: 'removed', name: 'Hover', scope: null })).toEqual({ text: 'State Hover removed', scope: null });
    expect(t({ component: 'Button', entity: 'anatomy_part', kind: 'added', name: 'Icon', scope: null })).toEqual({ text: 'Part Icon added', scope: null });
    expect(t({ component: 'Button', entity: 'anatomy_part', kind: 'changed', name: 'Icon', scope: null })).toEqual({ text: 'Part Icon changed', scope: null });
    expect(t({ component: 'Button', entity: 'binding', kind: 'added', name: 'Container / fill', scope: '1 of 2 variants: size Large' })).toEqual({ text: 'Container / fill bound to', scope: '1 of 2 variants: size Large' });
    expect(t({ component: 'Button', entity: 'binding', kind: 'removed', name: 'Container / fill', scope: null })).toEqual({ text: 'Container / fill no longer bound to', scope: null });
    expect(t({ component: 'Button', entity: 'binding', kind: 'changed', name: 'Container / fill', scope: null })).toEqual({ text: 'Container / fill', scope: null });
    expect(t({ component: 'Button', entity: 'value', kind: 'changed', id: 'layout:Container', name: 'layout:Container', scope: null })).toEqual({ text: 'Layout of Container changed', scope: null });
    expect(t({ component: 'Button', entity: 'value', kind: 'added', id: 'effects:Container', name: 'effects:Container', scope: null })).toEqual({ text: 'Effects of Container changed', scope: null });
    expect(t({ component: 'Button', entity: 'value', kind: 'removed', id: 'unbound:Container / fill', name: 'unbound:Container / fill', scope: null })).toEqual({ text: 'Unbound value at Container / fill changed', scope: null });
  });

  it('names every foundation entity, folding the mode into the sentence', () => {
    expect(t({ entity: 'collection', kind: 'added', name: 'Theme', scope: null })).toEqual({ text: 'Collection Theme added', scope: null });
    expect(t({ entity: 'collection', kind: 'renamed', name: 'Theme', from: 'Colors', scope: null })).toEqual({ text: 'Collection renamed from Colors', scope: null });
    expect(t({ entity: 'mode', kind: 'added', name: 'Contrast', scope: 'Theme' })).toEqual({ text: 'Mode Contrast added to Theme', scope: null });
    expect(t({ entity: 'mode', kind: 'removed', name: 'Contrast', scope: 'Theme' })).toEqual({ text: 'Mode Contrast removed from Theme', scope: null });
    expect(t({ entity: 'mode', kind: 'renamed', name: 'Night', from: 'Dark', scope: 'Theme' })).toEqual({ text: 'Mode renamed from Dark in Theme', scope: null });
    expect(t({ entity: 'token', kind: 'added', name: 'color/x', to: 'color in Theme, scopes ALL_SCOPES', scope: null })).toEqual({ text: 'Token color/x added', scope: null });
    expect(t({ entity: 'token', kind: 'removed', name: 'color/x', scope: null })).toEqual({ text: 'Token color/x removed', scope: null });
    expect(t({ entity: 'token', kind: 'renamed', name: 'color/y', from: 'color/x', scope: null })).toEqual({ text: 'Token color/y renamed from color/x', scope: null });
    expect(t({ entity: 'token', kind: 'changed', name: 'color/x', scope: null })).toEqual({ text: 'Token color/x changed', scope: null });
    expect(t({ entity: 'token_value', kind: 'changed', name: 'color/x', scope: 'Dark' })).toEqual({ text: 'color/x in Dark', scope: null });
    expect(t({ entity: 'style', kind: 'changed', name: 'Body', scope: null })).toEqual({ text: 'Style Body changed', scope: null });
    expect(t({ entity: 'style', kind: 'added', name: 'Body', scope: null })).toEqual({ text: 'Style Body added', scope: null });
  });

  it('carries no em dash in any sentence', () => {
    const entities: LibraryChange['entity'][] = ['component', 'property', 'option', 'variant_axis', 'state', 'anatomy_part', 'binding', 'value', 'collection', 'mode', 'token', 'token_value', 'style'];
    const kinds: LibraryChange['kind'][] = ['added', 'removed', 'renamed', 'changed'];
    for (const entity of entities) for (const kind of kinds) {
      expect(t({ entity, kind, component: 'Button', id: 'layout:X', name: 'X', from: 'a', to: 'b', scope: 's' }).text).not.toContain('—');
    }
  });
});

describe('bump tone, label and explanation', () => {
  it('maps every bump to a tone, a plain word, and one sentence', () => {
    expect(bumpTone('major')).toBe('danger');
    expect(bumpTone('minor')).toBe('accent');
    expect(bumpTone('patch')).toBeNull();
    expect(bumpTone('initial')).toBe('success');
    expect(bumpLabel('major')).toBe('Major');
    expect(bumpLabel('minor')).toBe('Minor');
    expect(bumpLabel('patch')).toBe('Patch');
    expect(bumpLabel('initial')).toBe('First version');
    expect(bumpExplanation('major')).toBe('Something was removed or renamed. Code that used it may break.');
    expect(bumpExplanation('minor')).toBe('Something was added. Existing code keeps working.');
    expect(bumpExplanation('patch')).toBe('Values or prose changed. Nothing was added or removed.');
    expect(bumpExplanation('initial')).toBe('The first publish. Nothing to compare against.');
    for (const bump of ['major', 'minor', 'patch', 'initial'] as const) expect(bumpExplanation(bump)).not.toContain('—');
  });
});

describe('history controller', () => {
  let history: typeof import('../src/ui/history');
  let repaints: number;
  const LOG: VersionLog = { v: 1, records: [{
    version: '1.0.0', publishedAt: '2026-09-12T00:00:00.000Z', bump: 'initial', minimumBump: null, note: null,
    contentHash: 'c', bundleHash: 'b', extractorVersion: '2', pluginVersion: '5.1.0',
    counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
  }] };
  const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    ({ status, ok: status >= 200 && status < 300, headers: new Headers(headers), json: async () => body }) as unknown as Response;

  beforeEach(async () => {
    vi.resetModules();
    history = await import('../src/ui/history');
    repaints = 0;
    history.setHistoryHost({ repaint: () => { repaints += 1; } });
  });

  it('loads the log with the pull key and remembers the ETag', async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.spec-layer.com/v1/libraries/lib_1/versions');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sl_key');
      return response(200, LOG, { ETag: '"abc"' });
    }) as unknown as typeof fetch;
    await history.onHistoryOpen('lib_1', 'sl_key', fetcher);
    expect(history.historyState()).toMatchObject({ status: 'ready', log: LOG, etag: '"abc"' });
    expect(repaints).toBe(2);
  });

  it('sends If-None-Match on the next open and keeps the log on 304', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(200, LOG, { ETag: '"abc"' }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        expect((init?.headers as Record<string, string>)['If-None-Match']).toBe('"abc"');
        return response(304, null);
      }) as unknown as typeof fetch;
    await history.onHistoryOpen('lib_1', 'sl_key', fetcher);
    await history.onHistoryOpen('lib_1', 'sl_key', fetcher);
    expect(history.historyState()).toMatchObject({ status: 'ready', log: LOG });
  });

  it('names the no-library, no-key, gone, and error states honestly', async () => {
    await history.onHistoryOpen(null, null);
    expect(history.historyState().status).toBe('noLibrary');
    await history.onHistoryOpen('lib_1', null);
    expect(history.historyState().status).toBe('noKey');
    await history.onHistoryOpen('lib_1', 'sl_key', vi.fn(async () => response(404, { error: 'not_found' })) as unknown as typeof fetch);
    expect(history.historyState().status).toBe('gone');
    await history.onHistoryOpen('lib_1', 'sl_key', vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect(history.historyState()).toMatchObject({ status: 'error', message: 'Could not reach the publish service. Check your connection and try again.' });
  });

  it('toggles one expanded record at a time', async () => {
    history.onHistoryToggle('1.0.0');
    expect(history.historyState().expanded).toBe('1.0.0');
    history.onHistoryToggle('1.0.0');
    expect(history.historyState().expanded).toBeNull();
  });
});
