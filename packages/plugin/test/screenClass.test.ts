import { describe, expect, it } from 'vitest';
import type { FoundationSelection, FoundationSpec } from '@spec-layer/extractor';
import { THEME_PRESETS } from '../src/brandColors';
import type { ShellRefs } from '../src/ui/shell/shell';
import {
  createComponentSelection,
  renderComponentScreen,
} from '../src/ui/screens/component';
import { renderFoundationScreen } from '../src/ui/screens/foundations';
import { renderLibraryScreen } from '../src/ui/screens/library';
import { renderSettingsScreen } from '../src/ui/screens/settings';
import { renderLicenseScreen } from '../src/ui/screens/license';
import { NO_FACTS } from '../src/ui/viewModel/componentFacts';

/**
 * Every screen renderer owns the screen element's whole class, because the
 * per-screen `.sl-screen-scroll` padding rules all have equal specificity and
 * are told apart only by these classes plus stylesheet order.
 *
 * renderComponentScreen used to `classList.add` instead of assigning, so the
 * previous screen's class stayed behind: returning from Settings or License left
 * `sl-settings-screen sl-component-screen`, and Settings' rule (later in the
 * file) won, giving the component screen 16px of horizontal padding and a 16px
 * header indent that were not its own. Going to Library or Foundations looked
 * like a fix only because their padding is 0, matching this screen's.
 */

/** Just enough of an element for these renderers, with a real class list. */
function stubElement(): HTMLElement {
  const el = {
    className: '',
    innerHTML: '',
    hidden: false,
    scrollTop: 0,
    classList: {
      add(name: string) {
        const parts = el.className.split(' ').filter(Boolean);
        if (!parts.includes(name)) el.className = [...parts, name].join(' ');
      },
      contains(name: string) {
        return el.className.split(' ').filter(Boolean).includes(name);
      },
      toggle: () => false,
      remove: () => undefined,
    },
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, width: 0 }),
  };
  return el as unknown as HTMLElement;
}

function stubRefs(): ShellRefs {
  const refs = {
    root: stubElement(),
    header: stubElement(),
    sidebar: stubElement(),
    screen: stubElement(),
    pageHeader: stubElement(),
    scroll: stubElement(),
    footer: stubElement(),
    themeButton: stubElement(),
    searchButton: stubElement(),
    allowanceButton: stubElement(),
  };
  return refs as unknown as ShellRefs;
}

const SPEC = {
  collections: [{
    id: 'c1', name: 'Semantic', variableCount: 2,
    modes: [{ modeId: 'm1', name: 'Light' }],
    variables: [{ id: 'v', name: 'bg', resolvedType: 'COLOR' }],
  }],
  textStyles: [],
} as unknown as FoundationSpec;
const SELECTION: FoundationSelection = {
  collections: [{ collectionId: 'c1', modeIds: ['m1'] }],
  textStyles: false,
};

/** Every screen, and the exact class each one must leave behind. */
const SCREENS: Array<{ name: string; expected: string; render: (refs: ShellRefs) => void }> = [
  {
    name: 'component',
    expected: 'sl-screen sl-component-screen',
    render: (refs) => renderComponentScreen(
      refs,
      { kind: 'ready', componentName: 'buttonPrimary' },
      createComponentSelection(false),
      NO_FACTS,
    ),
  },
  {
    name: 'foundations',
    expected: 'sl-screen sl-foundation-screen',
    render: (refs) => renderFoundationScreen(refs, { kind: 'ready' }, SPEC, SELECTION),
  },
  {
    name: 'library',
    expected: 'sl-screen sl-library-screen',
    render: (refs) => renderLibraryScreen(refs, {
      allRows: [], rows: [], filter: 'all',
      counts: { all: 0, updates: 0, inSync: 0 },
      menuDocId: null,
    }),
  },
  {
    name: 'settings',
    expected: 'sl-screen sl-settings-screen',
    render: (refs) => renderSettingsScreen(refs, {
      theme: { ...THEME_PRESETS[0].theme },
      customMode: false,
      logoAttached: false,
    }),
  },
  {
    name: 'license',
    expected: 'sl-screen sl-settings-screen sl-license-screen',
    render: (refs) => renderLicenseScreen(refs, {
      view: 'free', statusCopy: '', meter: null, input: '', busy: false,
    } as never),
  },
];

describe('screen class ownership', () => {
  it('sets the same class whether a screen is entered first or after another', () => {
    for (const screen of SCREENS) {
      const fresh = stubRefs();
      screen.render(fresh);
      expect(fresh.screen.className, `${screen.name} on a fresh shell`)
        .toBe(screen.expected);
    }
  });

  it('never inherits the class of the screen shown before it', () => {
    // The reported bug: Settings then back to the component screen. Checked in
    // both directions for every pair, since order decides which rule wins.
    for (const first of SCREENS) {
      for (const second of SCREENS) {
        if (first === second) continue;
        const refs = stubRefs();
        first.render(refs);
        second.render(refs);
        expect(refs.screen.className, `${second.name} entered after ${first.name}`)
          .toBe(second.expected);
      }
    }
  });

  it('is idempotent, so a repaint cannot accumulate classes', () => {
    for (const screen of SCREENS) {
      const refs = stubRefs();
      screen.render(refs);
      screen.render(refs);
      screen.render(refs);
      expect(refs.screen.className, `${screen.name} repainted`).toBe(screen.expected);
    }
  });
});
