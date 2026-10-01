/**
 * The 48px utility header: search, the AI writing allowance, and the theme
 * control (Figma's title bar already shows the plugin name). The allowance is
 * repainted in place, so the header never changes height between states.
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

    // No shortcut chip; Cmd/Ctrl+K still works (ui-vnext.ts).
    `<button class="sl-header-search" id="${HEADER_IDS.search}" type="button" ` +
    'aria-label="Search your docs">' +
    `${icon('search', 15)}<span>Search</span>` +
    '</button>' +

    '<div class="sl-ai-allowance" data-state="loading">' +
    `<button class="sl-allowance-summary" id="${HEADER_IDS.allowance}" type="button" ` +
    'aria-label="AI writing: checking your plan. Open License.">' +
    // The ring and Pro check are both always present; CSS picks by [data-state],
    // so renderAllowance only repaints.
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
    '</button>' +
    // A sibling, not nested: the summary opens License while Upgrade goes to checkout.
    '<button class="sl-allowance-action" type="button" data-license-open="upgrade" ' +
    'aria-label="Upgrade to Pro, opens in your browser" hidden>Upgrade</button>' +
    '</div>' +

    `<button class="sl-icon-button" id="${HEADER_IDS.theme}" type="button" ` +
    `aria-label="Switch to light theme">${icon('moon', 16)}</button>` +

    '</header>'
  );
}

/** Repaint the allowance control in place; `root` is the header, the control found by id. */
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

  const control = button.closest<HTMLElement>('.sl-ai-allowance');
  if (!control) {
    throw new Error(
      `renderAllowance: #${HEADER_IDS.allowance} is not inside .sl-ai-allowance.`,
    );
  }

  const copy = allowanceCopy(state);
  control.dataset.state = copy.tone;
  button.setAttribute('aria-label', copy.ariaLabel);

  const title = control.querySelector('strong');
  const detail = control.querySelector('small');
  if (title) title.textContent = copy.title;
  if (detail) detail.textContent = copy.detail;

  const ring = control.querySelector<SVGCircleElement>('[data-value]');
  if (ring) ring.setAttribute('stroke-dashoffset', String(ringOffset(copy.fillPct)));

  const action = control.querySelector<HTMLButtonElement>('.sl-allowance-action');
  if (action) action.hidden = !copy.showUpgrade;
}
