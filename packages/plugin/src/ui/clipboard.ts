/**
 * Clipboard writes from the Figma plugin iframe, in three tiers:
 *
 *   1. navigator.clipboard.writeText, which the iframe's permissions policy
 *      often blocks.
 *   2. A hidden textarea plus execCommand('copy'), which works only inside the
 *      user-gesture call stack; an awaited extraction before it destroys that.
 *   3. Showing the text for the user to copy. Always works, so nothing throws.
 *
 * Callers branch on the tier: 'manual' is an outcome to narrate, not an error.
 */

export type CopyTier = 'async' | 'exec' | 'manual';

async function tryAsync(text: string): Promise<boolean> {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator;
  const writeText = nav?.clipboard?.writeText;
  if (typeof writeText !== 'function') return false;
  try {
    await writeText.call(nav!.clipboard, text);
    return true;
  } catch {
    return false;
  }
}

function tryExec(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Off-screen, not display:none: a hidden textarea cannot be selected.
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    try {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      return document.execCommand('copy') === true;
    } finally {
      document.body.removeChild(ta);
    }
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<CopyTier> {
  if (await tryAsync(text)) return 'async';
  if (tryExec(text)) return 'exec';
  return 'manual';
}

// The open dialog's disposer, so a second call closes it rather than stacking.
let openManualCopyDialog: (() => void) | null = null;

/**
 * Tier 3: the confirm dialog's overlay (shell/confirmDialog.ts) with the text
 * pre-selected. Returns a disposer. `notice` carries the toast's caveats, since
 * this payload can be just as incomplete; strings go through textContent only.
 *
 * Escape closes in the capture phase and stops there, so the shell underneath
 * never also backs out. Tab cycles textarea and Close; focus returns to the
 * opener. An open dialog is closed before the new opener is captured, so focus
 * still returns to the first control.
 */
export function renderManualCopyModal(text: string, notice?: string): () => void {
  openManualCopyDialog?.();

  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const host = document.createElement('div');
  host.className = 'sl-overlay sl-copy-fallback';
  host.setAttribute('data-copy-fallback', '');

  const dialog = document.createElement('div');
  dialog.className = 'sl-dialog sl-copy-fallback-panel';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'sl-copy-fallback-title');

  const title = document.createElement('h2');
  title.id = 'sl-copy-fallback-title';
  title.textContent = 'Copy the text yourself';

  const body = document.createElement('p');
  body.id = 'sl-copy-fallback-body';
  body.textContent = 'Couldn’t copy automatically. Press Cmd C (Ctrl C on Windows) to copy the selected text below.';

  const ta = document.createElement('textarea');
  ta.readOnly = true;
  ta.rows = 12;
  ta.value = text;
  ta.setAttribute('aria-label', 'Text to copy');

  const actions = document.createElement('div');
  actions.className = 'sl-dialog-actions';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'sl-button';
  close.dataset.tone = 'secondary';
  close.setAttribute('data-copy-fallback-close', '');
  close.textContent = 'Close';
  actions.appendChild(close);

  dialog.append(title, body);
  if (notice) {
    const p = document.createElement('p');
    p.id = 'sl-copy-fallback-notice';
    p.className = 'sl-copy-fallback-notice';
    p.textContent = notice;
    dialog.appendChild(p);
    dialog.setAttribute('aria-describedby', 'sl-copy-fallback-body sl-copy-fallback-notice');
  } else {
    dialog.setAttribute('aria-describedby', 'sl-copy-fallback-body');
  }
  dialog.append(ta, actions);
  host.appendChild(dialog);

  const dispose = (): void => {
    if (!host.isConnected) return; // already closed; calling twice is fine
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    if (openManualCopyDialog === dispose) openManualCopyDialog = null;
    opener?.focus();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (!host.isConnected) {
      document.removeEventListener('keydown', onKey, true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      dispose();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopImmediatePropagation();
      (document.activeElement === ta ? close : ta).focus();
    }
  };
  document.addEventListener('keydown', onKey, true);
  host.addEventListener('click', (event) => {
    if (event.target === host) dispose();
  });
  close.addEventListener('click', dispose);

  openManualCopyDialog = dispose;
  document.body.appendChild(host);
  ta.focus();
  ta.select();
  return dispose;
}
