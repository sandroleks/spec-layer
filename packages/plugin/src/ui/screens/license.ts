/**
 * The license screen: plan, quota, activation and device states. A pure
 * rendering of the exhaustive LicenseState; network work stays in ui-vnext.ts.
 */

import type { LicenseState } from '../viewModel/contracts';
import { LOW_REMAINING } from '../viewModel/allowance';
import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import { esc } from '../escape';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../proxy';

export interface LicenseScreenModel {
  state: LicenseState;
  licenseKey: string;
  input: string;
  remaining: number;
  limit: number;
  resetsAt: string;
  /**
   * Whether `remaining` and `limit` are the proxy's numbers. False draws no
   * usage row, since "0 of 0 free uses left" would be a claim nobody made.
   * Omitted reads as known.
   */
  quotaKnown?: boolean;
  /** A saved key's check is running again, so its button reads as busy. */
  rechecking?: boolean;
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
    detail: 'Press Reconnect to use Pro on this device again.',
  },
  // No `unknown` entry: that state speaks through the plan card and the
  // saved-key row, and neither statusMessage() call below ever passes it.
  invalid: {
    tone: 'danger',
    title: 'We couldn’t find that key',
    detail: 'Double-check it against your purchase email and try again.',
  },
  disabled: {
    tone: 'danger',
    title: 'This key has been turned off',
    detail: `Email ${SUPPORT_EMAIL} if that’s unexpected.`,
  },
  'device-limit': {
    tone: 'danger',
    title: 'This key has reached its device limit',
    detail: 'Free up a device in Manage subscription, then try again.',
  },
  unreachable: {
    tone: 'neutral',
    title: 'Couldn’t check your key right now',
    detail: 'Your current plan hasn’t changed. Try again in a minute.',
  },
  removed: {
    tone: 'success',
    title: 'Key removed from this device',
    detail: 'This device is back on the free plan.',
  },
};

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
  // Exhausted reads as a full amber bar, as in the header's allowanceCopy();
  // LOW_REMAINING is the header's own import, so "low" cannot drift.
  const isExhausted = safeRemaining <= 0;
  const isLow = !isExhausted && safeRemaining < LOW_REMAINING;
  const usageTone = isExhausted ? 'exhausted' : isLow ? 'low' : 'normal';
  const fill = isExhausted
    ? 100
    : safeLimit > 0 ? Math.min(100, (safeRemaining / safeLimit) * 100) : 0;
  const title = isPro ? 'Pro plan' : isUnknown ? 'License key saved' : 'Free plan';
  // Pro has no monthly cap, but PRO_SOFT_THRESHOLD and the rate limit apply, so
  // not "unlimited" (voice rule 6). File counts are the proxy's LIBRARY_LIMITS
  // (1 free, 10 Pro); the free line names no AI or publish number, which the
  // proxy can change without a plugin release.
  const detail = isPro
    ? 'Up to 10 published Figma files, no monthly cap on AI writing or publishing'
    : isUnknown
      ? 'Couldn’t check it right now'
      : '1 published Figma file, with limits on AI writing and publishing';
  const badge = isPro ? 'Active' : isUnknown ? 'Unverified' : 'Current';

  // Pro adds nothing: the heading, badge and detail already say it all. A free
  // plan with no quota yet has no count to show.
  const body = isPro
    ? ''
    : isUnknown
      ? (
        '<div class="sl-license-unknown-note">' +
        `${icon('infoCircle', 14)}Your license key is still saved on this device. Check again in a minute.</div>`
      )
      : model.quotaKnown === false
        ? ''
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
    '<p>This key is active on this device.</p></div>' +
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
  const rechecking = savedUnknown && model.rechecking === true;
  const form = savedUnknown
    ? (
      '<div class="sl-saved-license-row"><span>' +
      `${icon('key', 15)}<strong>${esc(maskedKey(model.licenseKey))}</strong></span>` +
      '<button class="sl-button" data-tone="secondary" type="button" ' +
      `data-license-retry${rechecking ? ' disabled' : ''}>` +
      `${rechecking ? `${icon('refresh', 14)}Checking…` : 'Check again'}</button></div>`
    )
    : (
      // The placeholder is the field's only visible label, so it names the
      // field rather than drawing a key shape (real keys have five groups).
      '<form class="sl-license-activation-form" data-license-form>' +
      '<label class="sl-license-field"><span class="sl-sr-only">License key</span>' +
      `${icon('key', 15)}<input type="password" data-license-input ` +
      `value="${esc(model.input)}" placeholder="License key" autocomplete="off"` +
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
      // An anchor, like the rail links and "Read the guide": mail cannot go
      // through figma.openExternal.
      ? `<a class="sl-button" data-tone="quiet" href="${esc(SUPPORT_MAILTO)}" target="_blank" rel="noopener">` +
        `Email support${icon('externalLink', 14)}</a>`
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
