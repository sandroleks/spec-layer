import { describe, it, expect } from 'vitest';
import { modelToMarkdown } from '../src/ui/modelMarkdown';
import type { DocFrameModel, SectionBlock } from '../src/ui/docModel';

function model(sections: SectionBlock[], componentName = 'Button'): DocFrameModel {
  return { componentName, sections };
}

describe('modelToMarkdown', () => {
  it('emits an H1 title from the component name', () => {
    const md = modelToMarkdown(model([]));
    expect(md.startsWith('# Button\n')).toBe(true);
  });

  it('groups sections under their group heading in canonical order', () => {
    const md = modelToMarkdown(model([
      { id: 'definition', heading: 'Overview', kind: 'prose', text: 'A button.' },
      { id: 'anatomy', heading: 'Anatomy', kind: 'anatomy', componentId: 'c', parts: [], view: 'table', summary: null },
      { id: 'accessibility', heading: 'Semantics & Focus', kind: 'prose', text: 'Use a11y.' },
    ]));
    const iUsage = md.indexOf('## Usage');
    const iSpecs = md.indexOf('## Specifications');
    const iA11y = md.indexOf('## Accessibility');
    expect(iUsage).toBeGreaterThan(-1);
    expect(iSpecs).toBeGreaterThan(iUsage);
    expect(iA11y).toBeGreaterThan(iSpecs);
    expect(md).toContain('### Overview');
    expect(md).toContain('### Semantics & Focus');
  });

  it('renders prose sections as heading + text', () => {
    const md = modelToMarkdown(model([
      { id: 'definition', heading: 'Overview', kind: 'prose', text: 'A tappable control.' },
    ]));
    expect(md).toContain('### Overview\n\nA tappable control.');
  });

  it('renders bullets, reconstructing bold runs', () => {
    const md = modelToMarkdown(model([
      { id: 'dosDonts', heading: "Do's & Don'ts", kind: 'bullets', items: [
        { text: '✅ Do this', runs: [{ text: '✅ ' }, { text: 'Do', bold: true }, { text: ' this' }] },
        { text: '❌ Not that', runs: [{ text: '❌ Not that' }] },
      ] },
    ]));
    expect(md).toContain('- ✅ **Do** this');
    expect(md).toContain('- ❌ Not that');
  });

  it('renders a table with a header separator and escaped pipes', () => {
    const md = modelToMarkdown(model([
      { id: 'configuration', heading: 'Configuration', kind: 'table',
        columns: ['Name', 'Default'], rows: [['size', 'md'], ['label', 'a|b']] },
    ]));
    expect(md).toContain('| Name | Default |');
    expect(md).toContain('| --- | --- |');
    expect(md).toContain('| size | md |');
    expect(md).toContain('| label | a\\|b |');
  });

  it('renders variant token cards with a default marker and a sameAsDefault note', () => {
    const md = modelToMarkdown(model([
      { id: 'tokens', heading: 'Tokens used', kind: 'variantTokens', columns: ['Part', 'Property', 'Token'],
        variants: [
          { name: 'Primary', isDefault: true, nodeId: '1', sameAsDefault: 0,
            props: [{ name: 'Type', value: 'Primary' }],
            rows: [{ part: 'bg', property: 'fill', token: 'color/primary', unbound: false, diff: false }] },
          { name: 'Secondary', isDefault: false, nodeId: '2', sameAsDefault: 3,
            props: [{ name: 'Type', value: 'Secondary' }],
            rows: [{ part: 'bg', property: 'fill', token: 'color/secondary', unbound: false, diff: true }] },
        ] },
    ]));
    expect(md).toContain('#### Primary (default)');
    expect(md).toContain('Type=Primary');
    expect(md).toContain('| bg | fill | color/primary |');
    expect(md).toContain('#### Secondary');
    expect(md).toContain('3 properties identical to the default');
  });

  it('marks unbound (hardcoded) token rows', () => {
    const md = modelToMarkdown(model([
      { id: 'tokens', heading: 'Tokens used', kind: 'variantTokens', columns: ['Part', 'Property', 'Token'],
        variants: [
          { name: 'Primary', isDefault: true, nodeId: '1', sameAsDefault: 0,
            props: [],
            rows: [{ part: 'bg', property: 'fill', token: '#ff0000', unbound: true, diff: false }] },
        ] },
    ]));
    expect(md).toContain('#ff0000 (hardcoded)');
  });

  it('renders anatomy summary and a numbered parts list', () => {
    const md = modelToMarkdown(model([
      { id: 'anatomy', heading: 'Anatomy', kind: 'anatomy', componentId: 'c', view: 'both',
        summary: 'The button has three parts.',
        parts: [
          { n: 1, name: 'Container', nested: false, id: 'a', depth: 0, tokens: ['radius/md'], type: 'FRAME', description: 'Wraps everything.' },
          { n: 2, name: 'Icon', nested: true, id: 'b', depth: 0, component: 'IconButton', tokens: [], type: 'INSTANCE' },
        ] },
    ]));
    expect(md).toContain('The button has three parts.');
    expect(md).toContain('1. **Container** (frame) — Wraps everything.');
    expect(md).toContain('radius/md');
    expect(md).toContain('2. **Icon** (component: IconButton)');
  });

  it('renders measurements as a table from the tokens map', () => {
    const md = modelToMarkdown(model([
      { id: 'measurements', heading: 'Measurements', kind: 'measure', componentId: 'c', rootPart: 'Container',
        tokens: { 'Container padding': '8', 'Container gap': '4' }, views: ['padding', 'spacing'] },
    ]));
    expect(md).toContain('| Measurement | Value |');
    expect(md).toContain('| Container padding | 8 |');
    expect(md).toContain('| Container gap | 4 |');
  });

  it('renders a states matrix with the axis name as the first column and check marks', () => {
    const md = modelToMarkdown(model([
      { id: 'states', heading: 'States', kind: 'statesMatrix', axisName: 'Type',
        states: ['Default', 'Hover'],
        rows: [{ label: 'Primary', cells: ['1:1', null] }],
        capped: false },
    ]));
    expect(md).toContain('| Type | Default | Hover |');
    expect(md).toContain('| Primary | ✓ |  |');
  });

  it('renders a two-axis variants matrix with a summary and note', () => {
    const md = modelToMarkdown(model([
      { id: 'variants', heading: 'Variants', kind: 'variantsMatrix',
        summary: 'Two axes.', columns: ['Small', 'Large'],
        rows: [{ label: 'Primary', cells: ['1:1', null] }],
        capped: false, note: 'State held at Default.' },
    ]));
    expect(md).toContain('Two axes.');
    expect(md).toContain('| Variant | Small | Large |');
    expect(md).toContain('| Primary | ✓ |  |');
    expect(md).toContain('State held at Default.');
  });

  it('renders a single-axis variants matrix (columns=[""]) as a bullet list', () => {
    const md = modelToMarkdown(model([
      { id: 'variants', heading: 'Variants', kind: 'variantsMatrix',
        summary: null, columns: [''],
        rows: [{ label: 'Primary', cells: ['1:1'] }, { label: 'Ghost', cells: ['1:2'] }],
        capped: false, note: null },
    ]));
    expect(md).toContain('- Primary');
    expect(md).toContain('- Ghost');
    expect(md).not.toContain('| Variant |');
  });
});
