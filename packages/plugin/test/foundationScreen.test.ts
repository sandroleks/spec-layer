import { describe, expect, it } from 'vitest';
import type { FoundationSpec, FoundationSelection } from '@spec-layer/extractor';
import {
  foundationFooterMarkup,
  foundationHeaderMarkup,
  foundationScrollMarkup,
} from '../src/ui/screens/foundations';

const SPEC = {
  collections: [
    {
      id: 'colors',
      name: 'Mapped Colors',
      defaultModeId: 'light',
      modes: [
        { modeId: 'light', name: 'Light' },
        { modeId: 'dark', name: 'Dark' },
        { modeId: 'hc', name: 'High contrast' },
      ],
      variables: Array.from({ length: 12 }, (_, index) => ({
        id: `v${index}`,
        name: `Color ${index}`,
        resolvedType: 'COLOR',
        valuesByMode: {},
      })),
    },
    {
      id: 'density',
      name: 'Mapped Density',
      defaultModeId: 'comfortable',
      modes: [{ modeId: 'comfortable', name: 'Comfortable' }],
      variables: [],
    },
  ],
  textStyles: [{ id: 's1', name: 'Body' }, { id: 's2', name: 'Heading' }],
} as unknown as FoundationSpec;

const ALL: FoundationSelection = {
  collections: [
    { collectionId: 'colors', modeIds: ['light', 'dark', 'hc'] },
    { collectionId: 'density', modeIds: ['comfortable'] },
  ],
  textStyles: true,
};

describe('foundation screen', () => {
  it('uses the approved standalone page title', () => {
    expect(foundationHeaderMarkup()).toContain('Foundation documents');
    expect(foundationHeaderMarkup()).not.toContain('<p>');
  });

  it('renders a flat row for every source and the shared bulk control', () => {
    const markup = foundationScrollMarkup({ kind: 'ready' }, SPEC, ALL);
    expect(markup).toContain('3 of 3 included');
    expect(markup).toContain('Clear all');
    expect(markup).toContain('Mapped Colors');
    expect(markup).toContain('Mapped Density');
    expect(markup).toContain('Text styles');
    expect(markup).not.toContain('data-mode');
  });

  it('renders a mixed bulk state for a partial selection', () => {
    const partial = { collections: ALL.collections.slice(0, 1), textStyles: false };
    const markup = foundationScrollMarkup({ kind: 'ready' }, SPEC, partial);
    expect(markup).toContain('1 of 3 included');
    expect(markup).toContain('data-mixed="true"');
    expect(markup).toContain('Select all');
  });

  it('keeps create disabled until at least one source is selected', () => {
    const empty = { collections: [], textStyles: false };
    expect(foundationFooterMarkup({ kind: 'ready' }, SPEC, empty)).toContain('disabled');
    expect(foundationFooterMarkup({ kind: 'ready' }, SPEC, ALL)).not.toContain('disabled');
  });

  it('shows loading, real progress, and persistent read errors honestly', () => {
    expect(foundationScrollMarkup({ kind: 'loading' }, null, ALL)).toContain('Reading this file');
    expect(foundationScrollMarkup({ kind: 'loading' }, null, ALL)).toContain('sl-loading-row');
    expect(foundationScrollMarkup(
      { kind: 'generating', done: 1, total: 3, phase: 'Laying out the tables' },
      SPEC,
      ALL,
    )).toContain('Laying out the tables');
    expect(foundationScrollMarkup(
      { kind: 'result', created: 2, replaced: 1 },
      SPEC,
      ALL,
    )).not.toContain('sl-banner');
    expect(foundationScrollMarkup(
      { kind: 'error', message: 'Could not read this file.' },
      null,
      ALL,
    )).toContain('Could not read this file.');
  });
});
