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
    expect(markup).toContain('4 of 10 free uses left');
    expect(markup).toContain('Resets August 1');
    expect(markup).toContain('Upgrade to Pro');
    expect(markup).toContain('Activate Pro');
    expect(markup).toContain('data-license-activate disabled');
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
    expect(markup).toContain('No monthly cap on AI writing or library maintenance');
    expect(markup).toContain('Connected license');
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
    expect(licenseScrollMarkup(model('unknown'))).toContain('Retry');
    expect(licenseScrollMarkup(model('removed'))).toContain(
      'Key removed from this device',
    );
  });
});
