/**
 * An in-shell confirmation, replacing window.confirm.
 *
 * Figma's plugin iframe is sandboxed. A sandboxed iframe without
 * `allow-modals` makes confirm() return false without showing anything, which
 * turned every guarded action into a silent no-op. Native dialogs also ignore
 * the theme and cannot be focus-trapped. This renders the same .sl-overlay and
 * .sl-dialog the design system already defines.
 *
 * Text lands through textContent, never innerHTML, so a document name inside a
 * body string can never become markup. One dialog at a time, judged by whether
 * one is in the DOM: a second call while one is open resolves false at once
 * rather than stacking.
 */
export interface ConfirmDialogOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
}

function button(label: string, tone: string): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'sl-button';
  el.dataset.tone = tone;
  el.textContent = label;
  return el;
}

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  // One dialog at a time, judged from the DOM rather than a module flag: the
  // dialog's own removal is what ends it, so anything that removes the host
  // (Close, Escape, or some other means entirely) also releases the lock.
  if (document.querySelector('[data-confirm-dialog]')) return Promise.resolve(false);

  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const host = document.createElement('div');
  host.className = 'sl-overlay';
  host.setAttribute('data-confirm-dialog', '');

  const dialog = document.createElement('div');
  dialog.className = 'sl-dialog sl-confirm-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'sl-confirm-title');
  dialog.setAttribute('aria-describedby', 'sl-confirm-body');

  const title = document.createElement('h2');
  title.id = 'sl-confirm-title';
  title.textContent = options.title;

  const body = document.createElement('p');
  body.id = 'sl-confirm-body';
  body.textContent = options.body;

  const actions = document.createElement('div');
  actions.className = 'sl-dialog-actions';
  const cancel = button(options.cancelLabel ?? 'Cancel', 'secondary');
  cancel.setAttribute('data-confirm-cancel', '');
  const accept = button(options.confirmLabel, options.tone ?? 'primary');
  accept.setAttribute('data-confirm-accept', '');
  actions.append(cancel, accept);

  dialog.append(title, body, actions);
  host.appendChild(dialog);

  return new Promise<boolean>((resolve) => {
    const close = (result: boolean): void => {
      document.removeEventListener('keydown', onKey, true);
      host.remove();
      opener?.focus();
      resolve(result);
    };

    // Capture phase, so this runs before the shell's own keydown listener on
    // document, and stopImmediatePropagation keeps Escape from also backing
    // out of whatever screen sits under the overlay.
    const onKey = (event: KeyboardEvent): void => {
      if (!host.isConnected) {
        // The host was removed without close() running, by some means other
        // than this module (paint() never touches document.body, so it is
        // not the cause). Detach quietly and let the key through.
        document.removeEventListener('keydown', onKey, true);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close(false);
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const items = [cancel, accept];
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.shiftKey
          ? (current <= 0 ? items.length - 1 : current - 1)
          : (current < 0 || current === items.length - 1 ? 0 : current + 1);
        items[next].focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    host.addEventListener('click', (event) => {
      if (event.target === host) close(false);
    });
    cancel.addEventListener('click', () => close(false));
    accept.addEventListener('click', () => close(true));

    document.body.appendChild(host);
    cancel.focus();
  });
}
