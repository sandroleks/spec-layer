import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FoundationSelection, FoundationSpec } from '@spec-layer/extractor';
import { foundationScrollMarkup } from '../src/ui/screens/foundations';
import { ICON_PATHS } from '../src/ui/shell/icons';
import {
  libraryFooterMarkup,
  libraryHeaderMarkup,
  libraryScrollMarkup,
  rowMenuTop,
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
    // Names the object, not the count. The count is on the Updates filter, and
    // "all" is what separates this from a row's own "Update documentation".
    expect(idle).toContain('Update all docs');
    expect(idle).not.toMatch(/Update all \d/);
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
    // Per the icon contract's tie-break: circular arrows mean "re-reads,
    // writes nothing", so they belong to "Refresh library" and not to the
    // "Update all docs" beside it, whatever state that one is in. Two identical
    // glyphs in one row read as the same button twice, which is why update got
    // `fileCheck` of its own rather than a second pair of arrows.
    const states = [
      idle,
      current,
      libraryFooterMarkup(model({ updatingAll: true })),
      libraryFooterMarkup(model({ checksIncomplete: true })),
      libraryFooterMarkup(model({ refreshing: true })),
    ];
    for (const state of states) {
      expect(refreshArrows(state)).toBe(1);
      // One button, one glyph: the primary is drawn in every state, always the
      // same one. It used to swap refresh/alertCircle/check as the state moved.
      expect(state.split('sl-library-update-all')[1]).toContain(ICON_PATHS.fileCheck);
      expect(state).not.toContain(ICON_PATHS.alertCircle);
      expect(state.match(/<svg/g)).toHaveLength(2);
    }
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

/**
 * The row menu lives inside .sl-screen-scroll, which clips it, with the sticky
 * footer opaque below. rowMenuTop decides where an open menu goes; these cover
 * the arithmetic without a layout engine. A 528px viewport at 96..624 is the
 * real plugin panel measured in the dev harness.
 */
describe('rowMenuTop', () => {
  const VIEW = { viewTop: 96, viewBottom: 624 };
  const BELOW_TOP = 42;
  const EDGE = 8;

  it('does not intervene when the menu fits below the row', () => {
    expect(rowMenuTop({ ...VIEW, rowTop: 144, height: 243 })).toBeNull();
  });

  it('flips a menu above the row when it would overflow the viewport', () => {
    // Below would end at 506 + 42 + 153 = 701, past the 624 boundary.
    const top = rowMenuTop({ ...VIEW, rowTop: 506, height: 153 });
    expect(top).toBe(7 - 153);
    // Row-relative, so the menu's viewport bottom clears the footer.
    expect(506 + (top as number) + 153).toBeLessThanOrEqual(624);
  });

  it('keeps the flipped menu inside the top of the viewport', () => {
    // The squeeze: a 7-action menu on a row too low to open below (it would
    // end at 335 + 42 + 243 = 620, past 624 - 8) but too high to mirror
    // cleanly (that puts its top at 335 + 7 - 243 = 99, above 96 + 8).
    const top = rowMenuTop({ ...VIEW, rowTop: 335, height: 243 });
    expect(335 + (top as number)).toBe(VIEW.viewTop + EDGE);
    expect(335 + (top as number) + 243).toBeLessThanOrEqual(VIEW.viewBottom);
  });

  it('never leaves the menu clipped at both ends when it fits at all', () => {
    for (const rowTop of [100, 200, 300, 400, 500, 600]) {
      for (const height of [93, 153, 213, 243]) {
        const top = rowMenuTop({ ...VIEW, rowTop, height });
        const menuTop = rowTop + (top ?? BELOW_TOP);
        expect(menuTop).toBeGreaterThanOrEqual(VIEW.viewTop);
        expect(menuTop + height).toBeLessThanOrEqual(VIEW.viewBottom);
      }
    }
  });

  it('top-aligns rather than hiding the first items when nothing fits', () => {
    // Menu taller than the viewport itself: neither bound can be satisfied.
    const top = rowMenuTop({ ...VIEW, rowTop: 300, height: 900 });
    expect(300 + (top as number)).toBe(VIEW.viewTop + EDGE);
  });
});

describe('footer work status', () => {
  const css = readFileSync(
    new URL('../src/ui/design-system/patterns.css', import.meta.url),
    'utf-8',
  );
  const rule = (selector: string) =>
    new RegExp(`\\n\\${selector}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

  it('floats the progress instead of adding a row to the footer', () => {
    // Measured before this: starting a Library refresh took the footer from
    // 56px to 106px, so the scroll viewport lost 50px, the whole list reflowed
    // and both buttons moved out from under the cursor. Starting work must not
    // relayout the screen behind it, so the progress leaves the grid.
    const progress = rule('.sl-footer-progress');
    expect(progress).toMatch(/position:\s*absolute/);
    expect(progress).toMatch(/bottom:\s*calc\(100%/);
    // ...anchored to the footer, or `absolute` would escape to the whole shell.
    expect(rule('.sl-screen-footer')).toMatch(/position:\s*relative/);
  });

  it('keeps the footer a fixed band, so it cannot grow a second row', () => {
    const footer = rule('.sl-screen-footer');
    expect(footer).toMatch(/min-height:\s*var\(--sl-footer-height\)/);
    // The list's bottom clearance is what keeps the floating card off the last
    // row at the end of a scroll; it tracks the same footer height.
    expect(rule('.sl-library-list')).toMatch(/padding:\s*0 0 68px/);
  });
});
