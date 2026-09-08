// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { globalSearchMarkup, patchGlobalSearch } from '../src/ui/screens/search';
import {
  buildSearchModel,
  type SearchDocument,
} from '../src/ui/viewModel/search';

/**
 * The palette used to be re-inserted on every keystroke, which restarted the
 * panel's entry animation and made it blink once per typed letter. These pin
 * the fix: an update keeps the mounted nodes and touches only the list.
 */

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-08T12:00:00Z');

const DOCUMENTS: SearchDocument[] = [
  {
    docId: 'buttonPrimary',
    kind: 'component',
    label: 'Button / Primary',
    sourceLabel: 'Components',
    generatedAt: NOW,
  },
  {
    docId: 'inputField',
    kind: 'component',
    label: 'Input field',
    sourceLabel: 'Forms',
    generatedAt: NOW - HOUR,
  },
];

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(query = ''): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = globalSearchMarkup(buildSearchModel(DOCUMENTS, query));
  document.body.append(root);
  return root;
}

describe('patchGlobalSearch', () => {
  it('keeps the animated panel and the live input, replacing only the list', () => {
    const root = mount();
    const panel = root.querySelector('.sl-global-search-panel');
    const input = root.querySelector<HTMLInputElement>('[data-global-search-input]');
    const list = root.querySelector('.sl-global-search-results');
    input?.focus();
    input!.value = 'input';

    expect(patchGlobalSearch(root, buildSearchModel(DOCUMENTS, 'input'))).toBe(true);

    expect(root.querySelector('.sl-global-search-panel')).toBe(panel);
    expect(root.querySelector('[data-global-search-input]')).toBe(input);
    expect(root.querySelector('.sl-global-search-results')).toBe(list);
    expect(document.activeElement).toBe(input);
    expect([...root.querySelectorAll('[data-search-doc-id]')]
      .map((row) => (row as HTMLElement).dataset.searchDocId))
      .toEqual(['inputField']);
  });

  it('leaves what the user typed alone, and follows a cleared query', () => {
    const root = mount('input');
    const input = root.querySelector<HTMLInputElement>('[data-global-search-input]')!;
    // Mid-composition the DOM leads the model; the patch must not rewrite it.
    input.value = 'inputf';
    patchGlobalSearch(root, buildSearchModel(DOCUMENTS, 'inputf'));
    expect(input.value).toBe('inputf');

    patchGlobalSearch(root, buildSearchModel(DOCUMENTS, ''));
    expect(input.value).toBe('');
  });

  it('moves the pointer attribute with the model, and drops it with the list', () => {
    const root = mount();
    const input = root.querySelector<HTMLInputElement>('[data-global-search-input]')!;

    patchGlobalSearch(root, buildSearchModel(DOCUMENTS, '', 1));
    expect(input.getAttribute('aria-activedescendant'))
      .toBe('sl-global-search-result-1');

    patchGlobalSearch(root, buildSearchModel(DOCUMENTS, 'no such result'));
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(root.querySelector('.sl-global-search-empty')).not.toBeNull();
  });

  it('reports that nothing was mounted rather than mounting one itself', () => {
    const root = document.createElement('div');
    document.body.append(root);
    expect(patchGlobalSearch(root, buildSearchModel(DOCUMENTS))).toBe(false);
    expect(root.innerHTML).toBe('');
  });
});
