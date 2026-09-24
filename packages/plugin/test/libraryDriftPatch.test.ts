// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  patchLibraryDrift,
  renderLibraryScreen,
  type LibraryRowPresentation,
  type LibraryScreenPresentation,
} from '../src/ui/screens/library';
import { mountShell, type ShellRefs } from '../src/ui/shell/shell';

afterEach(() => {
  document.body.innerHTML = '';
});

function row(docId: string, status: LibraryRowPresentation['status']): LibraryRowPresentation {
  return {
    docId, kind: 'component', foundationIcon: null, label: docId,
    sourceLabel: `Components · ${docId}`, sourceNodeId: `source-${docId}`, ageLabel: '3d ago',
    status, expanded: false, canOpenFrame: true, canOpenSource: true,
    canUpdate: status === 'updateAvailable', canDetach: true, canRemove: true, canCopy: false,
    changeGroups: null, changeState: 'idle', changeUnavailableReason: null,
  };
}

function model(rows: LibraryRowPresentation[], overrides: Partial<LibraryScreenPresentation> = {}): LibraryScreenPresentation {
  const pending = rows.some((r) => r.status === 'pending');
  return {
    allRows: rows, rows, filter: 'all',
    counts: {
      all: rows.length,
      updates: rows.filter((r) => r.status === 'updateAvailable' || r.status === 'rebuildNeeded').length,
      inSync: rows.filter((r) => r.status === 'inSync').length,
    },
    menuDocId: null, refreshing: pending, ...overrides,
  };
}

function mount(rows: LibraryRowPresentation[]): ShellRefs {
  const refs = mountShell('library');
  renderLibraryScreen(refs, model(rows));
  return refs;
}

describe('patchLibraryDrift', () => {
  it('replaces only the row whose status changed and updates counts and footer', () => {
    const refs = mount([row('a', 'pending'), row('b', 'pending'), row('c', 'inSync')]);
    const list = refs.scroll.querySelector('.sl-library-list');
    const untouched = refs.scroll.querySelector('.sl-library-row[data-doc-id="c"]');

    const ok = patchLibraryDrift(refs, model([row('a', 'updateAvailable'), row('b', 'pending'), row('c', 'inSync')]));

    expect(ok).toBe(true);
    expect(refs.scroll.querySelector('.sl-library-list')).toBe(list);
    expect(refs.scroll.querySelector('.sl-library-row[data-doc-id="c"]')).toBe(untouched);
    expect(refs.scroll.querySelector('.sl-library-row[data-doc-id="a"] [data-library-status]')?.getAttribute('data-library-status'))
      .toBe('updateAvailable');
    expect(refs.scroll.querySelector('[data-library-filter="updates"] small')?.textContent).toBe('1');
    expect(refs.footer.innerHTML).toContain('Checking…');

    patchLibraryDrift(refs, model([row('a', 'updateAvailable'), row('b', 'inSync'), row('c', 'inSync')]));
    expect(refs.footer.innerHTML).toContain('Update all docs');
    expect(refs.scroll.querySelector('[data-library-filter="sync"] small')?.textContent).toBe('2');
  });

  it('keeps focus on the same control of a redrawn row', () => {
    const refs = mount([row('a', 'pending'), row('b', 'inSync')]);
    refs.scroll.querySelector<HTMLElement>('.sl-library-row[data-doc-id="a"] [data-library-menu]')!.focus();

    patchLibraryDrift(refs, model([row('a', 'inSync'), row('b', 'inSync')]));

    const menu = refs.scroll.querySelector('.sl-library-row[data-doc-id="a"] [data-library-menu]');
    expect(document.activeElement).toBe(menu);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('declines when the patch could not be exact', () => {
    const refs = mount([row('a', 'pending'), row('b', 'inSync')]);
    const next = [row('a', 'inSync'), row('b', 'inSync')];
    expect(patchLibraryDrift(refs, model(next, { filter: 'updates', rows: [] }))).toBe(false);
    expect(patchLibraryDrift(refs, model(next, { loading: true }))).toBe(false);
    expect(patchLibraryDrift(refs, model([row('a', 'rebuildNeeded'), row('b', 'inSync')]))).toBe(false);
    expect(patchLibraryDrift(refs, model([row('a', 'inSync')]))).toBe(false);
    refs.screen.className = 'sl-screen sl-publish-screen';
    expect(patchLibraryDrift(refs, model(next))).toBe(false);
  });

  it('enables the rebuild banner button once the last pending check lands', () => {
    const refs = mount([row('a', 'rebuildNeeded'), row('b', 'pending')]);
    const button = refs.scroll.querySelector<HTMLButtonElement>('[data-library-rebuild-all]');
    expect(button?.hasAttribute('disabled')).toBe(true);

    const ok = patchLibraryDrift(refs, model([row('a', 'rebuildNeeded'), row('b', 'inSync')]));

    expect(ok).toBe(true);
    // Same element: the banner's disabled state is toggled in place, not
    // rebuilt, because the rebuild count did not change.
    expect(refs.scroll.querySelector('[data-library-rebuild-all]')).toBe(button);
    expect(button?.hasAttribute('disabled')).toBe(false);
  });

  it('redraws an open row menu when busy changes, even though that row\'s own status did not', () => {
    const refs = mountShell('library');
    renderLibraryScreen(refs, model([row('a', 'pending'), row('b', 'updateAvailable')], { menuDocId: 'b' }));
    const updateItem = () =>
      refs.scroll.querySelector<HTMLButtonElement>('.sl-library-row[data-doc-id="b"] [data-library-action="update"]');
    expect(updateItem()?.hasAttribute('disabled')).toBe(true);

    // Row 'b' keeps the same status: only 'a' landing flips busy to false.
    const ok = patchLibraryDrift(refs, model([row('a', 'inSync'), row('b', 'updateAvailable')], { menuDocId: 'b' }));

    expect(ok).toBe(true);
    expect(updateItem()?.hasAttribute('disabled')).toBe(false);
  });

  it('keeps focus on a menu item of a redrawn row', () => {
    const refs = mountShell('library');
    renderLibraryScreen(refs, model([row('a', 'pending'), row('b', 'inSync')], { menuDocId: 'a' }));
    refs.scroll.querySelector<HTMLElement>('.sl-library-row[data-doc-id="a"] [data-library-action="detach"]')!.focus();

    const ok = patchLibraryDrift(refs, model([row('a', 'updateAvailable'), row('b', 'inSync')], { menuDocId: 'a' }));

    expect(ok).toBe(true);
    const action = refs.scroll.querySelector('.sl-library-row[data-doc-id="a"] [data-library-action="detach"]');
    expect(document.activeElement).toBe(action);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('keeps focus on the footer Publish button when the footer is redrawn', () => {
    const refs = mount([row('a', 'pending'), row('b', 'inSync')]);
    const before = refs.footer.querySelector<HTMLElement>('[data-publish-open]')!;
    before.focus();

    const ok = patchLibraryDrift(refs, model([row('a', 'updateAvailable'), row('b', 'inSync')]));

    expect(ok).toBe(true);
    const after = refs.footer.querySelector('[data-publish-open]');
    // The footer markup was replaced, so this is a fresh element, and focus
    // followed it rather than falling to the body.
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
  });

  it('keeps focus on the footer Update all button when it stays enabled', () => {
    const refs = mount([row('a', 'updateAvailable'), row('b', 'updateAvailable')]);
    refs.footer.querySelector<HTMLElement>('[data-library-update-all]')!.focus();

    const ok = patchLibraryDrift(refs, model([row('a', 'updateAvailable'), row('b', 'inSync')]));

    expect(ok).toBe(true);
    expect(document.activeElement).toBe(refs.footer.querySelector('[data-library-update-all]'));
  });
});
