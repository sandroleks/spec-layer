import { describe, it, expect } from 'vitest';
import { nextStatus, resetToIdle, toKebab } from '../src/ui/state';

describe('nextStatus', () => {
  it('advances the phase machine through the happy path', () => {
    expect(nextStatus('idle', 'selected')).toBe('extracting');
    expect(nextStatus('extracting', 'rendered')).toBe('reviewing');
    expect(nextStatus('reviewing', 'sent')).toBe('sent');
  });

  it('only reaches sent from phases where a spec exists', () => {
    expect(nextStatus('idle', 'sent')).toBe('idle');
    expect(nextStatus('extracting', 'sent')).toBe('extracting');
    expect(nextStatus('sent', 'sent')).toBe('sent'); // re-send keeps the phase
  });

  it('returns to idle from sent on a new selection', () => {
    expect(nextStatus('sent', 'selected')).toBe('idle');
  });

  it('falls through on invalid transitions (returns current phase)', () => {
    expect(nextStatus('idle', 'rendered')).toBe('idle');
    expect(nextStatus('reviewing', 'rendered')).toBe('reviewing');
    expect(nextStatus('reviewing', 'selected')).toBe('reviewing');
  });
});

describe('resetToIdle', () => {
  it('returns idle', () => {
    expect(resetToIdle()).toBe('idle');
  });
});

describe('toKebab', () => {
  it('lowercases and replaces spaces', () => {
    expect(toKebab('Text Field')).toBe('text-field');
  });

  it('handles Figma hierarchy slash separator', () => {
    expect(toKebab('Icon/Arrow Up')).toBe('icon-arrow-up');
  });

  it('collapses space-around-slash into a single hyphen', () => {
    expect(toKebab('Form / Input')).toBe('form-input');
  });
});
