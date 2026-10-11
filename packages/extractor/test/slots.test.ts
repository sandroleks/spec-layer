import { describe, it, expect } from 'vitest';
import { separateSlotContent } from '../src/slots';
import { extract, extractAnatomy, validate } from '../src/index';
import type { SerializedNode } from '../src/tree';
import card from './fixtures/card-slots.json';
import button from './fixtures/button.json';

const root = card as SerializedNode;

describe('separateSlotContent', () => {
  it('empties every own slot and records what it held, visible layers only', () => {
    const { root: separated, defaultContent } = separateSlotContent(root);
    const small = separated.children![0];
    const content = small.children![1].children![0];
    expect(content.type).toBe('SLOT');
    expect('children' in content).toBe(false);
    expect(defaultContent.get('40:5')).toEqual([{ part: 'List', type: 'INSTANCE', component: 'List' }]);
    expect(defaultContent.get('40:7')).toEqual([{ part: 'Badge', type: 'INSTANCE', component: 'Badge' }]);
    expect(defaultContent.get('40:25')).toEqual([]);
  });

  it('leaves a slot inside a nested instance alone: its content is fixed content here', () => {
    const { root: separated, defaultContent } = separateSlotContent(root);
    const media = separated.children![0].children![4];
    expect(media.children![0].children!.map((c) => c.name)).toEqual(['Photo']);
    expect(defaultContent.has('I40:30;5:1')).toBe(false);
  });

  it('returns a component without slots as the same object, node for node', () => {
    const plain = button as SerializedNode;
    expect(separateSlotContent(plain).root).toBe(plain);
  });

  it('reports a preferred key with no name, and an unlinked slot once across variants', () => {
    expect(separateSlotContent(root).issues).toEqual([
      { kind: 'unresolved-slot-content', property: 'Content', key: 'synthetic-missing' },
      { kind: 'unlinked-slot', part: 'Footer', slotProperty: 'Footer#40:99' },
    ]);
  });
});

describe('a slotted component', () => {
  const spec = extract(root, { figmaFile: 'F' });

  it('documents each slot as one part linked to its property, never its default content', () => {
    expect(spec.anatomy.map((p) => [p.path, p.type, p.slot ?? null])).toEqual([
      ['Container/Title', 'TEXT', null],
      ['Container/Body', 'FRAME', null],
      ['Container/Body/Content', 'SLOT', 'Content'],
      ['Container/Actions', 'SLOT', 'Actions'],
      ['Container/Footer', 'SLOT', null],
      ['Container/Media', 'INSTANCE', null],
    ]);
    expect(spec.anatomy.find((p) => p.name === 'Footer')).toMatchObject({ shownBy: 'Show footer', defaultContent: [] });
  });

  it('keeps default content out of related, token rules and unbound values', () => {
    expect(spec.related).toEqual(['Media']);
    expect(spec.tokens.map((t) => t.name)).toEqual(['space/gap', 'radius/md']);
    expect(spec.gaps.some((g) => g.path.includes('List'))).toBe(false);
  });

  it('derives default content the same way when anatomy reads the tree directly', () => {
    expect(extractAnatomy(root).parts).toEqual(spec.anatomy);
  });

  it('carries the slot facts and the default variant content on the property', () => {
    // Empty by default leaves the component's own content in place (probed 2026-10-04).
    expect(spec.props.find((p) => p.name === 'Actions')).toEqual({
      name: 'Actions', kind: 'slot', default: undefined, slot: { preferred: [], emptyByDefault: true },
      defaultContent: [{ part: 'Badge', type: 'INSTANCE', component: 'Badge' }],
    });
    // The Content slot sits inside a wrapper, one level down, and still answers.
    expect(spec.props.find((p) => p.name === 'Content')?.defaultContent).toEqual([{ part: 'List', type: 'INSTANCE', component: 'List' }]);
  });

  it('reports slot issues through validate()', () => {
    const findings = validate(spec, new Map()).filter((f) => f.id !== 'unbound-value');
    expect(findings).toEqual([
      {
        id: 'unresolved-slot-content', severity: 'warning', property: 'Content',
        message: 'A preferred component for the Content slot (key synthetic-missing) is not in this file and no instance in the component shows it, so it is listed without a name.',
      },
      {
        id: 'unlinked-slot', severity: 'warning', path: 'Footer',
        message: 'This slot is linked to a property named Footer, which the component does not define, so it is documented without one.',
      },
    ]);
  });
});
