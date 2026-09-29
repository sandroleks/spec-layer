import { describe, expect, it, vi } from 'vitest';
import { DocumentDirtyFlag, type DirtyPageLike } from '../src/libraryDirty';

function page(): DirtyPageLike & { fire(): void; on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> } {
  let handler: (() => void) | null = null;
  const on = vi.fn((_event: 'nodechange', cb: () => void) => { handler = cb; });
  const off = vi.fn((_event: 'nodechange', cb: () => void) => { if (handler === cb) handler = null; });
  return { on, off, fire: () => handler?.() };
}

describe('DocumentDirtyFlag', () => {
  it('starts dirty so the first scan always runs', () => {
    const flag = new DocumentDirtyFlag();
    expect(flag.isDirty).toBe(true);
  });

  it('consume returns the prior value and clears', () => {
    const flag = new DocumentDirtyFlag();
    expect(flag.consume()).toBe(true);
    expect(flag.isDirty).toBe(false);
    expect(flag.consume()).toBe(false);
  });

  it('a nodechange on the current page marks it dirty', () => {
    const flag = new DocumentDirtyFlag();
    const p = page();
    flag.attach({ currentPage: () => p, onPageChange: () => {}, onStyleChange: () => {} });
    flag.consume();
    expect(flag.isDirty).toBe(false);
    p.fire();
    expect(flag.isDirty).toBe(true);
    expect(p.on).toHaveBeenCalledWith('nodechange', expect.any(Function));
  });

  it('a page change moves the listener to the new page', () => {
    const flag = new DocumentDirtyFlag();
    const first = page();
    const second = page();
    let current = first;
    let onPageChange: (() => void) | null = null;
    flag.attach({ currentPage: () => current, onPageChange: (cb) => { onPageChange = cb; }, onStyleChange: () => {} });
    flag.consume();
    current = second;
    onPageChange!();
    expect(first.off).toHaveBeenCalledWith('nodechange', expect.any(Function));
    expect(second.on).toHaveBeenCalledWith('nodechange', expect.any(Function));
    first.fire();
    expect(flag.isDirty).toBe(false);
    second.fire();
    expect(flag.isDirty).toBe(true);
  });

  it('a page change back to the same page does not resubscribe', () => {
    const flag = new DocumentDirtyFlag();
    const p = page();
    let onPageChange: (() => void) | null = null;
    flag.attach({ currentPage: () => p, onPageChange: (cb) => { onPageChange = cb; }, onStyleChange: () => {} });
    onPageChange!();
    expect(p.on).toHaveBeenCalledTimes(1);
    expect(p.off).not.toHaveBeenCalled();
  });

  // Styles are document-wide, not page nodes: a rename, a deletion, or a
  // paint or text value edit arrives as a stylechange, on any page, and is
  // what lets the probe's fingerprint leave styles out.
  it('a style change marks it dirty, whichever page is open', () => {
    const flag = new DocumentDirtyFlag();
    const p = page();
    let onStyleChange: (() => void) | null = null;
    flag.attach({ currentPage: () => p, onPageChange: () => {}, onStyleChange: (cb) => { onStyleChange = cb; } });
    flag.consume();
    onStyleChange!();
    expect(flag.isDirty).toBe(true);
  });

  // main.ts reads a throwing attach as "not watched" and re-checks on every
  // visit, so a runtime without the style event must fail the attach rather
  // than leave style edits unwatched behind a clean flag.
  it('attach throws when the style watch cannot start', () => {
    const flag = new DocumentDirtyFlag();
    const p = page();
    expect(() => flag.attach({
      currentPage: () => p,
      onPageChange: () => {},
      onStyleChange: () => { throw new Error('unsupported event'); },
    })).toThrow('unsupported event');
  });
});
