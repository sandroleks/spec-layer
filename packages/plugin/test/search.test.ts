import { describe, expect, it } from 'vitest';
import { globalSearchMarkup } from '../src/ui/screens/search';
import {
  buildSearchModel,
  nextSearchIndex,
  type SearchDocument,
} from '../src/ui/viewModel/search';

const DOCUMENTS: SearchDocument[] = [
  {
    docId: 'buttonPrimary',
    label: 'Button / Primary',
    sourceLabel: 'Components · Buttons',
  },
  {
    docId: 'mappedColors',
    label: 'Mapped Colors',
    sourceLabel: 'Foundations · Colors',
  },
  {
    docId: 'inputField',
    label: 'Input field',
    sourceLabel: 'Forms · Inputs',
  },
  {
    docId: 'buttonText',
    label: 'Button / Text',
    sourceLabel: 'Components · Buttons',
  },
  {
    docId: 'radio',
    label: 'Radio',
    sourceLabel: 'Forms · Controls',
  },
];

describe('global search view model', () => {
  it('filters both workflow copy and connected Library identity copy', () => {
    const workflow = buildSearchModel(DOCUMENTS, 'current figma');
    expect(workflow.workflowResults.map((item) => item.view)).toEqual(['component']);
    expect(workflow.documentResults).toHaveLength(0);

    const document = buildSearchModel(DOCUMENTS, 'foundation');
    expect(document.workflowResults.map((item) => item.view)).toEqual(['foundations']);
    expect(document.documentResults.map((item) => item.docId)).toEqual(['mappedColors']);
  });

  it('uses current production workflow copy and real route ids', () => {
    const model = buildSearchModel(DOCUMENTS);
    expect(model.workflowResults.map(({ view, label, detail }) => ({
      view, label, detail,
    }))).toContainEqual({
      view: 'settings',
      label: 'Settings',
      detail: 'Generated frame appearance',
    });
    expect(model.workflowResults.some((item) => (
      (item.view as string) === 'subscription'
    ))).toBe(false);
  });

  it('shows four initial documents and up to eight after a focused query', () => {
    expect(buildSearchModel(DOCUMENTS).documentResults).toHaveLength(4);
    expect(buildSearchModel(DOCUMENTS, 'o').documentResults).toHaveLength(5);
  });

  it('assigns one continuous pointer index across grouped sections', () => {
    const model = buildSearchModel(DOCUMENTS, 'button', 99);
    expect(model.workflowResults.map((item) => item.index)).toEqual([]);
    expect(model.documentResults.map((item) => item.index)).toEqual([0, 1]);
    expect(model.activeIndex).toBe(1);

    const mixed = buildSearchModel(DOCUMENTS, 'library');
    expect(mixed.workflowResults[0]).toMatchObject({ view: 'library', index: 0 });
  });

  it('supports wrapping arrows and boundary navigation', () => {
    expect(nextSearchIndex(2, 'ArrowDown', 3)).toBe(0);
    expect(nextSearchIndex(0, 'ArrowUp', 3)).toBe(2);
    expect(nextSearchIndex(1, 'Home', 3)).toBe(0);
    expect(nextSearchIndex(1, 'End', 3)).toBe(2);
    expect(nextSearchIndex(8, 'ArrowDown', 0)).toBe(0);
  });
});

describe('global search presentation', () => {
  it('renders a modal combobox, grouped listbox, active pointer, and keyboard hints', () => {
    const markup = globalSearchMarkup(buildSearchModel(DOCUMENTS, '', 1));
    expect(markup).toContain('class="sl-global-search-layer" role="dialog" aria-modal="true"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('<h2 id="sl-global-search-workflows">Workflows</h2>');
    expect(markup).toContain('<h2 id="sl-global-search-library">Library</h2>');
    expect(markup).toContain(
      'aria-activedescendant="sl-global-search-result-1"',
    );
    expect(markup).toContain(
      'class="sl-global-search-result is-active" type="button" role="option" id="sl-global-search-result-1" aria-selected="true"',
    );
    expect(markup).toContain('<kbd>↑</kbd><kbd>↓</kbd> Navigate');
    expect(markup).toContain('<kbd>↵</kbd> Open');
    expect(markup).toContain('<kbd>Esc</kbd> Close');
  });

  it('exposes host-control hooks for query, pointer, activation, clearing, and closing', () => {
    const markup = globalSearchMarkup(buildSearchModel(DOCUMENTS, 'button'));
    expect(markup).toContain('data-global-search-dialog');
    expect(markup).toContain('data-global-search-input');
    expect(markup).toContain('data-search-index="0"');
    expect(markup).toContain('data-search-kind="document"');
    expect(markup).toContain('data-search-doc-id="buttonPrimary"');
    expect(markup.match(/data-search-clear/g)).toHaveLength(1);
    expect(markup.match(/data-search-close/g)).toHaveLength(2);
  });

  it('renders a useful empty state with no stale active descendant', () => {
    const markup = globalSearchMarkup(buildSearchModel(DOCUMENTS, 'no such result'));
    expect(markup).toContain('class="sl-global-search-empty"');
    expect(markup).toContain('No matches for “no such result”');
    expect(markup).toContain('Try a component, source, or workflow name.');
    expect(markup).toContain('data-search-clear');
    expect(markup).not.toContain('aria-activedescendant');
    expect(markup).not.toContain('role="option"');
  });

  it('shows an honest Library-loading state instead of a false empty result', () => {
    const model = buildSearchModel([], 'button');
    const markup = globalSearchMarkup(model, { libraryLoading: true });
    expect(markup).toContain('Checking connected documentation…');
    expect(markup).not.toContain('No matches for');
  });

  it('escapes query and Library content before placing them in HTML', () => {
    const unsafe = [{
      docId: '"><script>',
      label: '<Button & "Primary">',
      sourceLabel: 'Components > Actions',
    }];
    const markup = globalSearchMarkup(buildSearchModel(unsafe, '"<nope>'));
    expect(markup).toContain('value="&quot;&lt;nope&gt;"');
    expect(markup).toContain('No matches for “&quot;&lt;nope&gt;”');
    expect(markup).not.toContain('<script>');

    const resultMarkup = globalSearchMarkup(buildSearchModel(unsafe));
    expect(resultMarkup).toContain('&lt;Button &amp; &quot;Primary&quot;&gt;');
    expect(resultMarkup).toContain('data-search-doc-id="&quot;&gt;&lt;script&gt;"');
  });
});
