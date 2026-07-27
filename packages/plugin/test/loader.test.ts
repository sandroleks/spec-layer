import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startLoader, stopLoader } from '../src/ui/render';

/**
 * The generating loader.
 *
 * There are two of these now, the component footer's and the Foundations tab's,
 * and they can be live at the same time. The cycle used to be a single
 * module-level timer, which meant either loader's stop would silently cancel the
 * other's cycle and leave a running build frozen on one message. These tests
 * pin the per-loader isolation as much as the cycling itself.
 *
 * No DOM needed: the loader touches exactly classList and textContent.
 */
function fakeLoader() {
  const classes = new Set<string>();
  const root = {
    classList: {
      add: (c: string) => { classes.add(c); },
      remove: (c: string) => { classes.delete(c); },
    },
  };
  const text = { textContent: '' };
  return {
    root: root as unknown as HTMLElement,
    text: text as unknown as HTMLElement,
    shown: () => classes.has('show'),
    said: () => text.textContent,
  };
}

const CYCLE_MS = 2600;

describe('startLoader / stopLoader', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the loader on the first message', () => {
    const l = fakeLoader();
    startLoader(l.root, l.text, ['Reading the component', 'Composing sections']);
    expect(l.shown()).toBe(true);
    expect(l.said()).toBe('Reading the component');
  });

  it('advances to the next message on each cycle', () => {
    const l = fakeLoader();
    startLoader(l.root, l.text, ['one', 'two', 'three']);
    vi.advanceTimersByTime(CYCLE_MS);
    expect(l.said()).toBe('two');
    vi.advanceTimersByTime(CYCLE_MS);
    expect(l.said()).toBe('three');
  });

  it('loops rather than parking on the last message', () => {
    // A build slower than the message list should keep moving, not look stuck.
    const l = fakeLoader();
    startLoader(l.root, l.text, ['one', 'two']);
    vi.advanceTimersByTime(CYCLE_MS * 3);
    expect(l.said()).toBe('two');
    vi.advanceTimersByTime(CYCLE_MS);
    expect(l.said()).toBe('one');
  });

  it('holds a single message still, with no cycle at all', () => {
    // This is what pins real progress ("Creating frame 2 of 5") in place.
    const l = fakeLoader();
    startLoader(l.root, l.text, ['Creating frame 2 of 5']);
    vi.advanceTimersByTime(CYCLE_MS * 5);
    expect(l.said()).toBe('Creating frame 2 of 5');
  });

  it('replaces a running cycle when restarted on the same loader', () => {
    // Progress messages arrive as single-message restarts, so a leftover timer
    // from the previous cycle would fight them and flicker between the two.
    const l = fakeLoader();
    startLoader(l.root, l.text, ['a', 'b', 'c']);
    vi.advanceTimersByTime(CYCLE_MS);
    startLoader(l.root, l.text, ['pinned']);
    vi.advanceTimersByTime(CYCLE_MS * 3);
    expect(l.said()).toBe('pinned');
  });

  it('hides the loader when stopped', () => {
    const l = fakeLoader();
    startLoader(l.root, l.text, ['one', 'two']);
    stopLoader(l.root);
    expect(l.shown()).toBe(false);
  });

  it('stops cycling when stopped', () => {
    const l = fakeLoader();
    startLoader(l.root, l.text, ['one', 'two']);
    stopLoader(l.root);
    vi.advanceTimersByTime(CYCLE_MS * 3);
    expect(l.said()).toBe('one');
  });

  it('is safe to stop when never started', () => {
    const l = fakeLoader();
    expect(() => stopLoader(l.root)).not.toThrow();
  });

  it('is safe to stop twice', () => {
    const l = fakeLoader();
    startLoader(l.root, l.text, ['one']);
    stopLoader(l.root);
    expect(() => stopLoader(l.root)).not.toThrow();
  });

  it('cycles two loaders independently', () => {
    const a = fakeLoader();
    const b = fakeLoader();
    startLoader(a.root, a.text, ['a1', 'a2']);
    startLoader(b.root, b.text, ['b1', 'b2', 'b3']);
    vi.advanceTimersByTime(CYCLE_MS);
    expect(a.said()).toBe('a2');
    expect(b.said()).toBe('b2');
  });

  it('leaves the other loader cycling when one is stopped', () => {
    // The regression the per-loader timer exists to prevent: a component build
    // finishing must not freeze a foundation build's loader, or vice versa.
    const a = fakeLoader();
    const b = fakeLoader();
    startLoader(a.root, a.text, ['a1', 'a2']);
    startLoader(b.root, b.text, ['b1', 'b2']);
    stopLoader(a.root);

    vi.advanceTimersByTime(CYCLE_MS);
    expect(a.shown()).toBe(false);
    expect(a.said()).toBe('a1'); // frozen, as it should be
    expect(b.shown()).toBe(true);
    expect(b.said()).toBe('b2'); // still moving
  });

  it('falls back to a working message rather than showing an empty pill', () => {
    const l = fakeLoader();
    startLoader(l.root, l.text, []);
    expect(l.shown()).toBe(true);
    expect(l.said()).toBeTruthy();
  });
});
