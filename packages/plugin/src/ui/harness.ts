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

import type { AllowanceState, ComponentScreenState, PluginView } from './viewModel/contracts';
import type { GroupId } from './docModel';
import { mountShell, setActiveView, wireShellTheme } from './shell/shell';
import { renderAllowance } from './shell/header';
import { createComponentSelection, renderComponentScreen } from './screens/component';
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
