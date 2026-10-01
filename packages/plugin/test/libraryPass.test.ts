import { describe, expect, it } from 'vitest';
import type { SpecHashProjection } from '@spec-layer/extractor';
import { DriftQueue, libraryCarry } from '../src/ui/libraryPass';
import type { LibraryDriftState } from '../src/ui/viewModel/library';

describe('DriftQueue', () => {
  it('hands out doc ids in order, one in flight at a time, with the pass id they go under', () => {
    const q = new DriftQueue();
    q.start('p1', ['a', 'b', 'c']);
    expect(q.id()).toBe('p1');
    expect(q.next()).toEqual({ docId: 'a', passId: 'p1' });
    expect(q.next()).toBeNull();
    expect(q.inFlight()).toBe('a');
    expect(q.settle('a', 'p1')).toBe(true);
    expect(q.next()).toEqual({ docId: 'b', passId: 'p1' });
  });

  it('ignores a settle for a doc that is not in flight', () => {
    const q = new DriftQueue();
    q.start('p1', ['a', 'b']);
    q.next();
    expect(q.settle('b', 'p1')).toBe(false);
    expect(q.inFlight()).toBe('a');
  });

  it('is done only when nothing is in flight and nothing is pending', () => {
    const q = new DriftQueue();
    expect(q.done()).toBe(true);
    q.start('p1', ['a']);
    expect(q.done()).toBe(false);
    q.next();
    expect(q.done()).toBe(false);
    q.settle('a', 'p1');
    expect(q.done()).toBe(true);
  });

  it('keeps pending docs across a pause and takes a new id on resume', () => {
    const q = new DriftQueue();
    q.start('p1', ['a', 'b', 'c']);
    q.next();
    q.settle('a', 'p1');
    expect(q.pending()).toEqual(['b', 'c']);
    q.resume('p2');
    expect(q.id()).toBe('p2');
    expect(q.next()).toEqual({ docId: 'b', passId: 'p2' });
  });

  it('start replaces any earlier pass and clear empties it', () => {
    const q = new DriftQueue();
    q.start('p1', ['a', 'b']);
    q.next();
    q.start('p2', ['x']);
    expect(q.inFlight()).toBeNull();
    expect(q.next()).toEqual({ docId: 'x', passId: 'p2' });
    q.clear();
    expect(q.id()).toBeNull();
    expect(q.done()).toBe(true);
    expect(q.next()).toBeNull();
  });

  // A reply names the pass its request went out under. The one that matches
  // the check in flight settles it; anything else is from a pass that was
  // replaced, and must neither settle nor set a row.
  it('rejects a reply from a replaced pass, even for the doc now in flight', () => {
    const q = new DriftQueue();
    q.start('p1', ['a', 'b']);
    q.next();
    q.start('p2', ['a', 'b']);
    q.next();
    expect(q.settle('a', 'p1')).toBe(false);
    expect(q.inFlight()).toBe('a');
    expect(q.settle('a', 'p2')).toBe(true);
    expect(q.next()).toEqual({ docId: 'b', passId: 'p2' });
  });

  it('still settles the check in flight across a resume, under the id it was sent with', () => {
    const q = new DriftQueue();
    q.start('p1', ['a', 'b']);
    q.next();
    q.resume('p2');
    expect(q.settle('a', 'p2')).toBe(false);
    expect(q.settle('a', 'p1')).toBe(true);
    expect(q.next()).toEqual({ docId: 'b', passId: 'p2' });
  });

  it('rejects every reply once cleared', () => {
    const q = new DriftQueue();
    q.start('p1', ['a']);
    q.next();
    q.clear();
    expect(q.settle('a', 'p1')).toBe(false);
  });
});

describe('libraryCarry', () => {
  const projection = { name: 'Button' } as unknown as SpecHashProjection;

  it('keeps settled checks, with the projection a drifted row diffs, at their check time', () => {
    const carry = libraryCarry({
      drift: new Map<string, LibraryDriftState>([
        ['a', 'inSync'], ['b', 'drifted'], ['c', 'pending'], ['d', 'unavailable'], ['e', 'staleVersion'],
      ]),
      projections: new Map([['b', projection]]),
      checkedAt: 1000,
      rebuilt: [],
    });
    expect([...carry.checks]).toEqual([
      ['a', { status: 'inSync' }],
      ['b', { status: 'drifted', projection }],
    ]);
    expect(carry.checkedAt).toBe(1000);
  });

  it('marks the docs a run rebuilt in sync', () => {
    const carry = libraryCarry({ drift: new Map(), projections: new Map(), checkedAt: 1000, rebuilt: ['new'] });
    expect(carry.checks.get('new')).toEqual({ status: 'inSync' });
    // Nothing earlier was kept, so the pass is as fresh as the rebuild.
    expect(carry.checkedAt).toBeNull();
  });

  it('keeps nothing from a check that never completed', () => {
    const carry = libraryCarry({
      drift: new Map<string, LibraryDriftState>([['a', 'inSync']]),
      projections: new Map(), checkedAt: null, rebuilt: ['new'],
    });
    expect([...carry.checks.keys()]).toEqual(['new']);
    expect(carry.checkedAt).toBeNull();
  });
});
