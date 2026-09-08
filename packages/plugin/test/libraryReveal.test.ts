// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  libraryScrollMarkup,
  revealLibraryRow,
  type LibraryRowPresentation,
  type LibraryScreenPresentation,
} from '../src/ui/screens/library';
import type { ShellRefs } from '../src/ui/shell/shell';

/**
 * Covers where focus lands when the global search palette hands a document off
 * to its Library row. The scroll arithmetic is covered by revealScrollTop in
 * libraryScreen.test.ts: happy-dom reports no layout, so measuring it here
 * would assert zeroes.
 */

afterEach(() => {
  document.body.innerHTML = '';
});

function row(
  docId: string,
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
    status: 'inSync',
    expanded: false,
    canOpenFrame: true,
    canOpenSource: true,
    canReconnect: false,
    canUpdate: false,
    canDetach: true,
    canRemove: true,
    canCopy: false,
    changeGroups: null,
    changeState: 'idle',
    changeUnavailableReason: null,
    ...overrides,
  };
}

const ROWS = [
  row('buttonPrimary'),
  // No frame to open, so its identity renders as a static div.
  row('buttonMissing', {
    status: 'orphaned',
    canOpenFrame: false,
    canOpenSource: false,
  }),
];

function mount(revealedDocId: string | null): ShellRefs {
  const scroll = document.createElement('div');
  const model: LibraryScreenPresentation = {
    allRows: ROWS,
    rows: ROWS,
    filter: 'all',
    counts: { all: ROWS.length, updates: 0, inSync: 1 },
    menuDocId: null,
    revealedDocId,
  };
  scroll.innerHTML = libraryScrollMarkup(model);
  document.body.append(scroll);
  return { scroll } as unknown as ShellRefs;
}

describe('revealLibraryRow', () => {
  it('focuses the revealed row’s own Open control', () => {
    const refs = mount('buttonPrimary');
    revealLibraryRow(refs, 'buttonPrimary');
    expect(document.activeElement?.getAttribute('aria-label'))
      .toBe('Open buttonPrimary in Figma');
  });

  it('falls back to the row menu when the row has no frame to open', () => {
    const refs = mount('buttonMissing');
    revealLibraryRow(refs, 'buttonMissing');
    expect(document.activeElement?.getAttribute('aria-label'))
      .toBe('Actions for buttonMissing');
  });

  it('does nothing when the doc is not in the rendered rows', () => {
    const refs = mount(null);
    const before = document.activeElement;
    revealLibraryRow(refs, 'notRendered');
    expect(document.activeElement).toBe(before);
    expect(refs.scroll.scrollTop).toBe(0);
  });
});
