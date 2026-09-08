import { describe, expect, it } from 'vitest';
import { globalSearchMarkup } from '../src/ui/screens/search';
import {
  buildSearchModel,
  nextSearchIndex,
  type SearchDocument,
} from '../src/ui/viewModel/search';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-09-08T12:00:00Z');

const DOCUMENTS: SearchDocument[] = [
  {
    docId: 'buttonPrimary',
    kind: 'component',
    label: 'Button / Primary',
    sourceLabel: 'Components · Buttons',
    generatedAt: NOW - 3 * HOUR,
  },
  {
    docId: 'mappedColors',
    kind: 'foundation',
    label: 'Foundations · Mapped Colors',
    sourceLabel: 'Mapped Colors',
    generatedAt: NOW,
  },
  {
    docId: 'inputField',
    kind: 'component',
    label: 'Input field',
    sourceLabel: 'Forms · Inputs',
    generatedAt: NOW - HOUR,
  },
  {
    docId: 'buttonText',
    kind: 'component',
    label: 'Button / Text',
    sourceLabel: 'Components · Buttons',
    generatedAt: NOW - 200 * HOUR,
  },
  {
    docId: 'radio',
    kind: 'component',
    label: 'Radio',
    sourceLabel: 'Forms · Controls',
    generatedAt: NOW - 2 * HOUR,
  },
];

describe('global search view model', () => {
  it('lists recent component docs, newest first, before any query', () => {
    const model = buildSearchModel(DOCUMENTS);
    expect(model.recent).toBe(true);
    expect(model.results.map((item) => item.docId)).toEqual([
      'inputField',
      'radio',
      'buttonPrimary',
      'buttonText',
    ]);
  });

  it('offers no rail destinations, only connected documents', () => {
    const model = buildSearchModel(DOCUMENTS, 'settings');
    expect(model.results).toEqual([]);
    for (const query of ['', 'library', 'foundation docs', 'license']) {
      for (const result of buildSearchModel(DOCUMENTS, query).results) {
        expect(DOCUMENTS.map((doc) => doc.docId)).toContain(result.docId);
      }
    }
  });

  it('searches every connected document once a query is typed', () => {
    const model = buildSearchModel(DOCUMENTS, 'colors');
    expect(model.recent).toBe(false);
    expect(model.results.map((item) => item.docId)).toEqual(['mappedColors']);

    const bySource = buildSearchModel(DOCUMENTS, 'forms');
    expect(bySource.results.map((item) => item.docId)).toEqual([
      'inputField',
      'radio',
    ]);
  });

  it('keeps a typed query in registry order rather than by recency', () => {
    expect(buildSearchModel(DOCUMENTS, 'button').results.map((item) => item.docId))
      .toEqual(['buttonPrimary', 'buttonText']);
  });

  it('sorts a missing or invalid timestamp last instead of as brand new', () => {
    const undated: SearchDocument[] = [
      { ...DOCUMENTS[0], docId: 'undated', generatedAt: Number.NaN },
      DOCUMENTS[2],
    ];
    expect(buildSearchModel(undated).results.map((item) => item.docId))
      .toEqual(['inputField', 'undated']);
  });

  it('shows six recent components and up to eight query matches', () => {
    const many: SearchDocument[] = Array.from({ length: 12 }, (_, index) => ({
      docId: `component-${index}`,
      kind: 'component',
      label: `Component ${index}`,
      sourceLabel: 'Components',
      generatedAt: NOW - index * HOUR,
    }));
    expect(buildSearchModel(many).results).toHaveLength(6);
    expect(buildSearchModel(many, 'component').results).toHaveLength(8);
  });

  it('assigns a continuous pointer index and clamps the active one', () => {
    const model = buildSearchModel(DOCUMENTS, 'button', 99);
    expect(model.results.map((item) => item.index)).toEqual([0, 1]);
    expect(model.activeIndex).toBe(1);
    expect(buildSearchModel(DOCUMENTS, 'no such result').activeIndex).toBe(0);
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
  it('renders a modal combobox, listbox, active pointer, and keyboard hints', () => {
    const markup = globalSearchMarkup(buildSearchModel(DOCUMENTS, '', 1));
    expect(markup).toContain('class="sl-global-search-layer" role="dialog" aria-modal="true"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('<h2 id="sl-global-search-group">Recent components</h2>');
    expect(markup).not.toContain('Workflows');
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

  it('titles the group Library once the list is a query result', () => {
    const markup = globalSearchMarkup(buildSearchModel(DOCUMENTS, 'button'));
    expect(markup).toContain('<h2 id="sl-global-search-group">Library</h2>');
    expect(markup).not.toContain('Recent components');
  });

  it('keeps each row to one line: no tile, no chevron, no clear button', () => {
    const markup = globalSearchMarkup(buildSearchModel(DOCUMENTS));
    expect(markup).not.toContain('sl-global-search-icon');
    expect(markup).not.toContain('chevron');
    expect(markup).not.toContain('sl-global-search-clear');
    expect(markup).toContain('<span class="sl-global-search-label">Input field</span>');
    expect(markup).toContain('<span class="sl-global-search-source">Forms · Inputs</span>');
  });

  it('drops a source line that only repeats the name', () => {
    // "Foundations · Mapped Colors" over "Mapped Colors" printed the same
    // words twice on one row.
    const markup = globalSearchMarkup(buildSearchModel(DOCUMENTS, 'colors'));
    expect(markup).toContain('Foundations · Mapped Colors');
    expect(markup).not.toContain('sl-global-search-source');
  });

  it('exposes host-control hooks for query, pointer, activation, clearing, and closing', () => {
    const markup = globalSearchMarkup(buildSearchModel(DOCUMENTS, 'button'));
    expect(markup).toContain('data-global-search-dialog');
    expect(markup).toContain('data-global-search-input');
    expect(markup).toContain('data-search-index="0"');
    expect(markup).toContain('data-search-kind="component"');
    expect(markup).toContain('data-search-doc-id="buttonPrimary"');
    expect(markup).not.toContain('data-search-clear');
    expect(markup.match(/data-search-close/g)).toHaveLength(2);
  });

  it('marks a foundation document as one, not as a component', () => {
    const markup = globalSearchMarkup(buildSearchModel(DOCUMENTS, 'colors'));
    expect(markup).toContain('data-search-kind="foundation"');
    expect(markup).not.toContain('data-search-kind="component"');
  });

  it('renders a useful empty state with no stale active descendant', () => {
    const markup = globalSearchMarkup(buildSearchModel(DOCUMENTS, 'no such result'));
    expect(markup).toContain('class="sl-global-search-empty"');
    expect(markup).toContain('No matches for “no such result”');
    expect(markup).toContain('Try a component or source name.');
    expect(markup.match(/data-search-clear/g)).toHaveLength(1);
    expect(markup).not.toContain('aria-activedescendant');
    expect(markup).not.toContain('role="option"');
  });

  it('says nothing is documented yet rather than reporting no matches', () => {
    const foundationOnly = DOCUMENTS.filter((doc) => doc.kind === 'foundation');
    const markup = globalSearchMarkup(buildSearchModel(foundationOnly));
    expect(markup).toContain('No component docs yet');
    expect(markup).not.toContain('No matches for');
    expect(markup).not.toContain('data-search-clear');
  });

  it('shows an honest Library-loading state instead of a false empty result', () => {
    const markup = globalSearchMarkup(buildSearchModel([], 'button'), {
      libraryLoading: true,
    });
    expect(markup).toContain('Checking connected documentation…');
    expect(markup).not.toContain('No matches for');

    const beforeTyping = globalSearchMarkup(buildSearchModel([]), {
      libraryLoading: true,
    });
    expect(beforeTyping).toContain('Checking connected documentation…');
    expect(beforeTyping).not.toContain('No component docs yet');
  });

  it('escapes query and Library content before placing them in HTML', () => {
    const unsafe: SearchDocument[] = [{
      docId: '"><script>',
      kind: 'component',
      label: '<Button & "Primary">',
      sourceLabel: 'Components > Actions',
      generatedAt: NOW,
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
