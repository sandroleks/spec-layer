import { describe, expect, it, vi } from 'vitest';
import { BlockWatch } from '../src/timing';

function watch(threshold = 100) {
  let t = 0;
  const report = vi.fn();
  const w = new BlockWatch(() => t, threshold, report);
  return { w, report, at: (ms: number) => { t = ms; } };
}

describe('BlockWatch', () => {
  it('stays quiet while the timer fires on time', () => {
    const { w, report, at } = watch();
    at(50); w.tick(50);
    at(100); w.tick(50);
    at(160); w.tick(50);
    expect(report).not.toHaveBeenCalled();
  });

  it('reports how long past due the timer fired, once over the threshold', () => {
    const { w, report, at } = watch();
    at(50); w.tick(50);
    at(400); w.tick(50);
    expect(report).toHaveBeenCalledWith(300, ['idle']);
  });

  // The block is over by the time the late tick runs, so the activity then
  // is often "idle" again. Everything named since the previous tick is what
  // could have held the thread.
  it('blames every activity named since the previous tick', () => {
    const { w, report, at } = watch();
    at(50); w.tick(50);
    w.doing('requestLibrary');
    w.doing('requestDrift a');
    w.done();
    at(900); w.tick(50);
    expect(report).toHaveBeenCalledWith(800, ['requestLibrary', 'requestDrift a']);
  });

  it('starts the next window from what is still running', () => {
    const { w, report, at } = watch();
    w.doing('requestDrift a');
    at(50); w.tick(50);
    at(400); w.tick(50);
    expect(report).toHaveBeenCalledWith(300, ['requestDrift a']);
  });

  it('forgets activities that finished before a quiet window', () => {
    const { w, report, at } = watch();
    w.doing('paint');
    w.done();
    at(50); w.tick(50);
    at(400); w.tick(50);
    expect(report).toHaveBeenCalledWith(300, ['idle']);
  });
});
