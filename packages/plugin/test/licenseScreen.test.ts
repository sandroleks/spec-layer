import { describe, expect, it } from 'vitest';
import {
  licenseHeaderMarkup,
  licenseScrollMarkup,
  type LicenseScreenModel,
} from '../src/ui/screens/license';

function model(
  state: LicenseScreenModel['state'],
  overrides: Partial<LicenseScreenModel> = {},
): LicenseScreenModel {
  return {
    state,
    licenseKey: state === 'free' ? '' : 'SPEC-PRO-DEMO-64PN',
    input: state === 'free' ? '' : 'SPEC-PRO-DEMO-64PN',
    remaining: 4,
    limit: 10,
    resetsAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('license screen presentation', () => {
  it('uses the current standalone title decision', () => {
    const markup = licenseHeaderMarkup();
    expect(markup).toContain('<h1>License</h1>');
    expect(markup).not.toContain('<p>');
  });

  it('renders free plan usage and activation', () => {
    const markup = licenseScrollMarkup(model('free'));
    expect(markup).toContain('Free plan');
    expect(markup).toContain('<small>1 published Figma file, with limits on AI writing and publishing</small>');
    expect(markup).toContain('4 of 10 free uses left');
    expect(markup).toContain('Resets August 1');
    expect(markup).toContain('Upgrade to Pro');
    expect(markup).toContain('Activate Pro');
    expect(markup).toContain('data-license-activate disabled');
  });

  /**
   * Before the first quota answer, or offline, the counts are placeholders
   * (the panel passes 0 and 0), so the meter would read "0 of 0 free uses
   * left" on a full amber bar. Never fabricate: no quota, no usage row.
   */
  it('draws no usage row until a quota has arrived', () => {
    const unknown = licenseScrollMarkup(model('free', { remaining: 0, limit: 0, quotaKnown: false }));
    expect(unknown).not.toContain('sl-license-usage');
    expect(unknown).not.toContain('free uses left');
    // The rest of the card still says which plan this is and how to change it.
    expect(unknown).toContain('Free plan');
    expect(unknown).toContain('Upgrade to Pro');
    expect(licenseScrollMarkup(model('free', { quotaKnown: true }))).toContain('4 of 10 free uses left');
  });

  it('names the field and uses a plain placeholder for the key', () => {
    const markup = licenseScrollMarkup(model('free'));
    expect(markup).toContain('<span class="sl-sr-only">License key</span>');
    expect(markup).toContain('placeholder="License key"');
    expect(markup).not.toContain('XXXX');
    expect(markup).not.toContain('Pro license key');
  });

  /**
   * The quota meter's tone must agree with the header's — allowance.ts's
   * LOW_REMAINING is the single import both read, so these three boundaries
   * (comfortably above, just below, and exhausted) can't drift from what
   * allowance.test.ts pins for the header ring.
   */
  it('shows a plain accent bar above the low threshold', () => {
    const markup = licenseScrollMarkup(model('free', { remaining: 5, limit: 20 }));
    expect(markup).toContain('data-tone="normal"');
    expect(markup).toContain('style="width:25%"');
  });

  it('warns at the same boundary the header warns at', () => {
    const markup = licenseScrollMarkup(model('free', { remaining: 4, limit: 20 }));
    expect(markup).toContain('data-tone="low"');
    expect(markup).toContain('style="width:20%"');
  });

  it('shows a full amber bar when exhausted, not an empty one', () => {
    const markup = licenseScrollMarkup(model('free', { remaining: 0, limit: 20 }));
    expect(markup).toContain('data-tone="exhausted"');
    expect(markup).toContain('style="width:100%"');
    expect(markup).toContain('0 of 20 free uses left');
  });

  it('renders the Pro plan and the connected device', () => {
    const markup = licenseScrollMarkup(model('pro'));
    expect(markup).toContain('Pro plan');
    expect(markup).toContain('Up to 10 published Figma files, no monthly cap on AI writing or publishing');
    expect(markup).toContain('Connected license');
    expect(markup).toContain('<p>This key is active on this device.</p>');
    expect(markup).toContain('•••• •••• •••• 64PN');
    expect(markup).toContain('Remove key');
  });

  /*
   * Pro has no monthly limit, but the per-minute rate limit and
   * PRO_SOFT_THRESHOLD still apply, so voice rule 6 rules out the bare claim.
   * The card also used to say it three times over.
   */
  it('does not claim Pro is unlimited', () => {
    for (const state of ['pro', 'expired'] as const) {
      expect(licenseScrollMarkup(model(state)).toLowerCase()).not.toContain('unlimited');
    }
  });

  it('renders differentiated recovery states', () => {
    expect(licenseScrollMarkup(model('expired'))).toContain(
      'Your Pro subscription has expired',
    );
    expect(licenseScrollMarkup(model('expired'))).toContain('Renew Pro');
    expect(licenseScrollMarkup(model('device-limit'))).toContain(
      'This key has reached its device limit',
    );
    expect(licenseScrollMarkup(model('unknown'))).toContain('data-license-retry>Check again</button>');
    expect(licenseScrollMarkup(model('removed'))).toContain(
      'Key removed from this device',
    );
    expect(licenseScrollMarkup(model('removed'))).toContain('This device is back on the free plan.');
    expect(licenseScrollMarkup(model('inactive'))).toContain('Press Reconnect to use Pro on this device again.');
    expect(licenseScrollMarkup(model('unreachable'))).toContain('Couldn’t check your key right now');
  });

  /**
   * A saved key the plugin could not check: the card names the key, not a
   * plan it cannot confirm, and says the key is still there.
   */
  it('shows a saved but unchecked key as a license key, never as Pro', () => {
    const markup = licenseScrollMarkup(model('unknown'));
    expect(markup).toContain('<strong>License key saved</strong><small>Couldn’t check it right now</small>');
    expect(markup).toContain('Your license key is still saved on this device. Check again in a minute.');
    expect(markup).not.toContain('Pro key');
    // The status message table has no entry for this state; the plan card and
    // the saved-key row carry it, so no status box renders.
    expect(markup).not.toContain('sl-license-status-message');
  });

  it('shows the saved-key check as busy while it runs again', () => {
    const busy = licenseScrollMarkup(model('unknown', { rechecking: true }));
    expect(busy).toMatch(/<button[^>]*data-license-retry disabled>[\s\S]*?Checking…<\/button>/);
    expect(busy).not.toContain('>Check again</button>');
    // Only the saved-key row reads the flag.
    expect(licenseScrollMarkup(model('free', { rechecking: true }))).not.toContain('Checking…');
  });
});
