import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../src/messages';
import {
  buildLibraryModel,
  buildLibraryRow,
  formatLibraryAge,
  libraryDriftForEntry,
  resolveLibraryRowStatus,
  type LibraryDriftState,
} from '../src/ui/viewModel/library';

const NOW = Date.UTC(2026, 6, 29, 12);

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    docId: 'doc-1',
    kind: 'component',
    label: 'buttonPrimary',
    componentName: 'buttonPrimary',
    pageName: 'Components',
    sourceLabel: 'Components · Button / Primary',
    generatedAt: NOW - 3 * 24 * 60 * 60_000,
    sourceNodeId: '10:20',
    sourceExists: true,
    selfEdited: false,
    storedContentHash: 'stored',
    ...overrides,
  };
}

describe('resolveLibraryRowStatus', () => {
  it('keeps the domain priority orphaned > update available > edited > in sync', () => {
    expect(resolveLibraryRowStatus(
      entry({ sourceExists: false, selfEdited: true }),
      'drifted',
    )).toBe('orphaned');
    expect(resolveLibraryRowStatus(entry({ selfEdited: true }), 'drifted'))
      .toBe('updateAvailable');
    expect(resolveLibraryRowStatus(entry({ selfEdited: true }), 'inSync'))
      .toBe('edited');
    expect(resolveLibraryRowStatus(entry(), 'inSync')).toBe('inSync');
  });

  it('does not turn pending or failed drift checks into a false sync claim', () => {
    expect(resolveLibraryRowStatus(entry(), 'pending')).toBe('pending');
    expect(resolveLibraryRowStatus(entry(), 'unavailable')).toBe('unavailable');
    expect(resolveLibraryRowStatus(entry({ selfEdited: true }), 'unavailable'))
      .toBe('edited');
  });
});

describe('libraryDriftForEntry', () => {
  it('uses explicit asynchronous component drift and defaults to pending', () => {
    const component = entry();
    expect(libraryDriftForEntry(component, new Map())).toBe('pending');
    expect(libraryDriftForEntry(
      component,
      new Map<string, LibraryDriftState>([['doc-1', 'drifted']]),
    )).toBe('drifted');
  });

  it('compares foundation hashes and treats failed extraction as unavailable', () => {
    const foundation = entry({
      kind: 'foundation',
      sourceNodeId: '',
      storedContentHash: 'old',
    });
    expect(libraryDriftForEntry(
      { ...foundation, currentContentHash: 'old' },
      new Map(),
    )).toBe('inSync');
    expect(libraryDriftForEntry(
      { ...foundation, currentContentHash: 'new' },
      new Map(),
    )).toBe('drifted');
    expect(libraryDriftForEntry(foundation, new Map())).toBe('unavailable');
  });
});

describe('formatLibraryAge', () => {
  it('formats deterministic compact relative ages from an injected clock', () => {
    expect(formatLibraryAge(NOW - 30_000, NOW)).toBe('just now');
    expect(formatLibraryAge(NOW - 17 * 60_000, NOW)).toBe('17m ago');
    expect(formatLibraryAge(NOW - 8 * 60 * 60_000, NOW)).toBe('8h ago');
    expect(formatLibraryAge(NOW - 12 * 24 * 60 * 60_000, NOW)).toBe('12d ago');
  });

  it('is honest about missing data and tolerant of clock skew', () => {
    expect(formatLibraryAge(undefined, NOW)).toBe('—');
    expect(formatLibraryAge(Number.NaN, NOW)).toBe('—');
    expect(formatLibraryAge(NOW + 60_000, NOW)).toBe('just now');
  });
});

describe('buildLibraryRow capabilities', () => {
  it('exposes only capabilities supported by a connected component', () => {
    const row = buildLibraryRow(entry(), {
      drift: new Map([['doc-1', 'drifted']]),
      expandedDocId: 'doc-1',
      now: NOW,
    });
    expect(row).toMatchObject({
      status: 'updateAvailable',
      expanded: true,
      canOpenFrame: true,
      canOpenSource: true,
      canDownload: true,
      canReconnect: false,
      canUpdate: true,
      canDetach: true,
      canRemove: true,
      changeGroups: null,
      ageLabel: '3d ago',
    });
  });

  it('carries the source glyph through for foundation rows only', () => {
    expect(buildLibraryRow(entry(), { now: NOW }).foundationIcon).toBeNull();
    expect(buildLibraryRow(entry({
      kind: 'foundation', foundationIcon: 'color', sourceNodeId: '',
    }), { now: NOW }).foundationIcon).toBe('color');
    // A foundation entry from a main thread that could not read its scope must
    // still render a glyph rather than nothing.
    expect(buildLibraryRow(entry({ kind: 'foundation', sourceNodeId: '' }), { now: NOW })
      .foundationIcon).toBe('mixed');
  });

  it('keeps manual Update available for a proven in-sync connection', () => {
    const row = buildLibraryRow(entry(), {
      drift: new Map([['doc-1', 'inSync']]),
      now: NOW,
    });
    expect(row.status).toBe('inSync');
    expect(row.canUpdate).toBe(true);
  });

  it('limits a source-missing row to its real frame and connection actions', () => {
    const row = buildLibraryRow(entry({ sourceExists: false }), { now: NOW });
    expect(row).toMatchObject({
      status: 'orphaned',
      canOpenFrame: true,
      canOpenSource: false,
      canDownload: false,
      canReconnect: false,
      canUpdate: false,
      canDetach: true,
      canRemove: true,
    });
  });

  it('blocks Update while drift is pending or unavailable', () => {
    const pending = buildLibraryRow(entry(), { now: NOW });
    const unavailable = buildLibraryRow(entry(), {
      drift: new Map([['doc-1', 'unavailable']]),
      now: NOW,
    });
    expect(pending.canUpdate).toBe(false);
    expect(unavailable.canUpdate).toBe(false);
  });

  it('does not offer component-only source actions for a foundation', () => {
    const row = buildLibraryRow(entry({
      kind: 'foundation',
      sourceNodeId: '',
      currentContentHash: 'new',
    }), { now: NOW });
    expect(row.status).toBe('updateAvailable');
    expect(row.canUpdate).toBe(true);
    expect(row.canOpenSource).toBe(false);
    expect(row.canDownload).toBe(false);
  });

  it('offers edited rows an overwrite update but expands only source drift', () => {
    const row = buildLibraryRow(entry({ selfEdited: true }), {
      drift: new Map([['doc-1', 'inSync']]),
      expandedDocId: 'doc-1',
      now: NOW,
    });
    expect(row.status).toBe('edited');
    expect(row.canUpdate).toBe(true);
    expect(row.expanded).toBe(false);
  });
});

describe('buildLibraryModel filters and counts', () => {
  const entries = [
    entry({ docId: 'update', label: 'Button', sourceLabel: 'Components · Button' }),
    entry({ docId: 'sync', label: 'Checkbox', sourceLabel: 'Components · Checkbox' }),
    entry({ docId: 'edited', label: 'Input', sourceLabel: 'Components · Input', selfEdited: true }),
    entry({ docId: 'missing', label: 'Radio', sourceLabel: 'Components · Radio', sourceExists: false }),
    entry({ docId: 'failed', label: 'Colors', sourceLabel: 'Foundations · Colors' }),
  ];
  const drift = new Map<string, LibraryDriftState>([
    ['update', 'drifted'],
    ['sync', 'inSync'],
    ['edited', 'inSync'],
    ['failed', 'unavailable'],
  ]);

  it('counts only proven source updates and proven in-sync rows', () => {
    const model = buildLibraryModel(entries, { drift, now: NOW });
    expect(model.counts).toEqual({ all: 5, updates: 1, inSync: 1 });
    expect(model.rows).toHaveLength(5);
  });

  it('applies updates and in-sync filters without changing their counts', () => {
    const updates = buildLibraryModel(entries, {
      drift, filter: 'updates', now: NOW,
    });
    expect(updates.rows.map((row) => row.docId)).toEqual(['update']);
    expect(updates.counts).toEqual({ all: 5, updates: 1, inSync: 1 });

    const sync = buildLibraryModel(entries, {
      drift, filter: 'sync', now: NOW,
    });
    expect(sync.rows.map((row) => row.docId)).toEqual(['sync']);
  });

  it('searches identity copy after the selected status filter', () => {
    const model = buildLibraryModel(entries, {
      drift,
      query: 'checkbox',
      now: NOW,
    });
    expect(model.rows.map((row) => row.docId)).toEqual(['sync']);
  });
});
