/**
 * header.ts — the 48px utility header.
 *
 * Figma draws the plugin name and icon in its own title bar, so this holds
 * only high-value utilities: quick search, the AI writing allowance, and the
 * theme control. The search control keeps the same position and size on every
 * screen.
 *
 * The allowance is rendered once and repainted in place. Rebuilding it would
 * let the header change height between the loading and loaded states, which
 * the direction explicitly forbids.
 */

import type { AllowanceState } from '../viewModel/contracts';
import { allowanceCopy } from '../viewModel/allowance';
import { icon } from './icons';

export const HEADER_IDS = {
  search: 'sl-header-search',
  allowance: 'sl-header-allowance',
  theme: 'sl-header-theme',
} as const;

/** An r=10 progress ring, per design-system/component-markup.md. */
export const RING_CIRCUMFERENCE = 2 * Math.PI * 10;

export function ringOffset(fillPct: number): number {
  const clamped = Math.max(0, Math.min(100, fillPct));
  return RING_CIRCUMFERENCE * (1 - clamped / 100);
}

export function headerMarkup(): string {
  return (
    '<header class="sl-utility-header">' +

    // No shortcut chip. The Cmd/Ctrl+K binding in ui-vnext.ts is unaffected;
    // only the badge is gone.
    `<button class="sl-header-search" id="${HEADER_IDS.search}" type="button" ` +
    'aria-label="Open quick search">' +
    `${icon('search', 15)}<span>Search</span>` +
    '</button>' +

    `<button class="sl-ai-allowance" id="${HEADER_IDS.allowance}" type="button" ` +
    'data-state="loading" aria-label="AI writing: checking your plan. Open License.">' +
    // The ring and the Pro check share one cell so the control keeps three
    // grid columns. Both are always present and CSS picks by [data-state],
    // which keeps renderAllowance a repaint rather than a rebuild.
    '<span class="sl-allowance-status">' +
    '<svg class="sl-allowance-ring" viewBox="0 0 26 26" aria-hidden="true">' +
    '<circle data-track cx="13" cy="13" r="10"></circle>' +
    `<circle data-value cx="13" cy="13" r="10" stroke-dasharray="${RING_CIRCUMFERENCE}" ` +
    `stroke-dashoffset="${RING_CIRCUMFERENCE}"></circle>` +
    '</svg>' +
    `<span class="sl-allowance-pro-mark" aria-hidden="true">${icon('check', 15)}</span>` +
    '</span>' +
    '<span class="sl-allowance-copy"><strong>AI writing</strong>' +
    '<small>Checking your plan</small></span>' +
    '<span class="sl-allowance-action" hidden>Upgrade</span>' +
    '</button>' +

    `<button class="sl-icon-button" id="${HEADER_IDS.theme}" type="button" ` +
    `aria-label="Switch to light theme">${icon('moon', 16)}</button>` +

    '</header>'
  );
}

/**
 * Repaint the allowance control in place. `root` is the header element; the
 * control itself is looked up by id so callers cannot pass the wrong node.
 */
export function renderAllowance(root: HTMLElement, state: AllowanceState): void {
  const button = root.querySelector<HTMLButtonElement>(`#${HEADER_IDS.allowance}`);
  // Loud rather than invisible: a `root` that does not contain the control is
  // a wiring mistake, and returning quietly would just leave a stale header.
  if (!button) {
    throw new Error(
      `renderAllowance: no #${HEADER_IDS.allowance} inside the given root. ` +
      'Pass the shell header element (ShellRefs.header).',
    );
  }

  const copy = allowanceCopy(state);
  button.dataset.state = copy.tone;
  button.setAttribute('aria-label', copy.ariaLabel);

  const title = button.querySelector('strong');
  const detail = button.querySelector('small');
  if (title) title.textContent = copy.title;
  if (detail) detail.textContent = copy.detail;

  const ring = button.querySelector<SVGCircleElement>('[data-value]');
  if (ring) ring.setAttribute('stroke-dashoffset', String(ringOffset(copy.fillPct)));

  const action = button.querySelector<HTMLElement>('.sl-allowance-action');
  if (action) action.hidden = !copy.showUpgrade;
}
