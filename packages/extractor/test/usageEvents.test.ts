import { describe, it, expect } from 'vitest';
import {
  INSTALL_ID_RE, MAX_USAGE_BATCH, MAX_USAGE_NUMBER, USAGE_EVENTS, USAGE_EVENT_NAMES, USAGE_TOKEN_RE,
  isUsageEventName, usageToken, validateUsageBatch, validateUsageEvent,
} from '../src/usageEvents';

const INSTALL = `inst_${'0123456789abcdef'.repeat(2)}`;

describe('the catalogue', () => {
  it('names every event and vocabulary as tokens', () => {
    for (const name of USAGE_EVENT_NAMES) {
      expect(name).toMatch(USAGE_TOKEN_RE);
      const spec = USAGE_EVENTS[name] as { kinds?: readonly string[]; details?: readonly string[] };
      for (const value of [...(spec.kinds ?? []), ...(spec.details ?? [])]) expect(value).toMatch(USAGE_TOKEN_RE);
    }
    expect(isUsageEventName('doc_build')).toBe(true);
    expect(isUsageEventName('toString')).toBe(false);
    expect(isUsageEventName('constructor')).toBe(false);
  });

  it('turns a product constant into a token and leaves a token alone', () => {
    expect(usageToken('renderDocFrame')).toBe('renderDocFrame');
    expect(usageToken('Warm')).toBe('Warm');
    expect(usageToken('High contrast / dark')).toBe('High_contrast_dark');
    expect(usageToken('  --x')).toBe('x');
    expect(usageToken('a'.repeat(100))).toHaveLength(64);
    expect(usageToken('High contrast / dark')).toMatch(USAGE_TOKEN_RE);
  });
});

describe('validateUsageEvent', () => {
  it('keeps a catalogued event with tokens and rounded counts', () => {
    expect(validateUsageEvent({
      name: 'doc_build', kind: 'create', detail: 'ai', outcome: 'ok', count: 4.4, count2: 1, bytes: 0, duration_ms: 12.6,
    })).toEqual({ name: 'doc_build', kind: 'create', detail: 'ai', outcome: 'ok', count: 4, count2: 1, bytes: 0, duration_ms: 13 });
    expect(validateUsageEvent({ name: 'plugin_opened' })).toEqual({ name: 'plugin_opened' });
  });

  it('drops anything outside the catalogue, so content cannot ride along', () => {
    expect(validateUsageEvent({ name: 'page_view' })).toBeNull();
    expect(validateUsageEvent({ name: 'doc_build', kind: 'delete' })).toBeNull();
    expect(validateUsageEvent({ name: 'doc_build', detail: 'sometimes' })).toBeNull();
    expect(validateUsageEvent({ name: 'doc_build', outcome: 'Button / Primary' })).toBeNull();
    expect(validateUsageEvent({ name: 'doc_build', outcome: 'x'.repeat(65) })).toBeNull();
    expect(validateUsageEvent({ name: 'doc_build', component: 'Button' })).toBeNull();
    expect(validateUsageEvent({ name: 'doc_build', count: -1 })).toBeNull();
    expect(validateUsageEvent({ name: 'doc_build', count: Number.NaN })).toBeNull();
    expect(validateUsageEvent({ name: 'doc_build', count: MAX_USAGE_NUMBER + 1 })).toBeNull();
    expect(validateUsageEvent({ name: 'doc_build', count: '4' })).toBeNull();
    expect(validateUsageEvent(['doc_build'])).toBeNull();
    expect(validateUsageEvent(null)).toBeNull();
  });

  it('takes any token where the catalogue names no vocabulary', () => {
    expect(validateUsageEvent({ name: 'library_check', outcome: 'http_502' })?.outcome).toBe('http_502');
    expect(validateUsageEvent({ name: 'unexpected_error', kind: 'main', detail: 'renderDocFrame' })?.detail).toBe('renderDocFrame');
  });
});

describe('validateUsageBatch', () => {
  it('accepts a batch and counts the events it dropped', () => {
    const result = validateUsageBatch({
      install: INSTALL, tier: 'pro',
      events: [{ name: 'plugin_opened' }, { name: 'nope' }, { name: 'copy_for_ai', kind: 'component', detail: 'md', bytes: 2048 }],
    });
    expect(result).toEqual({
      ok: true, dropped: 1,
      batch: { install: INSTALL, tier: 'pro', events: [{ name: 'plugin_opened' }, { name: 'copy_for_ai', kind: 'component', detail: 'md', bytes: 2048 }] },
    });
  });

  it('leaves the tier out when the plugin sent none', () => {
    const result = validateUsageBatch({ install: INSTALL, events: [{ name: 'plugin_opened' }] });
    expect(result.ok && 'tier' in result.batch).toBe(false);
  });

  it('refuses a wrong envelope with the reason', () => {
    const error = (body: unknown) => (validateUsageBatch(body) as { error: string }).error;
    expect(error(null)).toBe('invalid body');
    expect(error([])).toBe('invalid body');
    expect(error({ install: INSTALL, events: [{ name: 'plugin_opened' }], user: 'u1' })).toBe('unexpected body field');
    expect(error({ install: 'inst_nope', events: [{ name: 'plugin_opened' }] })).toBe('bad install');
    expect(error({ install: 'u:123', events: [{ name: 'plugin_opened' }] })).toBe('bad install');
    expect(error({ install: INSTALL, tier: 'team', events: [{ name: 'plugin_opened' }] })).toBe('bad tier');
    expect(error({ install: INSTALL, events: [] })).toBe('missing events');
    expect(error({ install: INSTALL, events: {} })).toBe('missing events');
    expect(error({ install: INSTALL, events: Array.from({ length: MAX_USAGE_BATCH + 1 }, () => ({ name: 'plugin_opened' })) })).toBe('too many events');
  });

  it('pins the install id shape the plugin mints', () => {
    expect(INSTALL).toMatch(INSTALL_ID_RE);
    expect(`inst_${'A'.repeat(32)}`).not.toMatch(INSTALL_ID_RE);
    expect(`inst_${'0'.repeat(31)}`).not.toMatch(INSTALL_ID_RE);
  });
});
