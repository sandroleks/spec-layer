// @vitest-environment happy-dom
//
// renderManualCopyModal needs a real DOM (innerHTML parsing, querySelector),
// unlike clipboard.test.ts's copyText tests, which stub just enough of
// `document` by hand. happy-dom is a dev-only dependency, used only here,
// exactly like js-yaml's dev-only role for the brief tests.
import { describe, it, expect, afterEach } from 'vitest';
import { renderManualCopyModal } from '../src/ui/clipboard';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderManualCopyModal', () => {
  it('keeps the primary instruction and puts the payload in a pre-selected textarea', () => {
    renderManualCopyModal('spec_layer: {}');
    const panel = document.querySelector('.sl-copy-fallback-panel');
    expect(panel?.querySelector('p')?.textContent)
      .toBe('Couldn’t copy automatically. Press Cmd C (Ctrl C on Windows) to copy the selected text below.');
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe('spec_layer: {}');
    expect(document.activeElement).toBe(ta);
  });

  it('renders no caveat paragraph when none is given', () => {
    renderManualCopyModal('payload');
    expect(document.querySelector('.sl-copy-fallback-notice')).toBeNull();
  });

  it('renders the caveat text so a tier-3 user sees the same honesty warning the toast gives', () => {
    const caveat = 'Token values are missing because foundations have not been read yet.';
    renderManualCopyModal('payload', caveat);
    const notice = document.querySelector('.sl-copy-fallback-notice');
    expect(notice?.textContent).toBe(caveat);
    // The caveat is part of what the dialog describes, not just decoration
    // next to the body text, so a screen reader announces it too.
    expect(notice?.id).toBe('sl-copy-fallback-notice');
    expect(document.querySelector('.sl-copy-fallback-panel')?.getAttribute('aria-describedby'))
      .toBe('sl-copy-fallback-body sl-copy-fallback-notice');
  });

  it('places the caveat as text content, never as interpreted markup', () => {
    const caveat = '<img src=x onerror=alert(1)>';
    renderManualCopyModal('payload', caveat);
    const notice = document.querySelector('.sl-copy-fallback-notice');
    expect(notice?.textContent).toBe(caveat);
    expect(notice?.querySelector('img')).toBeNull();
  });

  it('disposes the modal on Close', () => {
    renderManualCopyModal('payload', 'a caveat');
    expect(document.querySelector('.sl-copy-fallback')).not.toBeNull();
    (document.querySelector('[data-copy-fallback-close]') as HTMLButtonElement).click();
    expect(document.querySelector('.sl-copy-fallback')).toBeNull();
  });

  it('the returned disposer also removes the modal', () => {
    const dispose = renderManualCopyModal('payload');
    dispose();
    expect(document.querySelector('.sl-copy-fallback')).toBeNull();
    // Calling twice must not throw (host.parentNode is already null).
    expect(() => dispose()).not.toThrow();
  });

  it('renders as a modal dialog on the shared overlay, so the design system styles it', () => {
    renderManualCopyModal('payload');
    const host = document.querySelector<HTMLElement>('.sl-copy-fallback');
    expect(host?.classList.contains('sl-overlay')).toBe(true);
    const dialog = host?.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.classList.contains('sl-dialog')).toBe(true);
    expect(dialog?.classList.contains('sl-copy-fallback-panel')).toBe(true);
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Copy the text yourself');
    expect(dialog?.querySelector('.sl-dialog-actions [data-copy-fallback-close]')).not.toBeNull();
  });

  it('closes on Escape and stops the key reaching the shell', () => {
    let reachedShell = false;
    document.addEventListener('keydown', () => { reachedShell = true; });
    renderManualCopyModal('payload');
    document.querySelector('textarea')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.sl-copy-fallback')).toBeNull();
    expect(reachedShell).toBe(false);
  });

  it('keeps Tab inside the dialog', () => {
    renderManualCopyModal('payload');
    const ta = document.querySelector<HTMLTextAreaElement>('textarea')!;
    const close = document.querySelector<HTMLButtonElement>('[data-copy-fallback-close]')!;
    expect(document.activeElement).toBe(ta);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(ta);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(close);
  });

  it('returns focus to the control that opened it', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    renderManualCopyModal('payload');
    (document.querySelector('[data-copy-fallback-close]') as HTMLButtonElement).click();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on a backdrop click but not on a click inside the dialog', () => {
    renderManualCopyModal('payload');
    document.querySelector('.sl-copy-fallback-panel p')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.sl-copy-fallback')).not.toBeNull();
    document.querySelector<HTMLElement>('.sl-copy-fallback')!.click();
    expect(document.querySelector('.sl-copy-fallback')).toBeNull();
  });

  it('a second manual copy replaces the open dialog instead of stacking on top of it', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    renderManualCopyModal('first payload');
    renderManualCopyModal('second payload');

    // Exactly one dialog, showing the newer text.
    expect(document.querySelectorAll('[data-copy-fallback]').length).toBe(1);
    expect(document.querySelector('textarea')!.value).toBe('second payload');

    // One Escape is enough: the first dialog's own listener was removed when
    // it was replaced, so this reaches only the surviving dialog.
    document.querySelector('textarea')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[data-copy-fallback]')).toBeNull();

    // Focus goes back to the control that started the first copy, not to
    // anything that belonged to the dialog it was replaced by.
    expect(document.activeElement).toBe(opener);
  });
});
