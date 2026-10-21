import { describe, it, expect } from 'vitest';
import {
  USAGE_DATA_DEFAULT, USAGE_DATA_KEY, USAGE_INSTALL_KEY, storedInstallId, storedUsageDataEnabled,
} from '../src/usageSettings';

describe('usage data settings', () => {
  it('is on until a person turns it off, and reads a stored boolean as is', () => {
    expect(USAGE_DATA_DEFAULT).toBe(true);
    expect(storedUsageDataEnabled(undefined)).toBe(true);
    expect(storedUsageDataEnabled('off')).toBe(true);
    expect(storedUsageDataEnabled(false)).toBe(false);
    expect(storedUsageDataEnabled(true)).toBe(true);
  });

  it('keeps a well-formed install id and drops anything else', () => {
    const id = `inst_${'0'.repeat(32)}`;
    expect(storedInstallId(id)).toBe(id);
    expect(storedInstallId(undefined)).toBeNull();
    expect(storedInstallId('u:123')).toBeNull();
    expect(storedInstallId(42)).toBeNull();
  });

  it('stores under keys of its own', () => {
    expect(USAGE_DATA_KEY).toBe('usageData');
    expect(USAGE_INSTALL_KEY).toBe('usageInstallId');
  });
});
