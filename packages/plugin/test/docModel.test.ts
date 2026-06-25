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

  it('builds per-variant token blocks when variants are selected', () => {
    const specV = {
      ...spec,
      variantInstances: [
        { nodeId: 'n1', name: 'Filled', values: { Style: 'Filled' } },
        { nodeId: 'n2', name: 'Text', values: { Style: 'Text' } },
      ],
      tokens: [
        { part: 'Container', property: 'fill', token: 'color/bg/brand', conditions: { Style: ['Filled'] } },
        { part: 'Label', property: 'color', token: 'color/text', conditions: {} },
      ],
    } as unknown as IntermediateSpec;

    const model = buildDocModel(specV, null, new Set<SectionId>(['tokens']), new Set(['n1']));
    const tok = model.sections[0];
    expect(tok.kind).toBe('variantTokens');
    if (tok.kind === 'variantTokens') {
      expect(tok.variants).toHaveLength(1);
      expect(tok.variants[0].name).toBe('Style=Filled');
      const tokenNames = tok.variants[0].rows.map((r) => r[2]);
      expect(tokenNames).toContain('color/bg/brand'); // conditioned, matches Filled
      expect(tokenNames).toContain('color/text'); // unconditioned, applies to all
    }
  });

  it('shapes anatomy as a numbered diagram block carrying part + component ids', () => {
    const specA = {
      ...spec,
      anatomyComponentId: 'c:1',
      anatomy: [
        { id: 'p:1', name: 'Container', type: 'FRAME', nested: false },
        { id: 'p:2', name: 'Icon', type: 'INSTANCE', nested: true },
      ],
    } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']));
    const block = model.sections[0];
    expect(block.kind).toBe('anatomy');
    if (block.kind === 'anatomy') {
      expect(block.componentId).toBe('c:1');
      expect(block.parts).toEqual([
        { n: 1, name: 'Container', nested: false, id: 'p:1' },
        { n: 2, name: 'Icon', nested: true, id: 'p:2' },
      ]);
    }
  });

  it('falls back to a bullet list when anatomy has no component to screenshot', () => {
    const specA = { ...spec, anatomyComponentId: '', anatomy: [] } as unknown as IntermediateSpec;
    const model = buildDocModel(specA, null, new Set<SectionId>(['anatomy']));
    expect(model.sections[0].kind).toBe('bullets');
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
