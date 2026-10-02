import { describe, it, expect, vi } from 'vitest';
import { CANVAS_EDITS, UNEXPECTED_ERROR, dispatchUiMessage, type DispatchDeps } from '../src/uiDispatch';

const deps = () => ({
  commitUndo: vi.fn<DispatchDeps['commitUndo']>(),
  notifyError: vi.fn<DispatchDeps['notifyError']>(),
  log: vi.fn<DispatchDeps['log']>(),
});

describe('dispatchUiMessage', () => {
  it.each([...CANVAS_EDITS])('closes an undo step after %s', async (type) => {
    const d = deps();
    await dispatchUiMessage({ type }, async () => {}, d);
    expect(d.commitUndo).toHaveBeenCalledTimes(1);
  });

  it('closes no undo step after a message that does not edit the canvas', async () => {
    const d = deps();
    for (const type of ['requestSelection', 'requestLibrary', 'setAiEnabled', 'notify']) {
      await dispatchUiMessage({ type }, async () => {}, d);
    }
    expect(d.commitUndo).not.toHaveBeenCalled();
  });

  it('commits the undo step only after the handler has finished', async () => {
    const order: string[] = [];
    const d = deps();
    d.commitUndo.mockImplementation(() => order.push('commit'));
    await dispatchUiMessage({ type: 'renderDocFrame' }, async () => {
      await Promise.resolve();
      order.push('handled');
    }, d);
    expect(order).toEqual(['handled', 'commit']);
  });

  it('logs and shows an unexpected throw instead of rejecting, and still closes the undo step', async () => {
    const d = deps();
    const boom = new Error('boom');
    await expect(dispatchUiMessage({ type: 'removeDoc' }, async () => { throw boom; }, d)).resolves.toBeUndefined();
    expect(d.log).toHaveBeenCalledWith('[Spec Layer] removeDoc failed', boom);
    expect(d.notifyError).toHaveBeenCalledWith(UNEXPECTED_ERROR);
    expect(d.commitUndo).toHaveBeenCalledTimes(1);
  });

  it('survives a message with no type', async () => {
    const d = deps();
    await dispatchUiMessage(null, async () => { throw new Error('bad'); }, d);
    expect(d.log).toHaveBeenCalledWith('[Spec Layer] unknown failed', expect.any(Error));
    expect(d.commitUndo).not.toHaveBeenCalled();
  });

  it('writes plugin UI copy without em dashes', () => {
    expect(UNEXPECTED_ERROR).not.toContain('—');
  });

  it('names only message types the main thread handles', async () => {
    const { readFileSync } = await import('node:fs');
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    for (const type of CANVAS_EDITS) expect(main, type).toContain(`case '${type}':`);
  });
});
