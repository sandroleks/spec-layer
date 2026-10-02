// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { ERROR_TOAST_QUIET_MS, UI_UNEXPECTED_ERROR, installErrorReporting } from '../src/ui/errorReporting';
import { UNEXPECTED_ERROR } from '../src/uiDispatch';

function setup() {
  const target = new EventTarget() as unknown as Window;
  let clock = 1_000_000;
  const deps = { log: vi.fn(), notify: vi.fn(), now: () => clock };
  installErrorReporting(target, deps);
  const error = (message: string) => {
    const event = new Event('error') as Event & { message: string; error: Error };
    Object.assign(event, { message, error: new Error(message) });
    target.dispatchEvent(event);
  };
  const rejection = (reason: unknown) => {
    const event = new Event('unhandledrejection') as Event & { reason: unknown };
    Object.assign(event, { reason });
    target.dispatchEvent(event);
  };
  return { deps, error, rejection, advance: (ms: number) => { clock += ms; } };
}

describe('installErrorReporting', () => {
  it('logs an uncaught error and a stray rejection, and shows one toast', () => {
    const { deps, error, rejection } = setup();
    error('boom');
    rejection(new Error('lost'));
    expect(deps.log).toHaveBeenCalledWith('[Spec Layer] uncaught error', expect.any(Error));
    expect(deps.log).toHaveBeenCalledWith('[Spec Layer] unhandled rejection', expect.any(Error));
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith(UI_UNEXPECTED_ERROR);
  });

  it('shows another toast only after the quiet period', () => {
    const { deps, error, advance } = setup();
    error('one');
    advance(ERROR_TOAST_QUIET_MS - 1);
    error('two');
    expect(deps.notify).toHaveBeenCalledTimes(1);
    advance(1);
    error('three');
    expect(deps.notify).toHaveBeenCalledTimes(2);
    expect(deps.log).toHaveBeenCalledTimes(3);
  });

  it('ignores the browser\'s ResizeObserver loop notice', () => {
    const { deps, error } = setup();
    error('ResizeObserver loop completed with undelivered notifications.');
    expect(deps.log).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('uses the same words as the main thread, with no em dash', () => {
    expect(UI_UNEXPECTED_ERROR).toBe(UNEXPECTED_ERROR);
    expect(UI_UNEXPECTED_ERROR).not.toContain('—');
  });
});
