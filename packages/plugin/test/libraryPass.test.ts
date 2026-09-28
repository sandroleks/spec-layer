import { describe, expect, it } from 'vitest';
import { DriftQueue } from '../src/ui/libraryPass';

describe('DriftQueue', () => {
  it('hands out doc ids in order, one in flight at a time', () => {
    const q = new DriftQueue();
    q.start('p1', ['a', 'b', 'c']);
    expect(q.id()).toBe('p1');
    expect(q.next()).toBe('a');
    expect(q.next()).toBeNull();
    expect(q.inFlight()).toBe('a');
    expect(q.settle('a')).toBe(true);
    expect(q.next()).toBe('b');
  });

  it('ignores a settle for a doc that is not in flight', () => {
    const q = new DriftQueue();
    q.start('p1', ['a', 'b']);
    q.next();
    expect(q.settle('b')).toBe(false);
    expect(q.inFlight()).toBe('a');
  });

  it('is done only when nothing is in flight and nothing is pending', () => {
    const q = new DriftQueue();
    expect(q.done()).toBe(true);
    q.start('p1', ['a']);
    expect(q.done()).toBe(false);
    q.next();
    expect(q.done()).toBe(false);
    q.settle('a');
    expect(q.done()).toBe(true);
  });

  it('keeps pending docs across a pause and takes a new id on resume', () => {
    const q = new DriftQueue();
    q.start('p1', ['a', 'b', 'c']);
    q.next();
    q.settle('a');
    expect(q.pending()).toEqual(['b', 'c']);
    q.resume('p2');
    expect(q.id()).toBe('p2');
    expect(q.next()).toBe('b');
  });

  it('start replaces any earlier pass and clear empties it', () => {
    const q = new DriftQueue();
    q.start('p1', ['a', 'b']);
    q.next();
    q.start('p2', ['x']);
    expect(q.inFlight()).toBeNull();
    expect(q.next()).toBe('x');
    q.clear();
    expect(q.id()).toBeNull();
    expect(q.done()).toBe(true);
  });
});
