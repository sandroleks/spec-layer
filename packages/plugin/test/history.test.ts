import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LibraryChange, VersionLog } from '@spec-layer/extractor';
import { groupChanges, bumpTone, bumpLabel, describeChange } from '../src/ui/viewModel/history';

const change = (over: Partial<LibraryChange>): LibraryChange => ({
  kind: 'changed', entity: 'token_value', component: null, id: 'V1', name: 'color/primary',
  from: '#000000', to: '#111111', scope: 'Light', bump: 'patch', ...over,
});

describe('groupChanges', () => {
  it('puts removed and renamed first under Removed, then component changes, then foundation changes', () => {
    const groups = groupChanges([
      change({}),
      change({ component: 'Button', entity: 'binding', id: 'Container / fill', name: 'Container / fill', from: 'a', to: 'b', scope: null }),
      change({ kind: 'removed', component: 'Button', entity: 'state', id: 'Hover', name: 'Hover', from: null, to: null, scope: null, bump: 'major' }),
      change({ kind: 'renamed', entity: 'token', id: 'V2', name: 'color/brand', from: 'color/primary', to: 'color/brand', scope: null, bump: 'major' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Removed', 'Components', 'Foundations']);
    expect(groups[0].items.map((i) => i.label)).toEqual(['Button: state Hover removed', 'Token color/primary renamed']);
    expect(groups[0].items[1]).toMatchObject({ from: 'color/primary', to: 'color/brand' });
    expect(groups[1].items[0]).toEqual({ label: 'Button: binding Container / fill', from: 'a', to: 'b', scope: null });
    expect(groups[2].items[0]).toEqual({ label: 'Token value color/primary', from: '#000000', to: '#111111', scope: 'Light' });
  });

  it('drops empty groups', () => {
    expect(groupChanges([change({})]).map((g) => g.label)).toEqual(['Foundations']);
    expect(groupChanges([])).toEqual([]);
  });
});

describe('describeChange', () => {
  it('names the entity in words and prefixes the component', () => {
    expect(describeChange(change({ component: 'Button', entity: 'variant_axis', kind: 'added', id: 'size', name: 'size' }))).toBe('Button: variant axis size added');
    expect(describeChange(change({ component: 'Button', entity: 'anatomy_part', kind: 'changed', id: 'Icon', name: 'Icon' }))).toBe('Button: part Icon');
    expect(describeChange(change({ entity: 'mode', kind: 'added', id: 'c/m3', name: 'Contrast', scope: 'Theme' }))).toBe('Mode Contrast added');
  });
});

describe('bump tone and label', () => {
  it('maps every bump', () => {
    expect(bumpTone('major')).toBe('danger');
    expect(bumpTone('minor')).toBe('accent');
    expect(bumpTone('patch')).toBeNull();
    expect(bumpTone('initial')).toBe('success');
    expect(bumpLabel('major')).toBe('major, breaking');
    expect(bumpLabel('initial')).toBe('first version');
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
