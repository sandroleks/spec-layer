import { describe, expect, it } from 'vitest';
import { loadingRowsMarkup, progressMarkup } from '../src/ui/screens/progress';

describe('shared progress presentation', () => {
  it('uses the original loader motion without inventing a percentage', () => {
    const markup = progressMarkup({
      label: 'Reading the component',
      detail: 'Inspecting variants and properties',
    });
    expect(markup).toContain('sl-work-spark');
    expect(markup).toContain('sl-work-dots');
    expect(markup).not.toContain('role="progressbar"');
  });

  it('shows real determinate counts with accessible values', () => {
    const markup = progressMarkup({
      label: 'Creating foundation frames',
      current: 2,
      total: 5,
    });
    expect(markup).toContain('aria-valuenow="2"');
    expect(markup).toContain('aria-valuemax="5"');
    expect(markup).toContain('style="width:40%"');
    expect(markup).toContain('2 of 5');
  });

  it('clamps counts and escapes host-provided copy', () => {
    const markup = progressMarkup({
      label: '<Building & placing>',
      current: 7,
      total: 3,
    });
    expect(markup).toContain('&lt;Building &amp; placing&gt;');
    expect(markup).toContain('aria-valuenow="3"');
    expect(markup).toContain('style="width:100%"');
  });

  it('renders stable skeleton rows for one-shot reads', () => {
    expect(loadingRowsMarkup(3).match(/class="sl-loading-row"/g)).toHaveLength(3);
  });
});
