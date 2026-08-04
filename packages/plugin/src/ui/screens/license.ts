/**
 * license.ts — subscription, quota, activation, and device connection states.
 *
 * Network work and persistence stay in ui-vnext.ts. This module is a pure
 * rendering surface for the exhaustive LicenseState contract.
 */

import type { LicenseState } from '../viewModel/contracts';
import { LOW_REMAINING } from '../viewModel/allowance';
import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';

export interface LicenseScreenModel {
  state: LicenseState;
  licenseKey: string;
  input: string;
  remaining: number;
  limit: number;
  resetsAt: string;
}

const STORED_STATES = new Set<LicenseState>([
  'pro',
  'expired',
  'inactive',
  'unknown',
  'removing',
]);

const STATUS_MESSAGES: Partial<Record<LicenseState, {
  tone: 'warning' | 'danger' | 'neutral' | 'success';
  title: string;
  detail: string;
}>> = {
  expired: {
    tone: 'warning',
    title: 'Your Pro subscription has expired',
    detail: 'You’re on the free plan for now. Renew Pro to remove the monthly cap.',
  },
  inactive: {
    tone: 'warning',
    title: 'This key isn’t connected to this device',
    detail: 'Activate it again to reconnect this Figma plugin.',
  },
  unknown: {
    tone: 'neutral',
    title: 'Your Pro key is saved',
    detail: 'We couldn’t verify it right now. Your key stays connected while you retry.',
  },
  invalid: {
    tone: 'danger',
    title: 'We couldn’t find that key',
    detail: 'Double-check it against your purchase email and try again.',
  },
  disabled: {
    tone: 'danger',
    title: 'This key has been turned off',
    detail: 'Contact support if that’s unexpected.',
  },
  'device-limit': {
    tone: 'danger',
    title: 'This key has reached its device limit',
    detail: 'Free up a device in Manage subscription, then try again.',
  },
  unreachable: {
    tone: 'neutral',
    title: 'Couldn’t reach the license server',
    detail: 'Your current plan hasn’t changed. Try again in a minute.',
  },
  removed: {
    tone: 'success',
    title: 'Key removed from this device',
    detail: 'This plugin is back on the free plan.',
  },
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resetCopy(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `Resets ${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function maskedKey(key: string): string {
  const suffix = key.trim().slice(-4).toUpperCase();
  return `•••• •••• •••• ${suffix || '••••'}`;
}

function statusMessage(state: LicenseState): string {
  const message = STATUS_MESSAGES[state];
  if (!message) return '';
  const glyph = message.tone === 'success'
    ? 'circleCheck'
    : message.tone === 'neutral'
      ? 'infoCircle'
      : 'alertCircle';
  return (
    `<div class="sl-license-status-message is-${message.tone}" ` +
    `role="${message.tone === 'danger' ? 'alert' : 'status'}">` +
    `${icon(glyph, 16)}<span><strong>${esc(message.title)}</strong>` +
    `<small>${esc(message.detail)}</small></span></div>`
  );
}

function planCard(model: LicenseScreenModel): string {
  const isPro = model.state === 'pro' || model.state === 'removing';
  const isUnknown = model.state === 'unknown';
  const safeLimit = Math.max(0, model.limit);
  const safeRemaining = Math.max(0, model.remaining);
  // Mirrors the header's allowanceCopy(): exhausted always reads as a full
  // amber bar, not an empty gray one, because a "remaining" gauge has nothing
  // left to show at 0 regardless of what color it would have been. LOW_REMAINING
  // is the same import the header uses, so this page and the header cannot
  // drift apart on what "low" means (allowance.test.ts pins that boundary).
  const isExhausted = safeRemaining <= 0;
  const isLow = !isExhausted && safeRemaining < LOW_REMAINING;
  const usageTone = isExhausted ? 'exhausted' : isLow ? 'low' : 'normal';
  const fill = isExhausted
    ? 100
    : safeLimit > 0 ? Math.min(100, (safeRemaining / safeLimit) * 100) : 0;
  const title = isPro ? 'Pro plan' : isUnknown ? 'Pro key saved' : 'Free plan';
  // Says it once. The card used to read "Unlimited documentation maintenance"
  // above "Unlimited AI writing" and "Unlimited library maintenance", which is
  // the same claim three times, and it overstated the plan: Pro has no monthly
  // cap, but PRO_SOFT_THRESHOLD and the per-minute rate limit still apply, so
  // "unlimited" is the word voice rule 6 tells us not to use here.
  const detail = isPro
    ? 'No monthly cap on AI writing or library maintenance'
    : isUnknown
      ? 'Verification is temporarily unavailable'
      : 'For lighter AI-assisted documentation';
  const badge = isPro ? 'Active' : isUnknown ? 'Unverified' : 'Current';

  // Pro adds nothing here. The heading already states the plan, the badge
  // already states that it is active, and the detail already states what that
  // buys, so a benefits list could only repeat one of the three.
  const body = isPro
    ? ''
    : isUnknown
      ? (
        '<div class="sl-license-unknown-note">' +
        `${icon('infoCircle', 14)}Your saved key stays connected until verification succeeds.</div>`
      )
      : (
        '<div class="sl-license-usage">' +
        '<div class="sl-license-usage-copy"><span><strong>AI writing</strong>' +
        `<small>${esc(resetCopy(model.resetsAt))}</small></span>` +
        `<span>${safeRemaining} of ${safeLimit} free uses left</span></div>` +
        `<span class="sl-license-usage-track" data-tone="${usageTone}" aria-hidden="true">` +
        `<i style="width:${fill}%"></i></span></div>`
      );

  const action = isUnknown
    ? ''
    : isPro
      ? (
        '<button class="sl-button" data-tone="secondary" type="button" ' +
        `data-license-open="manage">Manage subscription ${icon('externalLink', 14)}</button>`
      )
      : (
        '<button class="sl-button" data-tone="primary" type="button" ' +
        `data-license-open="upgrade">Upgrade to Pro ${icon('externalLink', 14)}</button>`
      );

  return (
    `<section class="sl-license-plan-card${isPro ? ' is-pro' : ''}">` +
    '<div class="sl-license-plan-heading">' +
    `<span class="sl-plan-icon">${icon('bolt', 17)}</span>` +
    `<span><strong>${title}</strong><small>${detail}</small></span>` +
    '<span class="sl-license-plan-badge">' +
    `${isUnknown ? icon('infoCircle', 12) : icon('check', 12)}${badge}</span></div>` +
    body +
    `<div class="sl-license-plan-actions">${action}</div></section>`
  );
}

function connectedLicense(model: LicenseScreenModel): string {
  const removing = model.state === 'removing';
  return (
    '<div class="sl-settings-section-heading"><h2>Connected license</h2>' +
    '<p>This key is active on this Figma plugin.</p></div>' +
    '<div class="sl-connected-license">' +
    `<span class="sl-connected-license-icon">${icon('key', 16)}</span>` +
    `<span><strong>${esc(maskedKey(model.licenseKey))}</strong>` +
    '<small>Figma plugin · This device</small></span>' +
    `<span class="sl-connected-license-status${removing ? ' is-removing' : ''}">` +
    `${icon(removing ? 'refresh' : 'circleCheck', 14)}` +
    `${removing ? 'Disconnecting' : 'Connected'}</span></div>` +
    '<div class="sl-connected-license-actions">' +
    '<button class="sl-button is-danger" data-tone="quiet" type="button" ' +
    `data-license-remove${removing ? ' disabled' : ''}>` +
    `${removing ? 'Removing…' : 'Remove key'}</button></div>`
  );
}

function activation(model: LicenseScreenModel): string {
  const hasStoredKey = STORED_STATES.has(model.state);
  const checking = model.state === 'checking';
  const heading = hasStoredKey ? 'Saved license' : 'Activate Pro';
  const detail = hasStoredKey
    ? 'Reconnect or manage the license saved on this device.'
    : 'Paste the key from your purchase email.';
  const savedUnknown = hasStoredKey && model.state === 'unknown';
  const form = savedUnknown
    ? (
      '<div class="sl-saved-license-row"><span>' +
      `${icon('key', 15)}<strong>${esc(maskedKey(model.licenseKey))}</strong></span>` +
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      'data-license-retry>Retry</button></div>'
    )
    : (
      '<form class="sl-license-activation-form" data-license-form>' +
      '<label class="sl-license-field"><span class="sl-sr-only">Pro license key</span>' +
      `${icon('key', 15)}<input type="password" data-license-input ` +
      `value="${esc(model.input)}" placeholder="XXXXXXXX-XXXX-XXXX-XXXX" autocomplete="off"` +
      `${checking ? ' disabled' : ''}></label>` +
      '<button class="sl-button" data-tone="primary" type="submit" ' +
      `data-license-activate${!model.input.trim() || checking ? ' disabled' : ''}>` +
      `${checking ? `${icon('refresh', 14)}Checking…` : hasStoredKey ? 'Reconnect' : 'Activate'}` +
      '</button></form>'
    );

  const primaryStatus =
    model.state !== 'removed' && model.state !== 'unknown'
      ? statusMessage(model.state)
      : '';
  const removedStatus = model.state === 'removed' ? statusMessage('removed') : '';
  const support = [
    model.state === 'expired'
      ? '<button class="sl-button" data-tone="secondary" type="button" data-license-open="renew">Renew Pro ' +
        `${icon('externalLink', 14)}</button>`
      : '',
    ['expired', 'device-limit', 'unknown'].includes(model.state)
      ? '<button class="sl-button" data-tone="quiet" type="button" data-license-open="manage">Manage subscription</button>'
      : '',
    model.state === 'disabled'
      ? '<button class="sl-button" data-tone="quiet" type="button" data-license-open="support">Contact support</button>'
      : '',
    hasStoredKey
      ? '<button class="sl-button is-danger" data-tone="quiet" type="button" data-license-remove>Remove key from this device</button>'
      : '',
  ].filter(Boolean).join('');

  return (
    '<section class="sl-license-activation-section">' +
    `<div class="sl-settings-section-heading"><h2>${heading}</h2><p>${detail}</p></div>` +
    primaryStatus + form + removedStatus +
    `<div class="sl-license-support-actions">${support}</div></section>`
  );
}

export function licenseHeaderMarkup(): string {
  return '<div class="sl-page-header-copy"><h1>License</h1></div>';
}

export function licenseScrollMarkup(model: LicenseScreenModel): string {
  const isPro = model.state === 'pro' || model.state === 'removing';
  return planCard(model) +
    `<section class="sl-license-account">${isPro ? connectedLicense(model) : activation(model)}</section>`;
}

export function renderLicenseScreen(refs: ShellRefs, model: LicenseScreenModel): void {
  refs.screen.className = 'sl-screen sl-settings-screen sl-license-screen';
  refs.pageHeader.innerHTML = licenseHeaderMarkup();
  refs.pageHeader.hidden = false;
  refs.scroll.innerHTML = licenseScrollMarkup(model);
  refs.footer.hidden = true;
}
