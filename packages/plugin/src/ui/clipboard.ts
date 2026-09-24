/**
 * clipboard.ts — writing text to the clipboard from a Figma plugin iframe.
 *
 * Three tiers, because no single mechanism is reliable here:
 *
 *   1. navigator.clipboard.writeText, which the iframe's permissions policy
 *      often blocks outright.
 *   2. A hidden textarea plus document.execCommand('copy'), which only works
 *      inside the user-gesture call stack. An awaited extraction between the
 *      click and this call destroys that stack, so tier 2 can fail for a
 *      reason that has nothing to do with permissions.
 *   3. Showing the text and letting the user copy it. Always works, and is
 *      the reason this function never needs to throw.
 *
 * Callers branch on the returned tier rather than on success, since 'manual'
 * is a real outcome the UI has to narrate, not an error.
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
    // Off-screen rather than display:none: a hidden element cannot be selected,
    // and an unselected textarea makes execCommand('copy') a no-op.
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

// Tracks the currently open manual-copy dialog's disposer, so a second call
// while one is open can close it first rather than stacking a second
// `.sl-overlay` with a second capture-phase keydown listener.
let openManualCopyDialog: (() => void) | null = null;

/**
 * Tier 3. The same `.sl-overlay` / `.sl-dialog` the confirm dialog draws
 * (shell/confirmDialog.ts), with the payload in a pre-selected textarea so
 * the user can copy it with the keyboard. Returns a disposer.
 *
 * `notice` carries the same honesty caveats the toast path computes (missing
 * token values, missing guidelines, payload size): a tier-3 user gets a
 * payload that can be just as incomplete, and this is the only place left
 * to say so. Every string lands through textContent, never innerHTML.
 *
 * Escape closes, Tab stays between the textarea and Close, and focus goes
 * back to whatever opened it. Escape runs in the capture phase and stops
 * there, so it never also backs the shell out of the screen underneath.
 *
 * One dialog at a time. Calling this again while one is already open closes
 * it first (running its own disposer, which restores focus to that dialog's
 * opener) before capturing the opener for the new one, so a second quick
 * copy replaces the dialog underneath instead of stacking on top of it, and
 * closing the replacement still returns focus to the control that started
 * the first one, not to anything inside the dialog being replaced.
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
