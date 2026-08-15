import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FoundationSpec, FoundationSelection } from '@spec-layer/extractor';
import { ICON_PATHS } from '../src/ui/shell/icons';
import type { FoundationScreenState } from '../src/ui/viewModel/contracts';
import {
  foundationFooterMarkup,
  foundationHeaderMarkup,
  foundationScrollMarkup,
} from '../src/ui/screens/foundations';

const SPEC = {
  collections: [
    {
      id: 'colors',
      name: 'Mapped Colors',
      defaultModeId: 'light',
      modes: [
        { modeId: 'light', name: 'Light' },
        { modeId: 'dark', name: 'Dark' },
        { modeId: 'hc', name: 'High contrast' },
      ],
      variables: Array.from({ length: 12 }, (_, index) => ({
        id: `v${index}`,
        name: `Color ${index}`,
        resolvedType: 'COLOR',
        valuesByMode: {},
      })),
    },
    {
      id: 'density',
      name: 'Mapped Density',
      defaultModeId: 'comfortable',
      modes: [{ modeId: 'comfortable', name: 'Comfortable' }],
      variables: [],
    },
  ],
  textStyles: [{ id: 's1', name: 'Body' }, { id: 's2', name: 'Heading' }],
} as unknown as FoundationSpec;

const ALL: FoundationSelection = {
  collections: [
    { collectionId: 'colors', modeIds: ['light', 'dark', 'hc'] },
    { collectionId: 'density', modeIds: ['comfortable'] },
  ],
  textStyles: true,
};

describe('foundation screen', () => {
  it('uses the approved standalone page title', () => {
    expect(foundationHeaderMarkup()).toContain('Foundation documents');
    expect(foundationHeaderMarkup()).not.toContain('<p>');
  });

  it('renders a flat row for every source and the shared bulk control', () => {
    const markup = foundationScrollMarkup({ kind: 'ready' }, SPEC, ALL);
    expect(markup).toContain('3 of 3 included');
    expect(markup).toContain('Clear all');
    expect(markup).toContain('Mapped Colors');
    expect(markup).toContain('Mapped Density');
    expect(markup).toContain('Text styles');
    expect(markup).not.toContain('data-mode');
  });

  it('renders a mixed bulk state for a partial selection', () => {
    const partial = { collections: ALL.collections.slice(0, 1), textStyles: false };
    const markup = foundationScrollMarkup({ kind: 'ready' }, SPEC, partial);
    expect(markup).toContain('1 of 3 included');
    expect(markup).toContain('data-mixed="true"');
    expect(markup).toContain('Select all');
  });

  it('keeps create disabled until at least one source is selected', () => {
    const empty = { collections: [], textStyles: false };
    expect(foundationFooterMarkup({ kind: 'ready' }, SPEC, empty)).toContain('disabled');
    expect(foundationFooterMarkup({ kind: 'ready' }, SPEC, ALL)).not.toContain('disabled');
  });

  /**
   * requestFoundations() (ui-vnext.ts) only ever fires once per session, so a
   * variable or collection added after that first load never appears until
   * this button is clicked — the same gap Library's own refresh button
   * closes for connected docs.
   */
  it('offers a refresh button independent of the create button', () => {
    const markup = foundationFooterMarkup({ kind: 'ready' }, SPEC, ALL);
    expect(markup).toContain('data-foundation-refresh');
    expect(markup).toContain('Refresh sources');
  });

  it('names the action, not the frames it happens to produce', () => {
    // Was "Create 8 frames", which made this one of three identical footer
    // slots name a different kind of thing (an internal storage unit) than the
    // component screen's "Create docs". The frame count lives on the rows that
    // split and in the toolbar. See docs/plugin-voice-and-copy.md.
    const ready = foundationFooterMarkup({ kind: 'ready' }, SPEC, ALL);
    expect(ready).toContain('<span>Create docs</span>');
    expect(ready).not.toMatch(/Create \d+ frames?/);
    expect(
      foundationFooterMarkup({ kind: 'generating', done: 1, total: 3 }, SPEC, ALL),
    ).toContain('Creating docs…');
    // A blocked primary states why instead of naming an action it cannot offer.
    const none: FoundationSelection = { collections: [], textStyles: false };
    expect(foundationFooterMarkup({ kind: 'ready' }, SPEC, none))
      .toContain('Select sources to continue');
  });

  it('asks for a selection only where the user can act on the request', () => {
    const none: FoundationSelection = { collections: [], textStyles: false };
    const ask = 'Select sources to continue';
    const label = (m: string) =>
      /<span>(.*?)<\/span>/.exec(m.split('id="sl-foundation-create"')[1] ?? '')?.[1];

    // The one state where it is true: sources are listed and none are ticked.
    expect(label(foundationFooterMarkup({ kind: 'ready' }, SPEC, none))).toBe(ask);

    // Every other "nothing to build" has a different cause, and the reason is
    // already on screen: the progress line, the empty state, the error banner.
    // Asking for a selection here was impossible to act on.
    const wrongToAsk: Array<[string, FoundationScreenState, FoundationSpec | null]> = [
      ['page load, list is still skeletons', { kind: 'loading' }, null],
      ['file has no variables or text styles', { kind: 'ready' }, null],
      ['read failed, remedy is Refresh sources', { kind: 'error', message: 'x' }, null],
    ];
    for (const [why, state, spec] of wrongToAsk) {
      const markup = foundationFooterMarkup(state, spec, none);
      expect(label(markup), why).toBe('Create docs');
      // ...and still blocked, so naming the act is not an empty offer.
      expect(markup.split('id="sl-foundation-create"')[1].slice(0, 60)).toContain('disabled');
    }
  });

  it('does not stretch the create button across the footer', () => {
    // It carried `flex: 1` while the same slot on the other two screens hugged.
    // The class is now only a JS/test hook, so nothing may re-add a fill.
    const css = readFileSync(
      new URL('../src/ui/design-system/patterns.css', import.meta.url),
      'utf-8',
    );
    expect(css).not.toMatch(/\.sl-foundation-create\s*\{[^}]*flex/);
    expect(css).not.toMatch(/\.sl-footer-actions[^{]*\{[^}]*min-width:\s*\d+px/);
  });

  it('draws all three footer buttons in every state, per the icon contract', () => {
    // One button, one glyph, held through busy and blocked alike. The create
    // button's old `layoutGrid` drew the frames rather than the making of them
    // and was also the sidebar's icon for this screen, which is why it needed
    // replacing rather than removing.
    const none: FoundationSelection = { collections: [], textStyles: false };
    for (const state of [
      foundationFooterMarkup({ kind: 'ready' }, SPEC, ALL),
      foundationFooterMarkup({ kind: 'ready' }, SPEC, none),
      foundationFooterMarkup({ kind: 'generating', done: 1, total: 3 }, SPEC, ALL),
      foundationFooterMarkup({ kind: 'ready' }, SPEC, ALL, true),
    ]) {
      expect(state.match(/<svg/g) ?? []).toHaveLength(3);
      // Refresh keeps the circular arrows; create wears the same `filePlus`
      // the component screen's create button does; Copy for AI wears `copy`.
      expect(state).toContain(ICON_PATHS.refresh);
      expect(state).toContain(ICON_PATHS.copy);
      // Split on the id, not the bare name: the class carries it too, so
      // splitting on `sl-foundation-create` lands between the two attributes
      // in a segment that could never hold an svg either way.
      expect(state.split('id="sl-foundation-create"')[1]).toContain(ICON_PATHS.filePlus);
      expect(state).not.toContain(ICON_PATHS.layoutGrid);
    }
  });

  it('only offers Copy for AI once a foundation has been read', () => {
    expect(foundationFooterMarkup({ kind: 'ready' }, SPEC, ALL)).toContain('id="sl-copy-foundation"');
    expect(foundationFooterMarkup({ kind: 'loading' }, null, ALL))
      .not.toContain('id="sl-copy-foundation"');
    expect(foundationFooterMarkup({ kind: 'ready' }, null, ALL))
      .not.toContain('id="sl-copy-foundation"');
  });

  it('labels and disables the refresh button while a refresh is in flight', () => {
    const markup = foundationFooterMarkup({ kind: 'ready' }, SPEC, ALL, true);
    expect(markup).toContain('Refreshing…');
    expect(markup).toMatch(/data-foundation-refresh disabled/);
    // The create button is untouched by a refresh alone.
    expect(markup).toContain('id="sl-foundation-create" type="button">');
  });

  it('disables refresh while busy, the same as create', () => {
    const markup = foundationFooterMarkup(
      { kind: 'generating', done: 1, total: 3 }, SPEC, ALL,
    );
    expect(markup).toMatch(/data-foundation-refresh disabled/);
  });

  it('shows loading, real progress, and persistent read errors honestly', () => {
    expect(foundationScrollMarkup({ kind: 'loading' }, null, ALL)).toContain('sl-loading-row');
    expect(foundationScrollMarkup({ kind: 'loading' }, null, ALL)).not.toContain('sl-work-status');
    expect(foundationFooterMarkup({ kind: 'loading' }, null, ALL)).toContain('Reading this file');
    expect(foundationFooterMarkup(
      { kind: 'generating', done: 1, total: 3, phase: 'Laying out the tables' },
      SPEC,
      ALL,
    )).toContain('Laying out the tables');
    expect(foundationFooterMarkup(
      { kind: 'generating', done: 1, total: 3 },
      SPEC,
      ALL,
    )).toContain('1 of 3');
    expect(foundationScrollMarkup(
      { kind: 'result', created: 2, replaced: 1 },
      SPEC,
      ALL,
    )).not.toContain('sl-banner');
    expect(foundationScrollMarkup(
      { kind: 'error', message: 'Could not read this file.' },
      null,
      ALL,
    )).toContain('Could not read this file.');
  });
});
