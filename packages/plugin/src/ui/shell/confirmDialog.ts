/**
 * An in-shell confirmation, replacing window.confirm: Figma's sandboxed iframe
 * lacks `allow-modals`, so confirm() returns false without showing anything.
 * Text lands through textContent, never innerHTML, so a document name can never
 * become markup. A second call while one is open resolves false at once.
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
  // Judged from the DOM, not a flag, so anything that removes the host also
  // releases the lock.
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

    // Capture phase runs before the shell's keydown listener, and
    // stopImmediatePropagation keeps Escape from backing out of the screen below.
    const onKey = (event: KeyboardEvent): void => {
      if (!host.isConnected) {
        // Removed without close() (paint() never touches body): detach, let the key through.
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
