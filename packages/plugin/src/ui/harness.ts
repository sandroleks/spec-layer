/**
 * harness.ts — development entry point. Never shipped.
 *
 * Mounts the vNext shell outside Figma and drives it from the URL so any
 * screen in any state can be opened at 480 x 680 and compared against the
 * archived prototype screenshots in docs/plugin-ui-vnext/prototype/.
 *
 *   ui-harness.html?view=library&allowance=exhausted&theme=light
 *   ui-harness.html?view=library&pane=publish&publish=published
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
import type { LibraryEntry } from '../messages';
import type { GroupId, SectionId } from './docModel';
import { mountShell, setActiveView, wireShellTheme } from './shell/shell';
import { renderAllowance } from './shell/header';
import { createComponentSelection, renderComponentScreen } from './screens/component';
import { renderFoundationScreen } from './screens/foundations';
import { renderSettingsScreen, type SettingsScreenState } from './screens/settings';
import { renderLibraryScreen } from './screens/library';
import { renderPublishScreen } from './screens/publish';
import type { PublishState } from './publish';
import { globalSearchMarkup } from './screens/search';
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
import {
  buildLibraryModel,
  type LibraryDriftState,
  type LibraryFilter,
} from './viewModel/library';
import { setRailBadge } from './shell/sidebar';
import {
  buildSearchModel,
  nextSearchIndex,
  type SearchDocument,
} from './viewModel/search';
import {
  applyGroupBulk,
  applyVariantBulk,
  sectionGroups,
  unavailableSections,
  variantBulkState,
  variantCountLabel,
} from './viewModel/componentScreen';

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
  manyVariants: {
    ...NO_FACTS,
    hasStates: true,
    variants: Array.from({ length: 36 }, (_, index) => ({
      nodeId: `many:${index + 1}`,
      chips: [
        {
          text: ['Small', 'Medium', 'Large'][index % 3],
          axis: 'Size',
          tone: 'value' as const,
          title: `Size: ${['Small', 'Medium', 'Large'][index % 3]}`,
        },
        {
          text: ['Default', 'Hover', 'Pressed', 'Disabled'][index % 4],
          axis: 'State',
          tone: 'value' as const,
          title: `State: ${['Default', 'Hover', 'Pressed', 'Disabled'][index % 4]}`,
        },
      ],
    })),
    defaultVariantIds: new Set(['many:1']),
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
  const renderComponentFixture = () => renderComponentScreen(refs, screen, selection, facts);
  const repaintComponentFixture = (selector?: string) => {
    const scrollTop = refs.scroll.scrollTop;
    renderComponentFixture();
    refs.scroll.scrollTop = scrollTop;
    if (selector) {
      document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    }
  };
  const syncVariantFixture = () => {
    const inputs = [
      ...refs.scroll.querySelectorAll<HTMLInputElement>('[data-variant]'),
    ];
    for (const input of inputs) {
      const selected = Boolean(
        input.dataset.variant && selection.variantIds.has(input.dataset.variant),
      );
      input.checked = selected;
      input.closest('.sl-section-row')?.classList.toggle('is-selected', selected);
    }
    const selectedCount = inputs.filter((input) => input.checked).length;
    const count = refs.scroll.querySelector<HTMLElement>('[data-variant-count]');
    if (count) count.textContent = variantCountLabel(selectedCount, inputs.length);
    const bulk = refs.scroll.querySelector<HTMLInputElement>('[data-variants-bulk]');
    if (bulk) {
      const state = variantBulkState(
        selection.variantIds,
        inputs.flatMap((input) => input.dataset.variant ? [input.dataset.variant] : []),
      );
      bulk.checked = state.checked;
      bulk.indeterminate = state.mixed;
      bulk.dataset.mixed = String(state.mixed);
      bulk.setAttribute('aria-checked', state.mixed ? 'mixed' : String(state.checked));
    }
  };
  renderComponentFixture();

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const group = target.closest<HTMLButtonElement>('[data-group]');
    if (group?.dataset.group) {
      const groupId = group.dataset.group as GroupId;
      if (selection.expanded.has(groupId)) selection.expanded.delete(groupId);
      else selection.expanded.add(groupId);
      repaintComponentFixture(`[data-group="${groupId}"]`);
      return;
    }
    if (target.closest('[data-variants]')) {
      selection.variantsExpanded = !selection.variantsExpanded;
      repaintComponentFixture('[data-variants]');
      return;
    }
    const measure = target.closest<HTMLButtonElement>('[data-measure]');
    if (measure?.dataset.measure && measure.getAttribute('aria-disabled') !== 'true') {
      const id = measure.dataset.measure as 'size' | 'padding' | 'spacing';
      if (selection.measureViews.has(id)) selection.measureViews.delete(id);
      else selection.measureViews.add(id);
      repaintComponentFixture(`[data-measure="${id}"]`);
    }
  });

  document.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const groupId = input.dataset.groupBulk as GroupId | undefined;
    if (groupId) {
      const unavailable = unavailableSections(facts);
      const groupState = sectionGroups(
        selection.sections,
        selection.expanded,
        selection.aiEnabled,
        unavailable,
      ).find((item) => item.id === groupId);
      if (!groupState) return;
      applyGroupBulk(
        selection.sections,
        groupId,
        groupState.included < groupState.total,
        unavailable,
      );
      repaintComponentFixture(`[data-group-bulk="${groupId}"]`);
      return;
    }
    if (input.hasAttribute('data-variants-bulk')) {
      const ids = facts.variants.map((variant) => variant.nodeId);
      const state = variantBulkState(selection.variantIds, ids);
      applyVariantBulk(selection.variantIds, ids, !state.checked);
      syncVariantFixture();
      input.focus({ preventScroll: true });
      return;
    }
    if (input.dataset.variant) {
      if (input.checked) selection.variantIds.add(input.dataset.variant);
      else selection.variantIds.delete(input.dataset.variant);
      syncVariantFixture();
      input.focus({ preventScroll: true });
      return;
    }
    if (input.id === 'sl-ai-toggle') {
      selection.aiEnabled = input.checked;
      repaintComponentFixture('#sl-ai-toggle');
      return;
    }
    if (!input.dataset.section) return;
    const sectionId = input.dataset.section as SectionId;
    if (input.checked) selection.sections.add(sectionId);
    else selection.sections.delete(sectionId);
    repaintComponentFixture(`[data-section="${sectionId}"]`);
  });
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
  const refreshing = param('refreshing', '0') === '1';
  renderFoundationScreen(refs, state, FOUNDATION_SPEC, foundationSelection, refreshing);

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest('[data-foundation-bulk]')) {
      const all = foundationSelection.collections.length === FOUNDATION_SPEC.collections.length
        && foundationSelection.textStyles;
      foundationSelection = all ? clearAll() : selectAll(FOUNDATION_SPEC);
      renderFoundationScreen(refs, state, FOUNDATION_SPEC, foundationSelection, refreshing);
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
    renderFoundationScreen(refs, state, FOUNDATION_SPEC, foundationSelection, refreshing);
  });
}

if (view === 'library') {
  const names = [
    'buttonPrimary',
    'buttonText',
    'inputField',
    'checkbox',
    'radioGroup',
    'selectMenu',
    'searchField',
    'navigationItem',
    'tooltip',
    'dialog',
    'toast',
    'avatar',
    'badge',
    'pagination',
    'Foundations · Semantic',
    'Foundations · Typography',
  ];
  const now = Date.UTC(2026, 6, 29, 12);
  const entries: LibraryEntry[] = names.map((name, index) => ({
    docId: `doc-${index + 1}`,
    kind: name.startsWith('Foundations') ? 'foundation' : 'component',
    label: name,
    componentName: name,
    pageName: name.startsWith('Foundations') ? 'Foundations' : 'Documentation',
    // Page-only for components, collection name for foundations — the shape
    // main.ts actually sends (see its sourceLabel comment).
    sourceLabel: name.startsWith('Foundations')
      ? name.replace('Foundations · ', '')
      : 'Components',
    generatedAt: now - (index + 1) * 3_600_000,
    sourceNodeId: name.startsWith('Foundations') ? '' : `source-${index + 1}`,
    sourceExists: true,
    selfEdited: index === 6,
    storedContentHash: `stored-${index + 1}`,
    ...(name.startsWith('Foundations')
      ? {
        currentContentHash: `stored-${index + 1}`,
        foundationIcon: name.endsWith('Typography')
          ? ('typography' as const)
          : ('color' as const),
      }
      : {}),
  }));
  const drift = new Map<string, LibraryDriftState>(
    entries.map((entry, index) => [
      entry.docId,
      index < 3 ? 'drifted' : 'inSync',
    ]),
  );
  let libraryFilter: LibraryFilter = param('filter', 'all') as LibraryFilter;
  let expandedDocId: string | null =
    param('state', 'expanded') === 'expanded' ? entries[0].docId : null;
  let menuDocId: string | null =
    param('menu', 'closed') === 'open' ? entries[0].docId : null;
  let refreshing = param('state', 'expanded') === 'refreshing';
  let updatingAll = param('state', 'expanded') === 'updating';

  /*
   * The Library's publish screen.
   *
   * Synthetic id and key, in the real formats (`lib_` + 24 hex, `sl_` + 48
   * hex) so the setup command has the real shape and width. Never a live key:
   * fixtures are synthetic or explicitly publishable, and a pull key in a
   * dev-only file is still a pull key.
   */
  const PUBLISH_FIXTURES: Record<string, PublishState> = {
    idle: {
      status: 'idle',
      message: null,
      libraryId: null,
      pullKey: null,
      lastPublishedAt: null,
    },
    collecting: {
      status: 'collecting',
      message: null,
      libraryId: null,
      pullKey: null,
      lastPublishedAt: null,
    },
    uploading: {
      status: 'uploading',
      message: null,
      libraryId: `lib_${'a1b2c3d4'.repeat(3)}`,
      pullKey: `sl_${'0f'.repeat(24)}`,
      lastPublishedAt: '2026-08-30T09:12:00.000Z',
    },
    published: {
      status: 'done',
      message: 'Published. Developers get this version on their next pull.',
      libraryId: `lib_${'a1b2c3d4'.repeat(3)}`,
      pullKey: `sl_${'0f'.repeat(24)}`,
      lastPublishedAt: '2026-09-01T09:12:00.000Z',
    },
    error: {
      status: 'error',
      message: 'Publishing needs an active Pro license.',
      libraryId: null,
      pullKey: null,
      lastPublishedAt: null,
    },
  };
  let libraryPane: 'list' | 'publish' =
    param('pane', 'list') === 'publish' ? 'publish' : 'list';
  const publishFixture =
    PUBLISH_FIXTURES[param('publish', 'published')] ?? PUBLISH_FIXTURES.published;

  const renderLibraryFixture = () => {
    if (libraryPane === 'publish') {
      renderPublishScreen(refs, publishFixture);
      return;
    }
    const model = buildLibraryModel(entries, {
      drift,
      filter: libraryFilter,
      expandedDocId,
      now,
    });
    // Boolean, not a count. The plugin also holds it steady while checks
    // resolve; this fixture has no in-flight checks to hold it across.
    setRailBadge(refs.sidebar, 'library', model.counts.updates > 0);
    renderLibraryScreen(refs, {
      ...model,
      menuDocId,
      refreshing,
      updatingAll,
      progress: updatingAll
        ? {
            label: 'Updating document 1 of 3',
            current: 0,
            total: 3,
          }
        : refreshing
          ? {
              label: 'Checking source changes',
              current: 3,
              total: entries.length,
            }
          : null,
    });
  };
  renderLibraryFixture();

  /** Mirrors ui-vnext.ts's setLibraryPane, including where focus lands. */
  const setPane = (next: 'list' | 'publish', focusSelector: string) => {
    libraryPane = next;
    menuDocId = null;
    renderLibraryFixture();
    document.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
  };

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || libraryPane !== 'publish') return;
    event.preventDefault();
    setPane('list', '[data-publish-open]');
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('[data-publish-open]')) {
      setPane('publish', '[data-publish-back]');
      return;
    }
    if (target.closest('[data-publish-back]')) {
      setPane('list', '[data-publish-open]');
      return;
    }
    const filterButton = target.closest<HTMLButtonElement>('[data-library-filter]');
    if (filterButton?.dataset.libraryFilter) {
      libraryFilter = filterButton.dataset.libraryFilter as LibraryFilter;
      expandedDocId = null;
      menuDocId = null;
      renderLibraryFixture();
      return;
    }
    const disclosure = target.closest<HTMLButtonElement>('[data-library-disclosure]');
    if (disclosure?.dataset.libraryDisclosure) {
      const docId = disclosure.dataset.libraryDisclosure;
      expandedDocId = expandedDocId === docId ? null : docId;
      renderLibraryFixture();
      return;
    }
    const menu = target.closest<HTMLButtonElement>('[data-library-menu]');
    if (menu?.dataset.libraryMenu) {
      menuDocId = menuDocId === menu.dataset.libraryMenu
        ? null
        : menu.dataset.libraryMenu;
      renderLibraryFixture();
      return;
    }
    if (target.closest('[data-library-menu-close]')) {
      menuDocId = null;
      renderLibraryFixture();
      return;
    }
    if (target.closest('[data-library-refresh]')) {
      refreshing = true;
      renderLibraryFixture();
      window.setTimeout(() => {
        refreshing = false;
        renderLibraryFixture();
      }, 450);
      return;
    }
    if (target.closest('[data-library-update-all]')) {
      updatingAll = true;
      renderLibraryFixture();
      window.setTimeout(() => {
        for (const entry of entries.slice(0, 3)) drift.set(entry.docId, 'inSync');
        updatingAll = false;
        expandedDocId = null;
        renderLibraryFixture();
      }, 650);
      return;
    }
    const action = target.closest<HTMLButtonElement>('[data-library-action]');
    if (!action?.dataset.libraryAction || !action.dataset.docId) return;
    const docId = action.dataset.docId;
    menuDocId = null;
    if (action.dataset.libraryAction === 'review') {
      expandedDocId = expandedDocId === docId ? null : docId;
    } else if (action.dataset.libraryAction === 'update') {
      drift.set(docId, 'inSync');
      expandedDocId = null;
    } else if (action.dataset.libraryAction === 'remove') {
      const index = entries.findIndex((entry) => entry.docId === docId);
      if (index >= 0) entries.splice(index, 1);
      drift.delete(docId);
    }
    renderLibraryFixture();
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
    remaining: Number(param('remaining', '4')),
    limit: Number(param('limit', '10')),
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

// sourceLabel is the source's page (or a foundation's collection), never the
// doc name — that's the row title. Mixed pages here on purpose: the palette's
// subtitle only earns its place when it locates something.
const SEARCH_DOCUMENTS: SearchDocument[] = [
  { docId: 'buttonText', label: 'buttonText', sourceLabel: 'Components' },
  { docId: 'inputField', label: 'inputField', sourceLabel: 'Components' },
  { docId: 'radio', label: 'radio', sourceLabel: 'Forms' },
  { docId: 'checkbox', label: 'checkbox', sourceLabel: 'Forms' },
  { docId: 'buttonIcon', label: 'buttonIcon', sourceLabel: 'Components' },
  { docId: 'buttonPrimary', label: 'buttonPrimary', sourceLabel: 'Components' },
  { docId: 'buttonSegmented', label: 'buttonSegmented', sourceLabel: 'Components' },
  { docId: 'mappedColors', label: 'Mapped Colors', sourceLabel: 'Mapped Colors' },
  { docId: 'typography', label: 'Foundation · typography', sourceLabel: 'Text styles' },
];
let harnessSearchOpen = param('search', 'closed') === 'open';
let harnessSearchQuery = param('query', '');
let harnessSearchIndex = Number(param('active', '0')) || 0;

const renderHarnessSearch = (focusInput = false) => {
  refs.root.querySelector('[data-global-search-dialog]')?.remove();
  if (!harnessSearchOpen) return;
  const model = buildSearchModel(
    SEARCH_DOCUMENTS,
    harnessSearchQuery,
    harnessSearchIndex,
  );
  harnessSearchIndex = model.activeIndex;
  refs.root.insertAdjacentHTML('beforeend', globalSearchMarkup(model));
  if (focusInput) {
    requestAnimationFrame(() => {
      const input = refs.root.querySelector<HTMLInputElement>('[data-global-search-input]');
      input?.focus();
      input?.setSelectionRange(harnessSearchQuery.length, harnessSearchQuery.length);
    });
  }
};

const closeHarnessSearch = () => {
  harnessSearchOpen = false;
  renderHarnessSearch();
  requestAnimationFrame(() => refs.searchButton.focus());
};

const setHarnessSearchIndex = (index: number) => {
  const model = buildSearchModel(
    SEARCH_DOCUMENTS,
    harnessSearchQuery,
    index,
  );
  harnessSearchIndex = model.activeIndex;
  const input = refs.root.querySelector<HTMLInputElement>('[data-global-search-input]');
  if (input && model.results.length) {
    input.setAttribute(
      'aria-activedescendant',
      `sl-global-search-result-${harnessSearchIndex}`,
    );
  }
  for (
    const result of refs.root.querySelectorAll<HTMLButtonElement>('[data-search-index]')
  ) {
    const active = Number(result.dataset.searchIndex) === harnessSearchIndex;
    result.classList.toggle('is-active', active);
    result.setAttribute('aria-selected', String(active));
  }
};

refs.searchButton.addEventListener('click', () => {
  harnessSearchOpen = true;
  harnessSearchQuery = '';
  harnessSearchIndex = 0;
  renderHarnessSearch(true);
});

document.addEventListener('input', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches('[data-global-search-input]')) return;
  harnessSearchQuery = input.value;
  harnessSearchIndex = 0;
  renderHarnessSearch(true);
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element) || !harnessSearchOpen) return;
  if (target.closest('[data-search-close]')) {
    closeHarnessSearch();
    return;
  }
  if (target.closest('[data-search-clear]')) {
    harnessSearchQuery = '';
    harnessSearchIndex = 0;
    renderHarnessSearch(true);
    return;
  }
  const result = target.closest<HTMLButtonElement>('[data-search-index]');
  if (!result) return;
  const nextView = result.dataset.searchView as PluginView | undefined;
  closeHarnessSearch();
  if (nextView) setActiveView(refs, nextView);
  else setActiveView(refs, 'library');
});

document.addEventListener('keydown', (event) => {
  if (
    !event.repeat &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === 'k'
  ) {
    event.preventDefault();
    if (harnessSearchOpen) closeHarnessSearch();
    else {
      harnessSearchOpen = true;
      harnessSearchQuery = '';
      harnessSearchIndex = 0;
      renderHarnessSearch(true);
    }
    return;
  }
  if (!harnessSearchOpen) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeHarnessSearch();
    return;
  }
  if (event.key === 'Tab') {
    const dialog = refs.root.querySelector<HTMLElement>('[data-global-search-dialog]');
    const focusable = dialog
      ? [...dialog.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]):not([tabindex="-1"])',
        )].filter((element) => element.offsetParent !== null)
      : [];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }
  const input = event.target instanceof HTMLInputElement
    && event.target.matches('[data-global-search-input]');
  if (!input) return;
  const model = buildSearchModel(
    SEARCH_DOCUMENTS,
    harnessSearchQuery,
    harnessSearchIndex,
  );
  if (
    event.key === 'ArrowDown' ||
    event.key === 'ArrowUp' ||
    event.key === 'Home' ||
    event.key === 'End'
  ) {
    event.preventDefault();
    harnessSearchIndex = nextSearchIndex(
      harnessSearchIndex,
      event.key,
      model.results.length,
    );
    renderHarnessSearch(true);
  } else if (event.key === 'Enter' && model.results.length) {
    event.preventDefault();
    closeHarnessSearch();
  }
});

const syncHarnessSearchPointer = (target: EventTarget | null) => {
  if (!harnessSearchOpen || !(target instanceof Element)) return;
  const result = target.closest<HTMLElement>('[data-search-index]');
  if (!result?.dataset.searchIndex) return;
  setHarnessSearchIndex(Number(result.dataset.searchIndex));
};

document.addEventListener('pointerover', (event) => {
  syncHarnessSearchPointer(event.target);
});

document.addEventListener('focusin', (event) => {
  syncHarnessSearchPointer(event.target);
});

renderHarnessSearch(harnessSearchOpen);
