import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  proseNeedsRegen,
  canGenerate,
  createState,
  omissionsMessage,
  setLicenseKey,
  licenseFailureNote,
  type UiState,
} from '../src/ui/actions';
import type { ProseV2Key } from '@spec-layer/extractor';

describe('proseNeedsRegen', () => {
  const withDraft = (keys: ProseV2Key[]): UiState => ({
    generatedProse: { v: 2, overview: { lede: 'd', body: [] } },
    generatedProseKeys: new Set(keys),
  } as unknown as UiState);

  it('regenerates when the cached draft misses a requested key', () => {
    expect(proseNeedsRegen(withDraft(['overview']), new Set(['overview', 'keyboard']))).toBe(true);
  });
  it('reuses when the cached draft covers the request', () => {
    expect(proseNeedsRegen(withDraft(['overview', 'keyboard']), new Set(['keyboard']))).toBe(false);
  });
  it('regenerates when there is no draft yet', () => {
    expect(proseNeedsRegen({ generatedProse: null, generatedProseKeys: null } as unknown as UiState, new Set(['overview']))).toBe(true);
  });
});

describe('canGenerate', () => {
  it('false when AI is off', () => {
    const s = createState();
    s.aiEnabled = false; s.figmaUserId = 'u1';
    expect(canGenerate(s)).toBe(false);
  });
  it('true for a free user with only a figma id (no key of any kind)', () => {
    const s = createState();
    s.aiEnabled = true; s.figmaUserId = 'u1'; s.licenseKey = null;
    expect(canGenerate(s)).toBe(true);
  });
  it('true with a license key and no figma id', () => {
    const s = createState();
    s.aiEnabled = true; s.licenseKey = 'LK'; s.figmaUserId = null;
    expect(canGenerate(s)).toBe(true);
  });
  it('false with AI on but no identity at all', () => {
    const s = createState();
    s.aiEnabled = true; s.licenseKey = null; s.figmaUserId = null;
    expect(canGenerate(s)).toBe(false);
  });
});

describe('setLicenseKey normalization', () => {
  // send() posts to `parent` (the Figma iframe host), which doesn't exist in
  // this node test environment; stub it so we can assert on state alone.
  beforeEach(() => {
    vi.stubGlobal('parent', { postMessage: vi.fn() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores null for an empty value and drops the instance id with it', () => {
    const state = createState();
    setLicenseKey(state, '   ', 'inst-1');
    expect(state.licenseKey).toBeNull();
    expect(state.licenseInstanceId).toBeNull();
  });
  it('trims the stored key', () => {
    const state = createState();
    setLicenseKey(state, '  LK-1  ', 'inst-1');
    expect(state.licenseKey).toBe('LK-1');
    expect(state.licenseInstanceId).toBe('inst-1');
  });
});

describe('licenseFailureNote', () => {
  it('an unreachable license server never flips the key to inactive', () => {
    const out = licenseFailureNote('unreachable');
    expect(out.markInactive).toBe(false);
    expect(out.note).toContain('still saved');
  });
  it('a definite lapse drops to the free tier', () => {
    expect(licenseFailureNote('expired').markInactive).toBe(true);
    expect(licenseFailureNote(undefined).markInactive).toBe(true);
  });
});

describe('omissionsMessage', () => {
  it('states the outcome alone when nothing was left out', () => {
    expect(omissionsMessage('Created 3 frames.', [])).toBe('Created 3 frames.');
  });
  it('names every omitted section with its reason, in order', () => {
    expect(omissionsMessage('Created 3 frames.', [
      { id: 'keyboard', label: 'Keyboard', reason: 'nothingToShow' },
      { id: 'whenToUse', label: 'When to use', reason: 'aiOff' },
    ])).toBe('Created 3 frames. Left out Keyboard: nothing to show. Left out When to use: AI writing is off.');
  });
});
