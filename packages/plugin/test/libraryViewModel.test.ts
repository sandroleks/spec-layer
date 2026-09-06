import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../src/messages';
import {
  buildLibraryModel,
  buildLibraryRow,
  formatLibraryAge,
  libraryBadgeVisible,
  libraryDriftForEntry,
  resolveLibraryChanges,
  resolveLibraryRowStatus,
  type LibraryChangeResult,
  type LibraryDriftState,
} from '../src/ui/viewModel/library';
import type { SpecHashProjection, FoundationUnitContent } from '@spec-layer/extractor';
import type { ComponentDocBaseline, FoundationDocBaseline } from '../src/docLink';

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

  it('maps a stale-version drift to a rebuild rather than a hash-based update', () => {
    expect(resolveLibraryRowStatus(entry(), 'staleVersion')).toBe('rebuildNeeded');
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
      canReconnect: false,
      canUpdate: true,
      canDetach: true,
      canRemove: true,
      changeGroups: null,
      // Expanded (status updateAvailable, expandedDocId matches) with no
      // `changes` entry for this doc: per resolveLibraryChanges/buildLibraryRow,
      // that reads as 'pending', not 'idle'. See the 'change states' describe
      // block's identical-setup 'is pending when expanded with no result yet'.
      changeState: 'pending',
      changeUnavailableReason: null,
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

  it('blocks Copy once the drift check has already failed against this source', () => {
    const row = buildLibraryRow(entry(), {
      drift: new Map([['doc-1', 'unavailable']]),
      now: NOW,
    });
    expect(row.status).toBe('unavailable');
    expect(row.canCopy).toBe(false);
  });

  it('still offers Copy for a drifted or hand-edited row, since Copy reads the live source', () => {
    const drifted = buildLibraryRow(entry(), {
      drift: new Map([['doc-1', 'drifted']]),
      now: NOW,
    });
    expect(drifted.status).toBe('updateAvailable');
    expect(drifted.canCopy).toBe(true);

    const edited = buildLibraryRow(entry({ selfEdited: true }), {
      drift: new Map([['doc-1', 'inSync']]),
      now: NOW,
    });
    expect(edited.status).toBe('edited');
    expect(edited.canCopy).toBe(true);
  });

  it('never offers Copy once the source is gone, regardless of drift', () => {
    const row = buildLibraryRow(entry({ sourceExists: false }), { now: NOW });
    expect(row.status).toBe('orphaned');
    expect(row.canCopy).toBe(false);
  });
});

describe('buildLibraryModel filters and counts', () => {
  const entries = [
    entry({ docId: 'update', label: 'Button', sourceLabel: 'Components · Button' }),
    entry({ docId: 'sync', label: 'Checkbox', sourceLabel: 'Components · Checkbox' }),
    entry({ docId: 'edited', label: 'Input', sourceLabel: 'Components · Input', selfEdited: true }),
    entry({ docId: 'missing', label: 'Radio', sourceLabel: 'Components · Radio', sourceExists: false }),
    entry({ docId: 'failed', label: 'Colors', sourceLabel: 'Foundations · Colors' }),
    // A pre-0.2 doc: its row must read distinctly as "Rebuild needed" (never
    // "Update available"), but should still count and filter as an update in
    // the aggregate. See buildLibraryModel's `needsAction` helper.
    entry({ docId: 'stale', label: 'Toggle', sourceLabel: 'Components · Toggle' }),
  ];
  const drift = new Map<string, LibraryDriftState>([
    ['update', 'drifted'],
    ['sync', 'inSync'],
    ['edited', 'inSync'],
    ['failed', 'unavailable'],
    ['stale', 'staleVersion'],
  ]);

  it('counts only proven source updates and proven in-sync rows', () => {
    const model = buildLibraryModel(entries, { drift, now: NOW });
    expect(model.counts).toEqual({ all: 6, updates: 2, inSync: 1 });
    expect(model.rows).toHaveLength(6);
  });

  it('counts a rebuild-needed row toward updates while keeping its own status distinct', () => {
    const model = buildLibraryModel(entries, { drift, now: NOW });
    const stale = model.rows.find((row) => row.docId === 'stale');
    expect(stale?.status).toBe('rebuildNeeded');
  });

  it('applies updates and in-sync filters without changing their counts', () => {
    const updates = buildLibraryModel(entries, {
      drift, filter: 'updates', now: NOW,
    });
    // Both the hash-drifted row and the rebuild-needed row surface under
    // "Updates": a user relying on the filter to find rows that need action
    // must not miss the ones that need a rebuild rather than a hash-based update.
    expect(updates.rows.map((row) => row.docId).sort()).toEqual(['stale', 'update']);
    expect(updates.counts).toEqual({ all: 6, updates: 2, inSync: 1 });

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

/**
 * The reported bug: the rail badge showed 1, jumped to 3 once checks finished,
 * and disappeared entirely while the Library reloaded. The count is not a fact
 * mid-pass, so the badge is a dot driven by this instead.
 */
describe('libraryBadgeVisible', () => {
  it('shows as soon as one update is known, without waiting for the pass', () => {
    expect(libraryBadgeVisible({ updates: 1, checking: true, previous: false })).toBe(true);
  });

  it('holds the previous answer while anything is still being checked', () => {
    // The reload: every result cleared, so updates reads 0 for a moment.
    expect(libraryBadgeVisible({ updates: 0, checking: true, previous: true })).toBe(true);
    expect(libraryBadgeVisible({ updates: 0, checking: true, previous: false })).toBe(false);
  });

  it('clears only when a finished pass found nothing', () => {
    expect(libraryBadgeVisible({ updates: 0, checking: false, previous: true })).toBe(false);
    expect(libraryBadgeVisible({ updates: 0, checking: false, previous: false })).toBe(false);
  });

  it('never flickers across a full reload of a library that has updates', () => {
    // Replays one refresh: settled, cleared to pending, then checks landing.
    let shown = libraryBadgeVisible({ updates: 3, checking: false, previous: false });
    expect(shown).toBe(true);
    const pass = [
      { updates: 0, checking: true },  // refresh starts, drift cleared
      { updates: 0, checking: true },  // entries back, all rows pending
      { updates: 1, checking: true },  // first check lands
      { updates: 2, checking: true },
      { updates: 3, checking: false }, // pass complete
    ];
    for (const step of pass) {
      shown = libraryBadgeVisible({ ...step, previous: shown });
      expect(shown, JSON.stringify(step)).toBe(true);
    }
  });

  it('does clear once the user updates everything', () => {
    let shown = true;
    for (const step of [
      { updates: 0, checking: true },   // re-check after the batch update
      { updates: 0, checking: false },  // settled: nothing left to update
    ]) {
      shown = libraryBadgeVisible({ ...step, previous: shown });
    }
    expect(shown).toBe(false);
  });
});

describe('canCopy on foundation rows', () => {
  function foundationEntry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
    return entry({
      docId: 'found-1',
      kind: 'foundation',
      label: 'Foundations · Semantic',
      componentName: 'Foundations · Semantic',
      sourceLabel: 'Semantic',
      // A foundation doc has no source node. This is exactly why the old
      // component-shaped canCopy could never be true here.
      sourceNodeId: '',
      foundationIcon: 'mixed',
      foundationScope: {
        target: 'collection', collectionId: 'sem',
        collectionName: 'Semantic', modeIds: ['s1'],
      },
      currentContentHash: 'stored',
      storedContentHash: 'stored',
      ...overrides,
    });
  }

  it('offers Copy on an in-sync foundation row', () => {
    const row = buildLibraryRow(foundationEntry(), { now: NOW });
    expect(row.status).toBe('inSync');
    expect(row.canCopy).toBe(true);
  });

  it('offers Copy on a drifted foundation row, since reading the live source is the point', () => {
    const row = buildLibraryRow(
      foundationEntry({ currentContentHash: 'live', storedContentHash: 'stored' }),
      { now: NOW },
    );
    expect(row.status).toBe('updateAvailable');
    expect(row.canCopy).toBe(true);
  });

  it('withholds Copy when the scope no longer resolves', () => {
    const row = buildLibraryRow(
      foundationEntry({ sourceExists: false }),
      { now: NOW },
    );
    expect(row.status).toBe('orphaned');
    expect(row.canCopy).toBe(false);
  });

  it('withholds Copy when the live read failed', () => {
    const row = buildLibraryRow(
      foundationEntry({ currentContentHash: undefined }),
      { now: NOW },
    );
    expect(row.status).toBe('unavailable');
    expect(row.canCopy).toBe(false);
  });

  it('withholds Copy from an older main thread that sent no scope', () => {
    const older = foundationEntry();
    delete older.foundationScope;
    expect(buildLibraryRow(older, { now: NOW }).canCopy).toBe(false);
  });

  it('leaves component rows unchanged', () => {
    expect(buildLibraryRow(entry(), { now: NOW }).canCopy).toBe(true);
    expect(buildLibraryRow(entry({ sourceNodeId: '' }), { now: NOW }).canCopy).toBe(false);
    expect(buildLibraryRow(entry({ sourceExists: false }), { now: NOW }).canCopy).toBe(false);
  });
});

describe('change states', () => {
  const drifted = new Map<string, LibraryDriftState>([['doc-1', 'drifted']]);
  const groups = [{ label: 'Tokens', items: ['Label / fill: a changed to b'] }];

  it('is idle for a row that is not expanded, even when a result exists', () => {
    const changes = new Map<string, LibraryChangeResult>([['doc-1', { state: 'ready', groups }]]);
    const row = buildLibraryRow(entry(), { drift: drifted, changes });
    expect(row.expanded).toBe(false);
    expect(row.changeState).toBe('idle');
    expect(row.changeGroups).toBeNull();
    expect(row.changeUnavailableReason).toBeNull();
  });

  it('is pending when expanded with no result yet', () => {
    const row = buildLibraryRow(entry(), { drift: drifted, expandedDocId: 'doc-1' });
    expect(row.expanded).toBe(true);
    expect(row.changeState).toBe('pending');
    expect(row.changeGroups).toBeNull();
  });

  it('is ready with groups when the result landed', () => {
    const changes = new Map<string, LibraryChangeResult>([['doc-1', { state: 'ready', groups }]]);
    const row = buildLibraryRow(entry(), { drift: drifted, expandedDocId: 'doc-1', changes });
    expect(row.changeState).toBe('ready');
    expect(row.changeGroups).toEqual(groups);
    expect(row.changeUnavailableReason).toBeNull();
  });

  it('is unavailable with its reason', () => {
    const changes = new Map<string, LibraryChangeResult>([['doc-1', { state: 'unavailable', reason: 'noBaseline' }]]);
    const row = buildLibraryRow(entry(), { drift: drifted, expandedDocId: 'doc-1', changes });
    expect(row.changeState).toBe('unavailable');
    expect(row.changeGroups).toBeNull();
    expect(row.changeUnavailableReason).toBe('noBaseline');
  });

  it('never expands a row whose status is not updateAvailable, so it stays idle', () => {
    for (const drift of ['inSync', 'staleVersion', 'pending', 'unavailable'] as LibraryDriftState[]) {
      const row = buildLibraryRow(entry(), {
        drift: new Map([['doc-1', drift]]), expandedDocId: 'doc-1',
        changes: new Map([['doc-1', { state: 'ready', groups }]]),
      });
      expect(row.expanded).toBe(false);
      expect(row.changeState).toBe('idle');
    }
    const edited = buildLibraryRow(entry({ selfEdited: true }), {
      drift: new Map([['doc-1', 'inSync']]), expandedDocId: 'doc-1',
    });
    expect(edited.status).toBe('edited');
    expect(edited.changeState).toBe('idle');
  });
});

describe('resolveLibraryChanges', () => {
  const projection: SpecHashProjection = {
    name: 'Button', figmaKey: 'k', figmaFile: 'F', figmaNode: '1:1', anatomyComponentId: '1:2',
    anatomy: [], props: [], variants: [], variantInstances: [], states: ['default'],
    tokens: [], related: [], gaps: [], layout: [],
  };
  const unit: FoundationUnitContent = {
    collectionName: 'Semantic', modeNames: ['Light'], omittedModeNames: [],
    rows: [{ kind: 'variable', name: 'bg/brand', description: '', resolvedType: 'COLOR',
      cells: [{ modeName: 'Light', value: { kind: 'color', hex: '#0055FF', alpha: 1 } }] }],
  };
  const component: ComponentDocBaseline = { v: 1, kind: 'component', contentHash: 'a', projection };
  const foundation: FoundationDocBaseline = { v: 1, kind: 'foundation', contentHash: 'f', projection: unit };

  it('is unavailable with noBaseline when main sent none', () => {
    expect(resolveLibraryChanges({ baseline: null })).toEqual({ state: 'unavailable', reason: 'noBaseline' });
    expect(resolveLibraryChanges({ baseline: null, liveProjection: projection }))
      .toEqual({ state: 'unavailable', reason: 'noBaseline' });
  });

  it('diffs a component baseline against the cached live projection', () => {
    const live = { ...projection, states: ['default', 'hover'] };
    expect(resolveLibraryChanges({ baseline: component, liveProjection: live })).toEqual({
      state: 'ready', groups: [{ label: 'States', items: ['Added state hover'] }],
    });
  });

  it('is unavailable when a component row has no cached live projection', () => {
    expect(resolveLibraryChanges({ baseline: component })).toEqual({ state: 'unavailable', reason: 'other' });
  });

  it('diffs a foundation baseline against the live unit content main sent', () => {
    const live: FoundationUnitContent = { ...unit, modeNames: ['Light', 'Dark'] };
    expect(resolveLibraryChanges({ baseline: foundation, live })).toEqual({
      state: 'ready', groups: [{ label: 'Modes', items: ['Added mode Dark'] }],
    });
  });

  it('is unavailable when the foundation scope no longer resolves or live is missing', () => {
    expect(resolveLibraryChanges({ baseline: foundation, live: null })).toEqual({ state: 'unavailable', reason: 'other' });
    expect(resolveLibraryChanges({ baseline: foundation })).toEqual({ state: 'unavailable', reason: 'other' });
  });

  it('is ready with no groups when the two sides are identical', () => {
    expect(resolveLibraryChanges({ baseline: component, liveProjection: projection })).toEqual({ state: 'ready', groups: [] });
  });

  it('turns a throwing diff into unavailable rather than propagating', () => {
    const broken = { ...component, projection: null as unknown as SpecHashProjection };
    expect(resolveLibraryChanges({ baseline: broken, liveProjection: projection })).toEqual({ state: 'unavailable', reason: 'other' });
  });
});
