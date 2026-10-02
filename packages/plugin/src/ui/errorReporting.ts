/**
 * Errors the UI did not catch. Before this, a throw in an event handler or a
 * rejected promise nobody awaited vanished: nothing in the console said which
 * one, and nothing on screen said the action had stopped. Each is now logged
 * with a Spec Layer prefix and, at most once per quiet period, shown as a
 * native toast, so a broken action is never silent and a repeating error
 * never floods the canvas.
 */

/** Plain, second person, no em dashes; the same words the main thread uses. */
export const UI_UNEXPECTED_ERROR = 'Something went wrong in Spec Layer. Try again, and if it keeps happening, reopen the plugin.';

/** A second toast within this window is logged only. */
export const ERROR_TOAST_QUIET_MS = 30_000;

/** Browser notices that are not failures of the plugin's own code. */
const BENIGN = [/ResizeObserver loop/];

export interface ErrorReportingDeps {
  log(message: string, detail: unknown): void;
  notify(message: string): void;
  now(): number;
}

export function installErrorReporting(win: Window, deps: ErrorReportingDeps): void {
  let lastToast = Number.NEGATIVE_INFINITY;
  const report = (kind: string, detail: unknown, text: string): void => {
    if (BENIGN.some((re) => re.test(text))) return;
    deps.log(`[Spec Layer] ${kind}`, detail);
    const now = deps.now();
    if (now - lastToast < ERROR_TOAST_QUIET_MS) return;
    lastToast = now;
    deps.notify(UI_UNEXPECTED_ERROR);
  };
  win.addEventListener('error', (event: ErrorEvent) => {
    report('uncaught error', event.error ?? event.message, String(event.message ?? ''));
  });
  win.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    report('unhandled rejection', reason, reason instanceof Error ? reason.message : String(reason));
  });
}
