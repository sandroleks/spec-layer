// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { confirmDialog } from '../src/ui/shell/confirmDialog';

afterEach(() => {
  document.body.innerHTML = '';
});

const OPTIONS = {
  title: 'Remove this frame from the canvas?',
  body: 'The Section and its Library connection are removed.',
  confirmLabel: 'Remove',
  tone: 'danger' as const,
};

function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!el) throw new Error('no dialog rendered');
  return el;
}

describe('confirmDialog', () => {
  it('renders title, body, and both actions, and focuses Cancel', () => {
    void confirmDialog(OPTIONS);
    const el = dialog();
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector('h2')?.textContent).toBe(OPTIONS.title);
    expect(el.querySelector('p')?.textContent).toBe(OPTIONS.body);
    const accept = el.querySelector<HTMLButtonElement>('[data-confirm-accept]');
    const cancel = el.querySelector<HTMLButtonElement>('[data-confirm-cancel]');
    expect(accept?.textContent).toBe('Remove');
    expect(accept?.dataset.tone).toBe('danger');
    expect(cancel?.textContent).toBe('Cancel');
    expect(document.activeElement).toBe(cancel);
  });

  it('resolves true on accept and removes itself', async () => {
    const result = confirmDialog(OPTIONS);
    dialog().querySelector<HTMLButtonElement>('[data-confirm-accept]')?.click();
    expect(await result).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('resolves false on cancel', async () => {
    const result = confirmDialog(OPTIONS);
    dialog().querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.click();
    expect(await result).toBe(false);
  });

  it('resolves false on Escape and stops the key reaching the shell', async () => {
    let reachedShell = false;
    document.addEventListener('keydown', () => { reachedShell = true; });
    const result = confirmDialog(OPTIONS);
    dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await result).toBe(false);
    expect(reachedShell).toBe(false);
  });

  it('resolves false on a backdrop click but not on a click inside the dialog', async () => {
    const result = confirmDialog(OPTIONS);
    dialog().querySelector('p')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    document.querySelector<HTMLElement>('[data-confirm-dialog]')?.click();
    expect(await result).toBe(false);
  });

  it('returns focus to the element that opened it', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const result = confirmDialog(OPTIONS);
    dialog().querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.click();
    await result;
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside the dialog', () => {
    void confirmDialog(OPTIONS);
    const el = dialog();
    const cancel = el.querySelector<HTMLButtonElement>('[data-confirm-cancel]');
    const accept = el.querySelector<HTMLButtonElement>('[data-confirm-accept]');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(accept);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(cancel);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(accept);
  });

  it('refuses a second dialog while one is open', async () => {
    const first = confirmDialog(OPTIONS);
    expect(await confirmDialog(OPTIONS)).toBe(false);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    dialog().querySelector<HTMLButtonElement>('[data-confirm-accept]')?.click();
    expect(await first).toBe(true);
  });

  it('defaults to the primary tone and a Cancel label', () => {
    void confirmDialog({ title: 'Update?', body: 'Edits are replaced.', confirmLabel: 'Update' });
    const accept = dialog().querySelector<HTMLButtonElement>('[data-confirm-accept]');
    expect(accept?.dataset.tone).toBe('primary');
    expect(dialog().querySelector('[data-confirm-cancel]')?.textContent).toBe('Cancel');
  });
});
