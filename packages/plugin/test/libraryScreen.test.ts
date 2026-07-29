import { describe, expect, it } from 'vitest';
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
          sourceLabel: 'Components & actions',
          expanded: true,
          changeGroups: [{ label: '<States>', items: ['A & B'] }],
        }),
      ],
      rows: [
        row('unsafe', 'updateAvailable', {
          label: '<Button "Primary">',
          sourceLabel: 'Components & actions',
          expanded: true,
          changeGroups: [{ label: '<States>', items: ['A & B'] }],
        }),
      ],
      counts: { all: 1, updates: 1, inSync: 0 },
    }));
    expect(markup).toContain('&lt;Button &quot;Primary&quot;&gt;');
    expect(markup).toContain('Components &amp; actions');
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
  });

  it('renders useful loading and empty states', () => {
    expect(libraryFooterMarkup(model({
      loading: true,
      progress: {
        label: 'Reading Library',
        detail: 'Loading connected documentation',
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
