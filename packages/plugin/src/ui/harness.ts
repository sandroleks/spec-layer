/**
 * harness.ts — development entry point. Never shipped.
 *
 * Mounts the vNext shell outside Figma and drives it from the URL so any
 * screen in any state can be opened at 480 x 680 and compared against the
 * archived prototype screenshots in docs/plugin-ui-vnext/prototype/.
 *
 *   ui-harness.html?view=library&allowance=exhausted&theme=light
 *
 * It feeds the same shapes the real UI receives. It must never gain behavior
 * of its own: anything it can do that the plugin cannot is a lie about the
 * thing we are verifying.
 */

import type { FoundationSpec, FoundationSelection } from '@spec-layer/extractor';
import {
  THEME_PRESETS,
  parseBrandHex,
  type BrandTheme,
} from '../brandColors';
import type {
  AllowanceState,
  ComponentScreenState,
  FoundationScreenState,
  LicenseState,
  PluginView,
} from './viewModel/contracts';
import type { GroupId } from './docModel';
import { mountShell, setActiveView, wireShellTheme } from './shell/shell';
import { renderAllowance } from './shell/header';
import { createComponentSelection, renderComponentScreen } from './screens/component';
import { renderFoundationScreen } from './screens/foundations';
import { renderSettingsScreen, type SettingsScreenState } from './screens/settings';
import {
  renderLicenseScreen,
  type LicenseScreenModel,
} from './screens/license';
import {
  clearAll,
  selectAll,
  toggleCollection,
  toggleTextStyles,
} from './foundationState';
import { type ThemeMode } from './theme';
import { NO_FACTS, type ComponentFacts } from './viewModel/componentFacts';

/**
 * Each fixture must actually render the tone it is named after. LOW_REMAINING
 * is 5, so a "normal" fixture needs more than 5 remaining: 4 of 5 would render
 * amber and quietly invalidate every visual check made against it. Limits track
 * the real free tier, MONTHLY_LIMIT = 10.
 */
const ALLOWANCES: Record<string, AllowanceState> = {
  loading: { kind: 'loading' },
  normal: { kind: 'free', remaining: 8, limit: 10, resetsAt: '2026-08-01T00:00:00Z' },
  low: { kind: 'free', remaining: 4, limit: 10, resetsAt: '2026-08-01T00:00:00Z' },
  exhausted: { kind: 'free', remaining: 0, limit: 10, resetsAt: '2026-08-01T00:00:00Z' },
  pro: { kind: 'pro' },
  unknown: { kind: 'unknown', message: 'Plan status unavailable' },
};

const VIEWS: PluginView[] = ['component', 'foundations', 'library', 'settings', 'license'];

function param(name: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

const view = param('view', 'component') as PluginView;
const refs = mountShell(VIEWS.includes(view) ? view : 'component');

const theme = param('theme', 'dark') as ThemeMode;
// The real wiring, seeded from the URL instead of from Figma. Re-implementing
// it here would leave the harness's theme button inert and its accessible name
// out of step with the plugin's, which is its own kind of lie.
wireShellTheme(refs, theme === 'light' ? 'light' : 'dark');

setActiveView(refs, VIEWS.includes(view) ? view : 'component');
renderAllowance(refs.header, ALLOWANCES[param('allowance', 'normal')] ?? ALLOWANCES.normal);

/** The component screen's states, keyed for `?state=`. */
const COMPONENT_STATES: Record<string, ComponentScreenState> = {
  empty: { kind: 'empty' },
  reading: { kind: 'reading', componentName: 'buttonPrimary' },
  ready: { kind: 'ready', componentName: 'buttonPrimary' },
  building: { kind: 'building', componentName: 'buttonPrimary', action: 'create' },
  downloading: { kind: 'building', componentName: 'buttonPrimary', action: 'download' },
  success: { kind: 'success', componentName: 'buttonPrimary', replaced: false },
  warning: {
    kind: 'success',
    componentName: 'buttonPrimary',
    replaced: false,
    message: 'Docs created. AI did not run, so placeholders were used',
    warning: true,
  },
  error: {
    kind: 'error',
    componentName: 'buttonPrimary',
    message: 'Frame failed: the component has no variants to read.',
  },
};

/** Canned facts. Real components derive these from the extracted spec. */
const FACTS: Record<string, ComponentFacts> = {
  unknown: NO_FACTS,
  none: { ...NO_FACTS, hasStates: false },
  atom: { ...NO_FACTS, isAtom: true, hasStates: false },
  states: { ...NO_FACTS, hasStates: true },
  variants: {
    ...NO_FACTS,
    hasStates: true,
    variants: [
      {
        nodeId: '1:1',
        chips: [{ text: 'Small', axis: 'Size', tone: 'value', title: 'Size: Small' }],
      },
      {
        nodeId: '1:2',
        chips: [{ text: 'Large', axis: 'Size', tone: 'value', title: 'Size: Large' }],
      },
      {
        nodeId: '1:3',
        chips: [{ text: 'Disabled', tone: 'flag', title: 'Disabled: true' }],
      },
    ],
    defaultVariantIds: new Set(['1:1']),
  },
};

if (view === 'component') {
  const screen = COMPONENT_STATES[param('state', 'ready')] ?? COMPONENT_STATES.ready;
  const selection = createComponentSelection(param('ai', 'on') !== 'off');
  // The harness paints once and wires nothing, so which groups are open has to
  // come from the URL rather than from clicking: ?expand=usage,specs
  const expand = param('expand', 'usage').split(',').filter(Boolean);
  selection.expanded = new Set(expand as GroupId[]);
  selection.variantsExpanded = param('variants', 'collapsed') === 'expanded';
  const fallbackFacts = screen.kind === 'reading' ? 'unknown' : 'none';
  const facts = FACTS[param('facts', fallbackFacts)] ?? FACTS[fallbackFacts];
  selection.variantIds = new Set(facts.defaultVariantIds);
  renderComponentScreen(refs, screen, selection, facts);
}

const FOUNDATION_SPEC = {
  collections: [
    {
      id: 'mapped-colors',
      name: 'Mapped Colors',
      defaultModeId: 'light',
      modes: [
        { modeId: 'light', name: 'Light' },
        { modeId: 'dark', name: 'Dark' },
        { modeId: 'contrast', name: 'High contrast' },
      ],
      variables: Array.from({ length: 138 }, (_, index) => ({
        id: `color-${index}`,
        name: `Mapped/Color ${index + 1}`,
        resolvedType: 'COLOR',
        valuesByMode: {},
      })),
    },
    {
      id: 'foundation',
      name: 'Foundation',
      defaultModeId: 'default',
      modes: [{ modeId: 'default', name: 'Default' }],
      variables: Array.from({ length: 178 }, (_, index) => ({
        id: `foundation-${index}`,
        name: `Group ${Math.min(5, Math.floor(index / 36) + 1)}/Token ${index + 1}`,
        resolvedType: 'FLOAT',
        valuesByMode: {},
      })),
    },
    {
      id: 'mapped-density',
      name: 'Mapped Density',
      defaultModeId: 'comfortable',
      modes: [
        { modeId: 'compact', name: 'Compact' },
        { modeId: 'comfortable', name: 'Comfortable' },
        { modeId: 'spacious', name: 'Spacious' },
      ],
      variables: Array.from({ length: 24 }, (_, index) => ({
        id: `density-${index}`,
        name: `Density/Token ${index + 1}`,
        resolvedType: 'FLOAT',
        valuesByMode: {},
      })),
    },
    {
      id: 'mapped-radius',
      name: 'Mapped Radius',
      defaultModeId: 'default',
      modes: [
        { modeId: 'compact', name: 'Compact' },
        { modeId: 'default', name: 'Default' },
        { modeId: 'rounded', name: 'Rounded' },
        { modeId: 'pill', name: 'Pill' },
      ],
      variables: Array.from({ length: 7 }, (_, index) => ({
        id: `radius-${index}`,
        name: `Radius/Token ${index + 1}`,
        resolvedType: 'FLOAT',
        valuesByMode: {},
      })),
    },
  ],
  textStyles: Array.from({ length: 21 }, (_, index) => ({
    id: `style-${index}`,
    name: `Text style ${index + 1}`,
  })),
} as unknown as FoundationSpec;

const FOUNDATION_SELECTION: FoundationSelection = {
  collections: FOUNDATION_SPEC.collections.map((collection) => ({
    collectionId: collection.id,
    modeIds: collection.modes.slice(0, 4).map((mode) => mode.modeId),
  })),
  textStyles: true,
};

if (view === 'foundations') {
  const stateName = param('state', 'ready');
  const state: FoundationScreenState =
    stateName === 'loading' ? { kind: 'loading' }
      : stateName === 'error' ? { kind: 'error', message: 'Could not read this file.' }
        : stateName === 'progress' ? { kind: 'generating', done: 2, total: 9 }
          : stateName === 'result' ? { kind: 'result', created: 4, replaced: 5 }
            : { kind: 'ready' };
  let foundationSelection = param('selection', 'all') === 'partial'
    ? {
        collections: FOUNDATION_SELECTION.collections.slice(0, 2),
        textStyles: false,
      }
    : FOUNDATION_SELECTION;
  renderFoundationScreen(refs, state, FOUNDATION_SPEC, foundationSelection);

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-foundation-bulk]')) {
      const all = foundationSelection.collections.length === FOUNDATION_SPEC.collections.length
        && foundationSelection.textStyles;
      foundationSelection = all ? clearAll() : selectAll(FOUNDATION_SPEC);
      renderFoundationScreen(refs, state, FOUNDATION_SPEC, foundationSelection);
      return;
    }

    const source = target.closest<HTMLButtonElement>('[data-foundation-source]');
    if (!source?.dataset.foundationSource) return;
    const checked = source.getAttribute('aria-pressed') !== 'true';
    foundationSelection = source.dataset.textStyles === 'true'
      ? toggleTextStyles(foundationSelection, checked)
      : toggleCollection(
          foundationSelection,
          FOUNDATION_SPEC,
          source.dataset.foundationSource,
          checked,
        );
    renderFoundationScreen(refs, state, FOUNDATION_SPEC, foundationSelection);
  });
}

if (view === 'settings') {
  const frameTheme = param('frameTheme', 'tech');
  const fixtureTheme = frameTheme === 'custom'
    ? THEME_PRESETS[0].theme
    : THEME_PRESETS.find((item) => item.name.toLowerCase() === frameTheme)?.theme
      ?? THEME_PRESETS[2].theme;
  let settingsState: SettingsScreenState = {
    theme: { ...fixtureTheme },
    customMode: frameTheme === 'custom',
    logoAttached: param('logo', 'empty') === 'attached',
  };
  let customDraft: BrandTheme = { ...THEME_PRESETS[0].theme };
  const renderSettingsFixture = () => renderSettingsScreen(refs, settingsState);
  renderSettingsFixture();

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-theme-preset="__custom__"]')) {
      settingsState = {
        ...settingsState,
        theme: { ...customDraft },
        customMode: true,
      };
      renderSettingsFixture();
      document.querySelector<HTMLElement>('[data-theme-preset="__custom__"]')?.focus();
      return;
    }
    const choice = target.closest<HTMLButtonElement>('[data-theme-preset]');
    if (choice?.dataset.themePreset) {
      const preset = THEME_PRESETS.find((item) => item.name === choice.dataset.themePreset);
      if (!preset) return;
      settingsState = {
        ...settingsState,
        theme: { ...preset.theme },
        customMode: false,
        colorError: undefined,
        fontWarning: undefined,
      };
      renderSettingsFixture();
      document.querySelector<HTMLElement>(
        `[data-theme-preset="${choice.dataset.themePreset}"]`,
      )?.focus();
      return;
    }
    if (target.closest('[data-settings-logo-capture]')) {
      settingsState = { ...settingsState, logoAttached: true, logoError: undefined };
      renderSettingsFixture();
      return;
    }
    if (target.closest('[data-settings-logo-remove]')) {
      settingsState = { ...settingsState, logoAttached: false, logoError: undefined };
      renderSettingsFixture();
    }
  });

  document.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const colorField = input.dataset.themeField as
      | 'headerBg'
      | 'accent'
      | 'bodyText'
      | 'tableHeadBg'
      | undefined;
    if (colorField) {
      const value = parseBrandHex(input.value);
      if (!value) {
        settingsState = {
          ...settingsState,
          colorError: 'Enter a 6-digit hex color, e.g. #0d2436.',
        };
      } else {
        customDraft = {
          ...settingsState.theme,
          [colorField]: value,
        } as BrandTheme;
        settingsState = {
          ...settingsState,
          theme: { ...customDraft },
          colorError: undefined,
        };
      }
      renderSettingsFixture();
      return;
    }
    const fontField = input.dataset.themeFont as 'headingFont' | 'bodyFont' | undefined;
    if (fontField) {
      customDraft = {
        ...settingsState.theme,
        [fontField]: input.value.trim() || null,
      };
      settingsState = {
        ...settingsState,
        theme: { ...customDraft },
      };
      renderSettingsFixture();
    }
  });

  document.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const colorField = input.dataset.themeField as
      | 'headerBg'
      | 'accent'
      | 'bodyText'
      | 'tableHeadBg'
      | undefined;
    if (!colorField) return;
    const value = parseBrandHex(input.value);
    if (!value) {
      const hint = document.querySelector<HTMLElement>('[data-settings-color-hint]');
      if (hint) hint.textContent = 'Enter a 6-digit hex color, e.g. #0d2436.';
      return;
    }
    customDraft = {
      ...settingsState.theme,
      [colorField]: value,
    } as BrandTheme;
    settingsState = {
      ...settingsState,
      theme: { ...customDraft },
      colorError: undefined,
    };
    renderSettingsFixture();
    document.querySelector<HTMLInputElement>(`[data-theme-field="${colorField}"]`)?.focus();
  });
}

if (view === 'license') {
  let licenseState = param('licenseState', 'free') as LicenseState;
  const stored = ['pro', 'expired', 'inactive', 'unknown', 'removing'].includes(licenseState);
  const failedAttempt = [
    'invalid',
    'disabled',
    'device-limit',
    'unreachable',
  ].includes(licenseState);
  const fixtureKey = stored
    ? 'SPEC-PRO-DEMO-64PN'
    : failedAttempt
      ? `SPEC-${licenseState.toUpperCase()}-DEMO`
      : '';
  let licenseModel: LicenseScreenModel = {
    state: licenseState,
    licenseKey: stored ? fixtureKey : '',
    input: fixtureKey,
    remaining: 4,
    limit: 10,
    resetsAt: '2026-08-01T00:00:00Z',
  };
  const renderLicenseFixture = () => {
    renderAllowance(
      refs.header,
      licenseModel.state === 'pro' || licenseModel.state === 'removing'
        ? { kind: 'pro' }
        : licenseModel.state === 'unknown'
          ? { kind: 'unknown', message: 'Plan status unavailable' }
          : {
              kind: 'free',
              remaining: licenseModel.remaining,
              limit: licenseModel.limit,
              resetsAt: licenseModel.resetsAt,
            },
    );
    renderLicenseScreen(refs, licenseModel);
  };
  renderLicenseFixture();

  document.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches('[data-license-input]')) return;
    licenseModel = {
      ...licenseModel,
      input: input.value,
      state: ['invalid', 'disabled', 'device-limit', 'unreachable', 'removed'].includes(
        licenseModel.state,
      )
        ? 'free'
        : licenseModel.state,
    };
    const activate = document.querySelector<HTMLButtonElement>('[data-license-activate]');
    if (activate) activate.disabled = !input.value.trim();
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-license-form]')) return;
    event.preventDefault();
    const key = licenseModel.input.trim();
    if (!key) return;
    const normalized = key.toUpperCase();
    licenseState = normalized.includes('EXPIRED')
      ? 'expired'
      : normalized.includes('INACTIVE')
        ? 'inactive'
        : normalized.includes('DISABLED')
          ? 'disabled'
          : normalized.includes('DEVICE')
            ? 'device-limit'
            : normalized.includes('OFFLINE')
              ? 'unreachable'
              : normalized.startsWith('SPEC-PRO')
                ? 'pro'
                : 'invalid';
    licenseModel = {
      ...licenseModel,
      state: licenseState,
      licenseKey: ['pro', 'expired', 'inactive'].includes(licenseState) ? key : '',
    };
    renderLicenseFixture();
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-license-retry]')) {
      licenseModel = { ...licenseModel, state: 'inactive', input: licenseModel.licenseKey };
      renderLicenseFixture();
      return;
    }
    if (target.closest('[data-license-remove]')) {
      licenseModel = {
        ...licenseModel,
        state: 'removed',
        licenseKey: '',
        input: '',
      };
      renderLicenseFixture();
    }
  });
}
