import { describe, expect, it } from 'vitest';
import type { FoundationSelection, FoundationSpec } from '@spec-layer/extractor';
import { foundationScrollMarkup } from '../src/ui/screens/foundations';
import {
  libraryFooterMarkup,
  libraryHeaderMarkup,
  libraryScrollMarkup,
  type LibraryRowPresentation,
  type LibraryScreenPresentation,
} from '../src/ui/screens/library';

function row(
  docId: string,
  status: LibraryRowPresentation['status'],
  overrides: Partial<LibraryRowPresentation> = {},
): LibraryRowPresentation {
  return {
    docId,
    kind: 'component',
    foundationIcon: null,
    label: docId,
    sourceLabel: `Components · ${docId}`,
    sourceNodeId: `source-${docId}`,
    ageLabel: '3d ago',
    status,
    expanded: false,
    canOpenFrame: true,
    canOpenSource: true,
    canDownload: true,
    canReconnect: false,
    canUpdate: status === 'updateAvailable',
    canDetach: true,
    canRemove: true,
    changeGroups: null,
    ...overrides,
  };
}

/** How many footer buttons wear the circular-arrows glyph. */
function refreshArrows(markup: string): number {
  return markup.split('M20 11a8.1 8.1 0 0 0-15.5-2').length - 1;
}

const ROWS: LibraryRowPresentation[] = [
  row('buttonText', 'updateAvailable', { expanded: true }),
  row('buttonPrimary', 'inSync'),
  row('buttonEdited', 'edited'),
  row('buttonMissing', 'orphaned', {
    canOpenSource: false,
    canDownload: false,
    canUpdate: false,
  }),
];

function model(
  overrides: Partial<LibraryScreenPresentation> = {},
): LibraryScreenPresentation {
  const allRows = overrides.allRows ?? ROWS;
  const filter = overrides.filter ?? 'all';
  const rows = overrides.rows ?? allRows.filter((item) => (
    filter === 'updates'
      ? item.status === 'updateAvailable'
      : filter === 'sync'
        ? item.status === 'inSync'
        : true
  ));
  return {
    allRows,
    rows,
    filter,
    counts: overrides.counts ?? {
      all: allRows.length,
      updates: allRows.filter((item) => item.status === 'updateAvailable').length,
      inSync: allRows.filter((item) => item.status === 'inSync').length,
    },
    menuDocId: null,
    ...overrides,
  };
}

describe('library screen presentation', () => {
  it('uses a standalone page title and real filter counts', () => {
    expect(libraryHeaderMarkup()).toBe(
      '<div class="sl-page-header-copy"><h1>Library</h1></div>',
    );
    const markup = libraryScrollMarkup(model());
    expect(markup).toContain('<span>All</span><small>4</small>');
    expect(markup).toContain('<span>Updates</span><small>1</small>');
    expect(markup).toContain('<span>In sync</span><small>1</small>');
    expect(markup).toContain('role="group" aria-label="Library filters"');
    expect(markup).toContain('data-library-filter="all" aria-pressed="true"');
    expect(markup).not.toContain('role="tab"');
    expect(markup).not.toContain('Search');
  });

  it('renders disclosure only for source-update rows', () => {
    const markup = libraryScrollMarkup(model());
    expect(markup.match(/data-library-disclosure=/g)).toHaveLength(1);
    expect(markup).toContain('data-library-disclosure="buttonText"');
    expect(markup).toContain('data-library-status="edited"');
    expect(markup).toContain('data-library-status="orphaned"');
  });

  it('keeps pending and unavailable checks distinct from in-sync claims', () => {
    const markup = libraryScrollMarkup(model({
      allRows: [
        row('pending', 'pending'),
        row('unavailable', 'unavailable'),
      ],
      rows: [
        row('pending', 'pending'),
        row('unavailable', 'unavailable'),
      ],
      counts: { all: 2, updates: 0, inSync: 0 },
    }));
    expect(markup).toContain('Checking…');
    expect(markup).toContain('Check unavailable');
    expect(markup).not.toContain('data-library-status="inSync"');
  });

  it('uses the honest detailed-comparison fallback verbatim', () => {
    const markup = libraryScrollMarkup(model());
    expect(markup).toContain('<h2>Changes</h2>');
    expect(markup).toContain('<strong>Source changed</strong>');
    expect(markup).toContain(
      'A detailed comparison isn&#39;t available. Review the source from the row menu.',
    );
    expect(markup).not.toContain('Last synced');
  });

  it('renders concrete groups without invented summary captions', () => {
    const markup = libraryScrollMarkup(model({
      rows: [
        row('inputField', 'updateAvailable', {
          expanded: true,
          changeGroups: [
            { label: 'States', items: ['Added: read-only'] },
            { label: 'Tokens', items: ['Focus: action-500 → focus-ring'] },
          ],
        }),
      ],
    }));
    expect(markup).toContain('<strong>States</strong>');
    expect(markup).toContain('<li>Added: read-only</li>');
    expect(markup).toContain('<strong>Tokens</strong>');
    expect(markup).not.toContain('state added');
    expect(markup).not.toContain('values changed');
  });

  it('escapes document and change content before placing it in HTML', () => {
    const markup = libraryScrollMarkup(model({
      allRows: [
        row('unsafe', 'updateAvailable', {
          label: '<Button "Primary">',
          expanded: true,
          changeGroups: [{ label: '<States>', items: ['A & B'] }],
        }),
      ],
      rows: [
        row('unsafe', 'updateAvailable', {
          label: '<Button "Primary">',
          expanded: true,
          changeGroups: [{ label: '<States>', items: ['A & B'] }],
        }),
      ],
      counts: { all: 1, updates: 1, inSync: 0 },
    }));
    expect(markup).toContain('&lt;Button &quot;Primary&quot;&gt;');
    expect(markup).toContain('&lt;States&gt;');
    expect(markup).toContain('<li>A &amp; B</li>');
    expect(markup).not.toContain('<States>');
  });

  it('shows only actions authorized by the row capabilities', () => {
    const markup = libraryScrollMarkup(model({
      rows: [
        row('mappedColors', 'orphaned', {
          canOpenFrame: true,
          canOpenSource: false,
          canDownload: false,
          canReconnect: false,
          canUpdate: false,
          canDetach: false,
          canRemove: true,
        }),
      ],
      allRows: [
        row('mappedColors', 'orphaned', {
          canOpenFrame: true,
          canOpenSource: false,
          canDownload: false,
          canReconnect: false,
          canUpdate: false,
          canDetach: false,
          canRemove: true,
        }),
      ],
      menuDocId: 'mappedColors',
    }));
    expect(markup).toContain('Open documentation frame');
    expect(markup).toContain('Remove connection');
    expect(markup).not.toContain('View source component');
    expect(markup).not.toContain('Download documentation');
    expect(markup).not.toContain('Reconnect');
    expect(markup).not.toContain('Update documentation');
    expect(markup).not.toContain('Review detected changes');
  });

  it('renders state-aware footer actions and locks them during work', () => {
    const idle = libraryFooterMarkup(model());
    expect(idle).toContain('Refresh library');
    expect(idle).toContain('Update all 1');
    expect(idle).not.toContain('data-library-update-all disabled');

    const refreshing = libraryFooterMarkup(model({ refreshing: true }));
    expect(refreshing).toContain('Refreshing…');
    expect(refreshing).toContain('data-library-refresh disabled');
    expect(refreshing).toContain('data-library-update-all disabled');

    const updating = libraryFooterMarkup(model({ updatingAll: true }));
    expect(updating).toContain('Updating…');
    expect(updating).toContain('data-library-refresh disabled');

    const current = libraryFooterMarkup(model({
      allRows: [row('buttonPrimary', 'inSync')],
      rows: [row('buttonPrimary', 'inSync')],
      counts: { all: 1, updates: 0, inSync: 1 },
    }));
    expect(current).toContain('Up to date');
    expect(current).toContain('data-library-update-all disabled');
    // "Up to date" is not a refresh, and sitting beside "Refresh library" a
    // second refresh arrow read as the same button twice.
    expect(refreshArrows(current)).toBe(1);
    expect(refreshArrows(idle)).toBe(2);
  });

  it('renders useful loading and empty states', () => {
    expect(libraryFooterMarkup(model({
      loading: true,
      progress: {
        label: 'Reading Library',
      },
    }))).toContain('Reading Library');
    expect(libraryScrollMarkup(model({ loading: true }))).toContain('sl-loading-row');
    expect(libraryScrollMarkup(model({
      allRows: [],
      rows: [],
      counts: { all: 0, updates: 0, inSync: 0 },
    }))).toContain('No connected documents');
    expect(libraryScrollMarkup(model({
      allRows: [row('buttonPrimary', 'inSync')],
      rows: [],
      filter: 'updates',
      counts: { all: 1, updates: 0, inSync: 1 },
    }))).toContain('Everything is in sync');
  });

  it('shows real batch progress without rendering an in-plugin toast', () => {
    const markup = libraryFooterMarkup(model({
      updatingAll: true,
      progress: {
        label: 'Updating document 2 of 4',
        current: 1,
        total: 4,
      },
    }));
    expect(markup).toContain('Updating document 2 of 4');
    expect(markup).toContain('1 of 4');
    expect(markup).toContain('role="progressbar"');
    expect(markup).not.toContain('sl-banner');
    expect(libraryScrollMarkup(model({
      updatingAll: true,
      progress: {
        label: 'Updating document 2 of 4',
        current: 1,
        total: 4,
      },
    }))).not.toContain('sl-work-status');
  });
});

describe('component vs foundation row differentiation', () => {
  it('gives a foundation row its own icon, distinct from a component row', () => {
    const foundationRow = row('foundations-colors', 'inSync', {
      kind: 'foundation',
      label: 'Foundations · Foundation · colors',
      sourceLabel: 'Foundation',
    });
    const markup = libraryScrollMarkup(model({
      allRows: [row('buttonPrimary', 'inSync'), foundationRow],
      rows: [row('buttonPrimary', 'inSync'), foundationRow],
      counts: { all: 2, updates: 0, inSync: 2 },
    }));
    // Two distinct icon glyphs render — the point of the test is that they
    // differ, not which SVG paths represent them.
    const iconBlocks = [...markup.matchAll(
      /<span class="sl-library-source-icon">(.*?)<\/span>/gs,
    )].map((m) => m[1]);
    expect(iconBlocks).toHaveLength(2);
    expect(iconBlocks[0]).not.toBe(iconBlocks[1]);
  });

  it('gives a foundation row the same glyph the Foundations picker gave its source', () => {
    // The picker's rows for a color collection and for text styles, in order.
    const spec = {
      collections: [{
        id: 'colors',
        name: 'Mapped Colors',
        defaultModeId: 'light',
        modes: [{ modeId: 'light', name: 'Light' }],
        variables: [{ id: 'v0', name: 'color/bg', resolvedType: 'COLOR', valuesByMode: {} }],
      }],
      textStyles: [{ id: 's1', name: 'Body' }],
    } as unknown as FoundationSpec;
    const selection: FoundationSelection = {
      collections: [{ collectionId: 'colors', modeIds: ['light'] }],
      textStyles: true,
    };
    const pickerIcons = [...foundationScrollMarkup({ kind: 'ready' }, spec, selection)
      .matchAll(/<span class="sl-foundation-source-icon">(.*?)<\/span>/gs)]
      .map((m) => m[1]);
    expect(pickerIcons).toHaveLength(2);

    const rows = [
      row('foundations-colors', 'inSync', {
        kind: 'foundation', foundationIcon: 'color',
        label: 'Foundations · Mapped Colors', sourceLabel: 'Mapped Colors',
      }),
      row('foundations-type', 'inSync', {
        kind: 'foundation', foundationIcon: 'typography',
        label: 'Foundations · Text styles', sourceLabel: 'Text styles',
      }),
    ];
    const libraryIcons = [...libraryScrollMarkup(model({
      allRows: rows,
      rows,
      counts: { all: 2, updates: 0, inSync: 2 },
    })).matchAll(/<span class="sl-library-source-icon">(.*?)<\/span>/gs)]
      .map((m) => m[1]);

    expect(libraryIcons).toEqual(pickerIcons);
  });

  it('drops the redundant "Foundations · " prefix from the visible title only', () => {
    const foundationRow = row('foundations-colors', 'inSync', {
      kind: 'foundation',
      label: 'Foundations · Foundation · colors',
      sourceLabel: 'Foundation',
    });
    const markup = libraryScrollMarkup(model({
      allRows: [foundationRow],
      rows: [foundationRow],
      counts: { all: 1, updates: 0, inSync: 1 },
    }));
    expect(markup).toContain('<strong>Foundation · colors</strong>');
    expect(markup).not.toContain('<strong>Foundations · Foundation · colors</strong>');
    // The accessible name keeps the full, unambiguous label — only the
    // on-screen title is shortened. The visible text stays a substring of it.
    expect(markup).toContain('aria-label="Open Foundations · Foundation · colors in Figma"');
  });

  it('leaves a component row label untouched — it never had the prefix', () => {
    const markup = libraryScrollMarkup(model());
    expect(markup).toContain('<strong>buttonText</strong>');
  });

  it('renders the identity as a title alone, with no source subtitle', () => {
    // The subtitle was dropped on purpose: it either repeated the title or
    // named the list the user is already in. Where a locator does earn its
    // place — the global search palette — it still renders.
    const markup = libraryScrollMarkup(model({
      allRows: [row('buttonText', 'inSync')],
      rows: [row('buttonText', 'inSync')],
      counts: { all: 1, updates: 0, inSync: 1 },
    }));
    const identity = /<span class="sl-library-identity">(.*?)<\/span>/s.exec(markup)?.[1];
    expect(identity).toBe('<strong>buttonText</strong>');
  });
});
