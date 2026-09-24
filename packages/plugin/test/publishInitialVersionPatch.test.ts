// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { patchInitialVersion, publishScrollMarkup } from '../src/ui/screens/publish';
import { createPublishState } from '../src/ui/publish';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = publishScrollMarkup({ ...createPublishState(), infoKnown: true }, { kind: 'hidden' });
  document.body.append(root);
  return root;
}

describe('patchInitialVersion', () => {
  it('marks the field invalid and shows the hint without rebuilding the input', () => {
    const root = mount();
    const input = root.querySelector<HTMLInputElement>('[data-publish-initial-version]')!;
    const hint = root.querySelector<HTMLElement>('[data-publish-initial-version-error]')!;
    expect(hint.hidden).toBe(true);
    input.focus();
    input.value = '2.0';

    expect(patchInitialVersion(root, '2.0')).toBe(true);

    expect(root.querySelector('[data-publish-initial-version]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.closest('.sl-field')?.getAttribute('data-invalid')).toBe('true');
    expect(hint.hidden).toBe(false);

    patchInitialVersion(root, '2.0.0 ');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(input.closest('.sl-field')?.hasAttribute('data-invalid')).toBe(false);
    expect(hint.hidden).toBe(true);
  });

  it('reports when the field is not on screen', () => {
    const root = document.createElement('div');
    expect(patchInitialVersion(root, '1.0.0')).toBe(false);
  });
});
