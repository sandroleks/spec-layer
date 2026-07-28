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

import type { AllowanceState, PluginView } from './viewModel/contracts';
import { mountShell, setActiveView, wireShellTheme } from './shell/shell';
import { renderAllowance } from './shell/header';
import { type ThemeMode } from './theme';

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
