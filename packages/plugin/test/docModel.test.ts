import { describe, it, expect } from 'vitest';
import { buildDocModel, type SectionId } from '../src/ui/docModel';
import type { IntermediateSpec } from '@spec-layer/extractor';

const spec = {
  name: 'Button', figmaKey: '', figmaFile: 'f', figmaNode: '1:1',
  anatomy: [{ name: 'Label', nested: false }],
  props: [{ name: 'Size', kind: 'variant', default: 'M', options: ['S','M'] }],
  variants: [{ prop: 'Style', values: ['Filled','Text'] }],
  states: ['Enabled','Hovered'],
  tokens: [{ part: 'Container', property: 'fill', token: 'color/bg', conditions: {} }],
  related: ['Icon'], gaps: [],
  layout: [], variantInstances: [],
} as unknown as IntermediateSpec;

const prose = { definition: 'A button.', accessibility: '- **Keyboard:** focusable', dos: ['Do A'], donts: ["Don't B"] };

describe('buildDocModel', () => {
  it('emits only selected sections, in canonical order', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['definition','variants']));
    expect(model.sections.map(s => s.id)).toEqual(['definition','variants']);
    expect(model.title).toBe('Button: Guidelines');
  });

  it('uses placeholder text for AI sections when prose is null', () => {
    const model = buildDocModel(spec, null, new Set<SectionId>(['definition']));
    const def = model.sections[0];
    expect(def.kind).toBe('prose');
    if (def.kind === 'prose') expect(def.text).toMatch(/To be written/);
  });

  it('shapes tokens as a table block', () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['tokens']));
    const tok = model.sections[0];
    expect(tok.kind).toBe('table');
    if (tok.kind === 'table') expect(tok.rows.length).toBeGreaterThan(0);
  });

  it("renders dos and donts with check/cross markers", () => {
    const model = buildDocModel(spec, prose, new Set<SectionId>(['dosDonts']));
    const block = model.sections[0];
    expect(block.kind).toBe('bullets');
    if (block.kind === 'bullets') {
      expect(block.items.some((i) => i.text.startsWith('✅'))).toBe(true);
      expect(block.items.some((i) => i.text.startsWith('❌'))).toBe(true);
    }
  });
});
