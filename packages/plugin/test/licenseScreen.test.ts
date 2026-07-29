import { describe, expect, it } from 'vitest';
import {
  licenseHeaderMarkup,
  licenseScrollMarkup,
  type LicenseScreenModel,
} from '../src/ui/screens/license';

function model(state: LicenseScreenModel['state']): LicenseScreenModel {
  return {
    state,
    licenseKey: state === 'free' ? '' : 'SPEC-PRO-DEMO-64PN',
    input: state === 'free' ? '' : 'SPEC-PRO-DEMO-64PN',
    remaining: 4,
    limit: 10,
    resetsAt: '2026-08-01T00:00:00Z',
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

  it('renders Pro benefits and the connected device', () => {
    const markup = licenseScrollMarkup(model('pro'));
    expect(markup).toContain('Pro plan');
    expect(markup).toContain('Unlimited AI writing');
    expect(markup).toContain('Connected license');
    expect(markup).toContain('•••• •••• •••• 64PN');
    expect(markup).toContain('Remove key');
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
