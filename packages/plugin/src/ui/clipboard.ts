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

/**
 * Tier 3. Renders the payload in a pre-selected textarea so the user can copy
 * it with the keyboard. Returns a disposer the caller uses to dismiss it.
 */
export function renderManualCopyModal(text: string): () => void {
  const host = document.createElement('div');
  host.className = 'sl-copy-fallback';
  host.innerHTML =
    '<div class="sl-copy-fallback-panel">' +
    '<p>Select the text below and press Cmd C.</p>' +
    '<textarea readonly rows="12"></textarea>' +
    '<button type="button" data-copy-fallback-close>Close</button>' +
    '</div>';
  const ta = host.querySelector('textarea') as HTMLTextAreaElement;
  ta.value = text;
  const dispose = () => { if (host.parentNode) document.body.removeChild(host); };
  (host.querySelector('[data-copy-fallback-close]') as HTMLButtonElement)
    .addEventListener('click', dispose);
  document.body.appendChild(host);
  ta.focus();
  ta.select();
  return dispose;
}
