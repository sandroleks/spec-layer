// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import {
  RING_CIRCUMFERENCE,
  ringOffset,
  headerMarkup,
  HEADER_IDS,
  renderAllowance,
} from '../src/ui/shell/header';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ringOffset', () => {
  it('is a full offset at zero, so an empty ring reads as empty', () => {
    expect(ringOffset(0)).toBeCloseTo(RING_CIRCUMFERENCE, 3);
  });

  it('is no offset at full', () => {
    expect(ringOffset(100)).toBeCloseTo(0, 3);
  });

  it('is half the circumference at half', () => {
    expect(ringOffset(50)).toBeCloseTo(RING_CIRCUMFERENCE / 2, 3);
  });

  it('clamps values outside 0..100 rather than drawing past the ring', () => {
    expect(ringOffset(-20)).toBeCloseTo(RING_CIRCUMFERENCE, 3);
    expect(ringOffset(140)).toBeCloseTo(0, 3);
  });

  it('matches an r=10 circle, the size component-markup.md specifies', () => {
    expect(RING_CIRCUMFERENCE).toBeCloseTo(62.832, 2);
  });
});

describe('headerMarkup', () => {
  it('renders the three utilities with stable ids', () => {
    const html = headerMarkup();
    expect(html).toContain(`id="${HEADER_IDS.search}"`);
    expect(html).toContain(`id="${HEADER_IDS.allowance}"`);
    expect(html).toContain(`id="${HEADER_IDS.theme}"`);
  });

  it('names every icon-only control', () => {
    const html = headerMarkup();
    expect(html).toContain('aria-label="Open quick search"');
    expect(html).toContain('aria-label="Switch to light theme"');
  });

  it('renders Upgrade as its own checkout action beside the License summary', () => {
    document.body.innerHTML = headerMarkup();
    const summary = document.querySelector<HTMLButtonElement>(`#${HEADER_IDS.allowance}`);
    const upgrade = document.querySelector<HTMLButtonElement>('[data-license-open="upgrade"]');

    expect(summary).toBeInstanceOf(HTMLButtonElement);
    expect(upgrade).toBeInstanceOf(HTMLButtonElement);
    expect(upgrade?.textContent).toBe('Upgrade');
    expect(upgrade?.getAttribute('aria-label')).toBe('Upgrade to Pro');
    expect(summary?.contains(upgrade ?? null)).toBe(false);
  });

  it('shows the checkout action for free plans and hides it for Pro', () => {
    document.body.innerHTML = headerMarkup();
    const header = document.querySelector<HTMLElement>('.sl-utility-header');
    const upgrade = document.querySelector<HTMLButtonElement>('[data-license-open="upgrade"]');

    expect(header).not.toBeNull();
    renderAllowance(header!, { kind: 'free', remaining: 10, limit: 10, resetsAt: '' });
    expect(upgrade?.hidden).toBe(false);

    renderAllowance(header!, { kind: 'pro' });
    expect(upgrade?.hidden).toBe(true);
  });

  it('does not repeat the product name, which Figma already shows', () => {
    expect(headerMarkup()).not.toContain('Spec Layer');
  });
});
