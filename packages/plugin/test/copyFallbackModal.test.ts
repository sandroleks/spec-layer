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
    expect(panel?.querySelector('p')?.textContent).toBe('Select the text below and press Cmd C.');
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
});
