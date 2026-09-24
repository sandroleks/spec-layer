import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  diffKeyed, formatFoundationValue, formatTextMetrics, foundationChangeGroups, componentChangeGroups,
  axisModel, coverConditions, describeScope, comboKey,
} from '../src/diff';
import { extract, specHashProjection } from '../src/index';
import type { FoundationGlyph, FoundationUnitContent, FoundationValue, FoundationVariableRow, FoundationTextRow } from '../src/foundation';
import type { SpecHashProjection } from '../src/hash';
import type { ChangeGroup, ChangeItem } from '../src/diff';

/** A group literal: strings are scope-less items, objects carry a scope line. */
const G = (label: string, ...items: (string | ChangeItem)[]): ChangeGroup =>
  ({ label, items: items.map((item) => (typeof item === 'string' ? { text: item } : item)) });

interface Item { id: string; value: number }
const byId = (item: Item) => item.id;

describe('diffKeyed', () => {
  it('returns empty lists and no reorder for two empty lists', () => {
    expect(diffKeyed([], [], byId)).toEqual({ added: [], removed: [], changed: [], reordered: false });
  });

  it('reports added items in after order and removed items in before order', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }];
    const after: Item[] = [{ id: 'z', value: 9 }, { id: 'b', value: 2 }, { id: 'y', value: 8 }];
    const d = diffKeyed(before, after, byId);
    expect(d.added.map(byId)).toEqual(['z', 'y']);
    expect(d.removed.map(byId)).toEqual(['a', 'c']);
    expect(d.changed).toEqual([]);
    expect(d.reordered).toBe(false);
  });

  it('reports a changed item with its before and after, in after order', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    const after: Item[] = [{ id: 'b', value: 20 }, { id: 'a', value: 10 }];
    const d = diffKeyed(before, after, byId);
    expect(d.changed).toEqual([
      { before: { id: 'b', value: 2 }, after: { id: 'b', value: 20 } },
      { before: { id: 'a', value: 1 }, after: { id: 'a', value: 10 } },
    ]);
    // A change list is not a reorder even though the order also moved.
    expect(d.reordered).toBe(false);
  });

  it('flags a pure reorder and nothing else', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    const after: Item[] = [{ id: 'b', value: 2 }, { id: 'a', value: 1 }];
    expect(diffKeyed(before, after, byId)).toEqual({ added: [], removed: [], changed: [], reordered: true });
  });

  it('does not flag a reorder when the lists are identical', () => {
    const list: Item[] = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    expect(diffKeyed(list, [...list], byId).reordered).toBe(false);
  });

  it('compares equal keys by canonical serialization: key order and undefined do not count', () => {
    const before = [{ id: 'a', x: 1, y: 2 }];
    const after = [{ id: 'a', y: 2, x: 1, z: undefined }];
    expect(diffKeyed(before, after, (i) => i.id).changed).toEqual([]);
  });

  it('pairs duplicate keys positionally and reports surplus as added or removed, never merged', () => {
    const before: Item[] = [{ id: 'a', value: 1 }, { id: 'a', value: 2 }, { id: 'a', value: 3 }];
    const after: Item[] = [{ id: 'a', value: 1 }, { id: 'a', value: 20 }];
    const d = diffKeyed(before, after, byId);
    expect(d.changed).toEqual([{ before: { id: 'a', value: 2 }, after: { id: 'a', value: 20 } }]);
    expect(d.removed).toEqual([{ id: 'a', value: 3 }]);
    expect(d.added).toEqual([]);

    const grown = diffKeyed(after, before, byId);
    expect(grown.added).toEqual([{ id: 'a', value: 3 }]);
    expect(grown.removed).toEqual([]);
  });

  it('accepts a custom equality', () => {
    const before: Item[] = [{ id: 'a', value: 1 }];
    const after: Item[] = [{ id: 'a', value: 2 }];
    expect(diffKeyed(before, after, byId, () => true).changed).toEqual([]);
    expect(diffKeyed(before, after, byId, (x, y) => x.value === y.value).changed).toHaveLength(1);
  });

  it('works on plain strings keyed by themselves', () => {
    const d = diffKeyed(['hover', 'focus'], ['focus', 'disabled'], (s) => s);
    expect(d.added).toEqual(['disabled']);
    expect(d.removed).toEqual(['hover']);
  });
});

const BLUE: FoundationValue = { kind: 'color', hex: '#0055FF', alpha: 1 };
const BLUE_2: FoundationValue = { kind: 'color', hex: '#0044EE', alpha: 1 };

function colorRow(name: string, light: FoundationValue, dark: FoundationValue, description = ''): FoundationVariableRow {
  return {
    kind: 'variable', name, description, resolvedType: 'COLOR', codeSyntax: {}, glyph: null,
    cells: [{ modeName: 'Light', value: light }, { modeName: 'Dark', value: dark }],
  };
}

function unit(rows: FoundationUnitContent['rows'], overrides: Partial<FoundationUnitContent> = {}): FoundationUnitContent {
  return { collectionName: 'Semantic', modeNames: ['Light', 'Dark'], rows, omittedModeNames: [], ...overrides };
}

describe('formatFoundationValue', () => {
  it('renders each value kind without inventing anything', () => {
    expect(formatFoundationValue(BLUE)).toBe('#0055FF');
    expect(formatFoundationValue({ kind: 'color', hex: '#0055FF', alpha: 0.8 })).toBe('#0055FF at 80%');
    expect(formatFoundationValue({ kind: 'number', value: 12 })).toBe('12');
    expect(formatFoundationValue({ kind: 'string', value: 'Inter' })).toBe('Inter');
    expect(formatFoundationValue({ kind: 'boolean', value: false })).toBe('false');
    expect(formatFoundationValue({
      kind: 'alias', targetName: 'blue/500', targetCollection: 'Primitives', external: false, resolved: BLUE,
    })).toBe('{Primitives/blue/500} resolving to #0055FF');
    expect(formatFoundationValue({
      kind: 'alias', targetName: 'blue/500', targetCollection: 'Brand Kit', external: true, resolved: null,
    })).toBe('{Brand Kit/blue/500}');
    expect(formatFoundationValue({ kind: 'unresolved', reason: 'missing' })).toBe('unresolved (missing)');
  });
});

const TEXT_BASE = {
  fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32, lineHeight: { unit: 'PIXELS', value: 40 },
  letterSpacing: { unit: 'PIXELS', value: 0 }, paragraphSpacing: 0,
  textCase: 'ORIGINAL', textDecoration: 'NONE', boundTokens: {},
} as const;

describe('formatTextMetrics', () => {
  it('renders the whole metrics line, omitting default case and decoration', () => {
    expect(formatTextMetrics({ ...TEXT_BASE })).toBe('Inter Bold 32/40, letter spacing 0, paragraph spacing 0px');
    expect(formatTextMetrics({ ...TEXT_BASE, lineHeight: { unit: 'PERCENT', value: 125 } }))
      .toBe('Inter Bold 32/125%, letter spacing 0, paragraph spacing 0px');
    expect(formatTextMetrics({ ...TEXT_BASE, lineHeight: { unit: 'AUTO' } }))
      .toBe('Inter Bold 32/auto, letter spacing 0, paragraph spacing 0px');
    expect(formatTextMetrics({ ...TEXT_BASE, letterSpacing: { unit: 'PERCENT', value: 2 }, paragraphSpacing: 16, textCase: 'UPPER', textDecoration: 'UNDERLINE' }))
      .toBe('Inter Bold 32/40, letter spacing 2%, paragraph spacing 16px, upper, underline');
  });
});

describe('foundationChangeGroups', () => {
  it('returns no groups when nothing differs', () => {
    const a = unit([colorRow('color/brand/500', BLUE, BLUE)]);
    expect(foundationChangeGroups(a, unit([colorRow('color/brand/500', BLUE, BLUE)]))).toEqual([]);
  });

  it('itemizes a changed cell by mode with before and after', () => {
    const before = unit([colorRow('color/brand/500', BLUE, BLUE)]);
    const after = unit([colorRow('color/brand/500', BLUE_2, BLUE)]);
    expect(foundationChangeGroups(before, after)).toEqual([
      G('Tokens', 'color/brand/500 in Light: #0055FF changed to #0044EE'),
    ]);
  });

  it('reports added and removed rows by name', () => {
    const before = unit([colorRow('color/brand/500', BLUE, BLUE), colorRow('color/brand/700', BLUE, BLUE)]);
    const after = unit([colorRow('color/brand/500', BLUE, BLUE), colorRow('color/brand/600', BLUE, BLUE)]);
    expect(foundationChangeGroups(before, after)).toEqual([
      G('Tokens', 'color/brand/600 added', 'color/brand/700 removed'),
    ]);
  });

  it('reports a changed type as one item and does not itemize its cells', () => {
    const before = unit([colorRow('size/base', BLUE, BLUE)]);
    const afterRow: FoundationVariableRow = {
      kind: 'variable', name: 'size/base', description: '', resolvedType: 'FLOAT', codeSyntax: {}, glyph: null,
      cells: [{ modeName: 'Light', value: { kind: 'number', value: 4 } }, { modeName: 'Dark', value: { kind: 'number', value: 4 } }],
    };
    expect(foundationChangeGroups(before, unit([afterRow]))).toEqual([
      G('Tokens', 'size/base: type color changed to number'),
    ]);
  });

  it('reports a variable turned text style as a changed type', () => {
    const before = unit([colorRow('heading/lg', BLUE, BLUE)]);
    const text: FoundationTextRow = {
      kind: 'textStyle', name: 'heading/lg', description: '',
      metrics: {
        fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32, lineHeight: { unit: 'PIXELS', value: 40 },
        letterSpacing: { unit: 'PIXELS', value: 0 }, paragraphSpacing: 0,
        textCase: 'ORIGINAL', textDecoration: 'NONE', boundTokens: {},
      },
    };
    expect(foundationChangeGroups(before, unit([text]))).toEqual([
      G('Tokens', 'heading/lg: type color changed to text style'),
    ]);
  });

  it('names every variable type the way Figma does, not by its API enum', () => {
    const row = (resolvedType: FoundationVariableRow['resolvedType'], value: FoundationVariableRow['cells'][number]['value']): FoundationVariableRow => ({
      kind: 'variable', name: 'x', description: '', resolvedType, codeSyntax: {}, glyph: null,
      cells: [{ modeName: 'Light', value }, { modeName: 'Dark', value }],
    });
    const str = row('STRING', { kind: 'string', value: 'a' });
    const bool = row('BOOLEAN', { kind: 'boolean', value: true });
    expect(foundationChangeGroups(unit([str]), unit([bool]))).toEqual([
      G('Tokens', 'x: type string changed to boolean'),
    ]);
  });

  it('reports changed text metrics as one item', () => {
    const metrics = {
      fontFamily: 'Inter', fontStyle: 'Bold', fontSize: 32, lineHeight: { unit: 'PIXELS' as const, value: 40 },
      letterSpacing: { unit: 'PIXELS' as const, value: 0 }, paragraphSpacing: 0,
      textCase: 'ORIGINAL', textDecoration: 'NONE', boundTokens: {},
    };
    const before = unit([{ kind: 'textStyle', name: 'heading/lg', description: '', metrics }], { collectionName: '', modeNames: [] });
    const after = unit([{ kind: 'textStyle', name: 'heading/lg', description: '', metrics: { ...metrics, fontSize: 36 } }], { collectionName: '', modeNames: [] });
    expect(foundationChangeGroups(before, after)).toEqual([
      G('Tokens', 'heading/lg: Inter Bold 32/40, letter spacing 0, paragraph spacing 0px changed to Inter Bold 36/40, letter spacing 0, paragraph spacing 0px'),
    ]);
  });

  it('puts a description change in its own group without a token item', () => {
    const before = unit([colorRow('color/brand/500', BLUE, BLUE, 'Old')]);
    const after = unit([colorRow('color/brand/500', BLUE, BLUE, 'New')]);
    expect(foundationChangeGroups(before, after)).toEqual([
      G('Descriptions', 'Description of color/brand/500 changed'),
    ]);
  });

  it('reports mode changes, including modes left out, under Modes', () => {
    const before = unit([], { modeNames: ['Light'], omittedModeNames: ['Dark'] });
    const after = unit([], { modeNames: ['Light', 'Dark'], omittedModeNames: [] });
    expect(foundationChangeGroups(before, after)).toEqual([
      G('Modes', 'Mode Dark added', 'Mode Dark is no longer left out'),
    ]);
  });

  it('reports a pure mode reorder as one line', () => {
    const before = unit([], { modeNames: ['Light', 'Dark'] });
    const after = unit([], { modeNames: ['Dark', 'Light'] });
    expect(foundationChangeGroups(before, after)).toEqual([
      G('Modes', 'Order changed, values unchanged'),
    ]);
  });

  it('reports collection name, group and part numbering under Part', () => {
    const before = unit([], { collectionName: 'Core', group: 'color', part: { index: 0, total: 2 } });
    const after = unit([], { collectionName: 'Primitives', group: 'colour', part: { index: 0, total: 3 } });
    expect(foundationChangeGroups(before, after)).toEqual([
      G('Part',
        'Collection: Core changed to Primitives',
        'Group: color changed to colour',
        'Part: 1 of 2 changed to 1 of 3',
      ),
    ]);
    expect(foundationChangeGroups(unit([]), unit([], { group: 'color', part: { index: 1, total: 2 } }))).toEqual([
      G('Part', 'Group added: color', 'Part added: 2 of 2'),
    ]);
  });

  it('keeps groups in the fixed order Tokens, Descriptions, Modes, Part', () => {
    const before = unit([colorRow('a', BLUE, BLUE, 'x')], { modeNames: ['Light', 'Dark'], collectionName: 'Core' });
    const after = unit([colorRow('a', BLUE_2, BLUE, 'y')], { modeNames: ['Light'], collectionName: 'Base' });
    expect(foundationChangeGroups(before, after).map((g) => g.label)).toEqual(['Tokens', 'Descriptions', 'Modes', 'Part']);
  });

  it('treats a projection missing its lists as empty rather than throwing', () => {
    const partial = { collectionName: 'Semantic', modeNames: ['Light'] } as unknown as FoundationUnitContent;
    expect(foundationChangeGroups(partial, unit([colorRow('a', BLUE, BLUE)], { modeNames: ['Light'] })))
      .toEqual([G('Tokens', 'a added')]);
  });
});

describe('foundationChangeGroups — Plan 3 fields', () => {
  const base = {
    kind: 'variable' as const, description: '', resolvedType: 'FLOAT' as const,
    glyph: null as FoundationGlyph | null, codeSyntax: {} as Record<string, string>,
  };
  const number = (name: string, value: number, extra: Partial<typeof base> = {}) => ({
    ...base, ...extra, name, cells: [{ modeName: 'Light', value: { kind: 'number' as const, value } }],
  });

  it('names a reference name that was added, changed or removed', () => {
    const before = unit([number('space/4', 16)], { modeNames: ['Light'] });
    const after = unit([number('space/4', 16, { codeSyntax: { WEB: '--space-4' } })], { modeNames: ['Light'] });
    expect(foundationChangeGroups(before, after)).toEqual([
      G('Tokens', 'space/4: WEB reference name added (--space-4)'),
    ]);
    const renamed = unit([number('space/4', 16, { codeSyntax: { WEB: '--gap-4' } })], { modeNames: ['Light'] });
    expect(foundationChangeGroups(after, renamed)).toEqual([
      G('Tokens', 'space/4: WEB reference name --space-4 changed to --gap-4'),
    ]);
    expect(foundationChangeGroups(after, before)).toEqual([
      G('Tokens', 'space/4: WEB reference name removed (--space-4)'),
    ]);
  });

  it('names a glyph change', () => {
    const before = unit([number('space/4', 16)], { modeNames: ['Light'] });
    const after = unit([number('space/4', 16, { glyph: 'bar' })], { modeNames: ['Light'] });
    expect(foundationChangeGroups(before, after)).toEqual([
      G('Tokens', 'space/4: now drawn as a bar'),
    ]);
    expect(foundationChangeGroups(after, before)).toEqual([
      G('Tokens', 'space/4: no longer drawn to scale'),
    ]);
  });

  it('reports a pre-Plan-3 baseline as one layout item, so the badge never has an empty list', () => {
    const old = unit([{ kind: 'variable', name: 'space/4', description: '', resolvedType: 'FLOAT',
      cells: [{ modeName: 'Light', value: { kind: 'number', value: 16 } }] } as never], { modeNames: ['Light'] });
    const now = unit([number('space/4', 16)], { modeNames: ['Light'] });
    expect(foundationChangeGroups(old, now)).toEqual([
      G('Layout', 'Updating adds reference names and scale drawings to this doc'),
    ]);
  });
});

function projection(overrides: Partial<SpecHashProjection> = {}): SpecHashProjection {
  return {
    name: 'Button',
    figmaKey: 'key-1',
    figmaFile: 'FILE1',
    figmaNode: '1:1',
    description: '',
    anatomyComponentId: '1:2',
    anatomy: [{ id: '1:3', name: 'Label', type: 'TEXT', nested: false }],
    props: [{ name: 'Size', kind: 'variant', options: ['Small', 'Medium'], default: 'Small' }],
    variants: [{ prop: 'Size', values: ['Small', 'Medium'] }],
    variantInstances: [{ nodeId: '1:2', name: 'Size=Small', values: { Size: 'Small' } }],
    states: ['default', 'hover'],
    tokens: [{ part: 'Label', property: 'fill', conditions: {}, token: 'color.primary' }],
    related: ['Icon'],
    gaps: [{ part: 'Label', property: 'padding', issue: 'hardcoded-value', value: 8 }],
    layout: [{ part: 'Container', summary: 'horizontal, gap 8' }],
    ...overrides,
  };
}

describe('componentChangeGroups', () => {
  it('returns no groups when nothing differs', () => {
    expect(componentChangeGroups(projection(), projection())).toEqual([]);
  });

  it('explains an identity-only change so an otherwise empty list still explains the badge', () => {
    expect(componentChangeGroups(projection(), projection({ figmaNode: '9:9' }))).toEqual([
      G('Name', 'Source identity changed'),
    ]);
    expect(componentChangeGroups(projection(), projection({ name: 'Button v2', anatomyComponentId: '2:2' }))).toEqual([
      G('Name', 'Name: Button changed to Button v2', 'Source identity changed'),
    ]);
  });

  it('itemizes a description added, changed and removed, under Name', () => {
    expect(componentChangeGroups(projection(), projection({ description: 'Primary action.' }))).toEqual([
      G('Name', 'Description added: Primary action.'),
    ]);
    expect(componentChangeGroups(
      projection({ description: 'Primary action.' }),
      projection({ description: 'Confirms the action.' }),
    )).toEqual([
      G('Name', 'Description: Primary action. changed to Confirms the action.'),
    ]);
    expect(componentChangeGroups(projection({ description: 'Primary action.' }), projection())).toEqual([
      G('Name', 'Description removed: Primary action.'),
    ]);
  });

  it('itemizes property additions, removals and field changes', () => {
    const after = projection({
      props: [
        { name: 'Size', kind: 'variant', options: ['Small', 'Medium', 'Large'], default: 'Medium' },
        { name: 'Description', kind: 'text' },
      ],
    });
    expect(componentChangeGroups(projection(), after)).toEqual([
      G('Properties',
        'Property Description added',
        'Property Size: values Small, Medium changed to Small, Medium, Large',
        'Property Size: default Small changed to Medium',
      ),
    ]);
    expect(componentChangeGroups(projection(), projection({ props: [] }))).toEqual([
      G('Properties', 'Property Size removed'),
    ]);
    expect(componentChangeGroups(projection(), projection({
      props: [{ name: 'Size', kind: 'text', options: ['Small', 'Medium'], default: 'Small' }],
    }))).toEqual([
      G('Properties', 'Property Size: type variant changed to text'),
    ]);
  });

  it('itemizes variant axes and variant instances under Variants', () => {
    const after = projection({
      variants: [{ prop: 'Size', values: ['Small', 'Medium', 'Large'] }, { prop: 'State', values: ['Default'] }],
      variantInstances: [
        { nodeId: '1:2', name: 'Size=Small, State=Default', values: { Size: 'Small', State: 'Default' } },
        { nodeId: '1:9', name: 'Size=Large, State=Default', values: { Size: 'Large', State: 'Default' } },
      ],
    });
    expect(componentChangeGroups(projection(), after)).toEqual([
      G('Variants',
        'Variant property State added',
        'Variant property Size: values Small, Medium changed to Small, Medium, Large',
        'Variant Size=Large, State=Default added',
        'Variant Size=Small renamed to Size=Small, State=Default',
        'Variant Size=Small, State=Default: values Size=Small changed to Size=Small, State=Default',
      ),
    ]);
  });

  it('itemizes anatomy parts by id, with Figma layer types in lowercase', () => {
    const after = projection({
      anatomy: [
        { id: '1:3', name: 'Text', type: 'INSTANCE', nested: true },
        { id: '1:4', name: 'Icon', type: 'INSTANCE', nested: true },
      ],
    });
    // `nested` follows the type (INSTANCE), so the type line is the only one.
    expect(componentChangeGroups(projection(), after)).toEqual([
      G('Anatomy',
        'Part Icon added',
        'Part Label renamed to Text',
        'Part Text: type text changed to instance',
      ),
    ]);
    const boolean = projection({ anatomy: [{ id: '1:3', name: 'Label', type: 'BOOLEAN_OPERATION', nested: false }] });
    expect(componentChangeGroups(projection(), boolean)).toEqual([
      G('Anatomy', 'Part Label: type text changed to boolean operation'),
    ]);
  });

  it('names an instance swap property type in Figma words', () => {
    expect(componentChangeGroups(projection(), projection({
      props: [{ name: 'Size', kind: 'instanceSwap', options: ['Small', 'Medium'], default: 'Small' }],
    }))).toEqual([
      G('Properties', 'Property Size: type variant changed to instance swap'),
    ]);
  });

  it('treats states and related as sets', () => {
    expect(componentChangeGroups(projection(), projection({ states: ['default', 'disabled'], related: [] }))).toEqual([
      G('States', 'State disabled added', 'State hover removed'),
      G('Related', 'Related Icon removed'),
    ]);
    expect(componentChangeGroups(projection(), projection({ states: ['hover', 'default'] }))).toEqual([
      G('States', 'Order changed, values unchanged'),
    ]);
  });

  /**
   * Token items are per-variant bindings, not minimized rules. A rule's
   * conditions are recomputed over the whole variant grid, so one rebound fill
   * splits a general rule into several specific ones; keyed by conditions, that
   * read as "1 removed, 3 added" for a single edit. Expanding both sides over
   * their variant instances and diffing cell by cell reports the edit once, with
   * the variants it reaches on a second scope line.
   */
  describe('tokens', () => {
    const bools = ['False', 'True'];
    const sizes = ['Small', 'Large'];
    function grid(): SpecHashProjection['variantInstances'] {
      const out: SpecHashProjection['variantInstances'] = [];
      let i = 0;
      for (const size of sizes) for (const hover of bools) for (const disabled of bools) {
        out.push({ nodeId: `v${i++}`, name: `size=${size}, hover=${hover}, disabled=${disabled}`, values: { size, hover, disabled } });
      }
      return out;
    }
    const axes = [{ prop: 'size', values: sizes }, { prop: 'hover', values: bools }, { prop: 'disabled', values: bools }];
    const props: SpecHashProjection['props'] = [
      { name: 'size', kind: 'variant', options: sizes, default: 'Small' },
      { name: 'hover', kind: 'variant', options: bools, default: 'False' },
      { name: 'disabled', kind: 'variant', options: bools, default: 'False' },
    ];
    const rule = (conditions: Record<string, string[]>, token: string, part = 'Container', property = 'fill') =>
      ({ part, property, conditions, token });
    const set = (tokens: SpecHashProjection['tokens'], overrides: Partial<SpecHashProjection> = {}) =>
      projection({ props, variants: axes, variantInstances: grid(), tokens, ...overrides });
    const base = () => set([
      rule({ hover: ['False'], disabled: ['False'] }, 'color/surface/primary/default'),
      rule({ hover: ['True'] }, 'color/surface/primary/hover'),
      rule({ hover: ['False'], disabled: ['True'] }, 'color/surface/disabled'),
    ]);

    it('reports one rebound variant as one item scoped to that variant, not as rules added and removed', () => {
      const after = set([
        rule({ size: ['Small'], hover: ['False'], disabled: ['False'] }, 'color/surface/primary/default'),
        rule({ hover: ['True'] }, 'color/surface/primary/hover'),
        rule({ hover: ['False'], disabled: ['True'] }, 'color/surface/disabled'),
        rule({ size: ['Large'], hover: ['False'], disabled: ['False'] }, 'colors/gray/1000'),
      ]);
      expect(componentChangeGroups(base(), after)).toEqual([
        G('Tokens', {
          text: 'Container / fill: color/surface/primary/default changed to colors/gray/1000',
          scope: '1 of 8 variants: size Large · others at default',
        }),
      ]);
    });

    it('scopes each movement to the variants it reached and drops the scope when every variant moved', () => {
      const after = set([
        rule({ hover: ['False'], disabled: ['False'] }, 'brand/default'),
        rule({ hover: ['True'] }, 'brand/hover'),
        rule({ hover: ['False'], disabled: ['True'] }, 'brand/disabled'),
      ]);
      expect(componentChangeGroups(base(), after)).toEqual([
        G('Tokens',
          { text: 'Container / fill: color/surface/primary/default changed to brand/default', scope: '2 of 8 variants: hover, disabled False' },
          { text: 'Container / fill: color/surface/disabled changed to brand/disabled', scope: '2 of 8 variants: hover False · disabled True' },
          { text: 'Container / fill: color/surface/primary/hover changed to brand/hover', scope: '4 of 8 variants: hover True' },
        ),
      ]);
      const before = set([rule({}, 'a')]);
      expect(componentChangeGroups(before, set([rule({}, 'b')]))).toEqual([
        G('Tokens', 'Container / fill: a changed to b'),
      ]);
    });

    it('names the default variant, lists several values with "or", and covers a non-rectangular set with more than one item', () => {
      const before = set([rule({}, 'a')]);
      const onlyDefault = set([rule({ size: ['Small'], hover: ['False'], disabled: ['False'] }, 'b'), rule({ size: ['Large'] }, 'a'),
        rule({ hover: ['True'] }, 'a'), rule({ disabled: ['True'] }, 'a')]);
      expect(componentChangeGroups(before, onlyDefault)).toEqual([
        G('Tokens', { text: 'Container / fill: a changed to b', scope: '1 of 8 variants: the default variant' }),
      ]);
      // Small+hover and Large+default is not one product of axis values, so it
      // takes two items; either alone would name a variant that did not change.
      const after = set([
        rule({ size: ['Small'], hover: ['False'] }, 'a'),
        rule({ size: ['Small'], hover: ['True'] }, 'b'),
        rule({ size: ['Large'], hover: ['True'] }, 'a'),
        rule({ size: ['Large'], hover: ['False'], disabled: ['True'] }, 'a'),
        rule({ size: ['Large'], hover: ['False'], disabled: ['False'] }, 'b'),
      ]);
      expect(componentChangeGroups(before, after)).toEqual([
        G('Tokens',
          { text: 'Container / fill: a changed to b', scope: '2 of 8 variants: size Small · hover True' },
          { text: 'Container / fill: a changed to b', scope: '1 of 8 variants: size Large · others at default' },
        ),
      ]);
      const orAfter = set([rule({ disabled: ['False'] }, 'a'), rule({ disabled: ['True'] }, 'b')]);
      expect(componentChangeGroups(before, orAfter)).toEqual([
        G('Tokens', { text: 'Container / fill: a changed to b', scope: '4 of 8 variants: disabled True' }),
      ]);
      const wide = projection({ props: [], variants: [{ prop: 'size', values: ['S', 'M', 'L'] }],
        variantInstances: ['S', 'M', 'L'].map((size, i) => ({ nodeId: `v${i}`, name: `size=${size}`, values: { size } })),
        tokens: [rule({ size: ['S', 'M'] }, 'b'), rule({ size: ['L'] }, 'a')] });
      const wideBefore = { ...wide, tokens: [rule({}, 'a')] };
      expect(componentChangeGroups(wideBefore, wide)).toEqual([
        G('Tokens', { text: 'Container / fill: a changed to b', scope: '2 of 3 variants: size S or M' }),
      ]);
    });

    it('spells out an axis with no recorded default and collapses defaults only when two or more are pinned', () => {
      const before = set([rule({}, 'a')], { props: [] });
      const after = set([rule({ size: ['Small'], hover: ['False'], disabled: ['False'] }, 'b'), rule({ size: ['Large'] }, 'a'),
        rule({ hover: ['True'] }, 'a'), rule({ disabled: ['True'] }, 'a')], { props: [] });
      expect(componentChangeGroups(before, after)).toEqual([
        G('Tokens', { text: 'Container / fill: a changed to b', scope: '1 of 8 variants: size Small · hover, disabled False' }),
      ]);
      const onePinned = set([rule({ size: ['Large'], disabled: ['False'] }, 'b'), rule({ size: ['Small'] }, 'a'), rule({ disabled: ['True'] }, 'a')]);
      expect(componentChangeGroups(set([rule({}, 'a')]), onePinned)).toEqual([
        G('Tokens', { text: 'Container / fill: a changed to b', scope: '2 of 8 variants: size Large · disabled False' }),
      ]);
    });

    it('compares a cell as a set of distinct tokens and reports only the tokens that moved', () => {
      // Two rules resolve the same token for one variant: not two bindings.
      const before = set([rule({ hover: ['True'] }, 'icon'), rule({ disabled: ['True'] }, 'icon'), rule({}, 'stroke')]);
      const after = set([rule({ hover: ['True'] }, 'press'), rule({ disabled: ['True'] }, 'press'), rule({}, 'stroke')]);
      // hover True or disabled True is a union of two products, so two items,
      // each with the count its own conditions select; the overlap is counted in both.
      expect(componentChangeGroups(before, after)).toEqual([
        G('Tokens',
          { text: 'Container / fill: icon changed to press', scope: '4 of 8 variants: disabled True' },
          { text: 'Container / fill: icon changed to press', scope: '4 of 8 variants: hover True' },
        ),
      ]);
    });

    it('says when a cell gained or lost a token beside ones it kept', () => {
      const before = set([rule({}, 'a')]);
      expect(componentChangeGroups(before, set([rule({}, 'a'), rule({ size: ['Large'] }, 'b')]))).toEqual([
        G('Tokens', { text: 'Container / fill: also bound to b', scope: '4 of 8 variants: size Large' }),
      ]);
      expect(componentChangeGroups(set([rule({}, 'a'), rule({}, 'b')]), set([rule({}, 'a')]))).toEqual([
        G('Tokens', 'Container / fill: no longer bound to b'),
      ]);
    });

    it('reads a cell that lost its only token the same as one that lost one of several, as one line', () => {
      // Small loses its only token and Large loses one of two: the same fact,
      // so one bucket over every variant and no scope line.
      const before = set([rule({}, 'a'), rule({ size: ['Large'] }, 'b')]);
      expect(componentChangeGroups(before, set([rule({ size: ['Large'] }, 'b')]))).toEqual([
        G('Tokens', 'Container / fill: no longer bound to a'),
      ]);
    });

    it('carries the token on newly bound and unbound lines alike', () => {
      const before = set([rule({}, 'a'), rule({ size: ['Large'] }, 'space/2', 'Label', 'padding')]);
      const after = set([rule({ size: ['Small'] }, 'a'), rule({}, 'radius/md', 'Container', 'radius')]);
      expect(componentChangeGroups(before, after)).toEqual([
        G('Tokens',
          { text: 'Container / fill: no longer bound to a', scope: '4 of 8 variants: size Large' },
          'Container / radius: bound to radius/md',
          { text: 'Label / padding: no longer bound to space/2', scope: '4 of 8 variants: size Large' },
        ),
      ]);
    });

    it('does not repeat a variant that was added or removed under Tokens', () => {
      const before = base();
      const after = base();
      after.variantInstances = after.variantInstances.slice(0, 4);
      after.variants = [{ prop: 'size', values: ['Small'] }, ...axes.slice(1)];
      expect(componentChangeGroups(before, after).map((g) => g.label)).toEqual(['Variants']);
    });

    it('reports a plain component with no axes without a scope', () => {
      const single = [{ nodeId: '1:2', name: 'Button', values: {} }];
      const before = projection({ variants: [], variantInstances: single, tokens: [rule({}, 'a')] });
      const after = projection({ variants: [], variantInstances: single, tokens: [rule({}, 'b')] });
      expect(componentChangeGroups(before, after)).toEqual([G('Tokens', 'Container / fill: a changed to b')]);
    });

    it('falls back to rule identity when a side has no variant instances, and still names the removed token', () => {
      const before = projection({ variantInstances: [], tokens: [rule({ Size: ['Large'] }, 'a', 'Label')] });
      const after = projection({ variantInstances: [], tokens: [rule({ Size: ['Large'], State: ['Hover'] }, 'b', 'Label')] });
      expect(componentChangeGroups(before, after)).toEqual([
        G('Tokens',
          'Label / fill when Size is Large and State is Hover: bound to b',
          'Label / fill when Size is Large: no longer bound to a',
        ),
      ]);
    });

    it('reads one rebound fill as one scoped item end to end through the extractor', () => {
      const bind = (name: string) => ({ property: 'fill', id: `VariableID:${name}`, name, kind: 'variable' as const, remote: false });
      const set = (fillFor: (c: Record<string, string>) => string) => {
        let id = 0;
        const children = [];
        for (const size of sizes) for (const hover of bools) for (const disabled of bools) {
          const combo = { type: 'Primary', size, hover, disabled };
          children.push({
            id: `v${id++}`, name: `type=Primary, size=${size}, hover=${hover}, disabled=${disabled}`, type: 'COMPONENT', visible: true,
            children: [{ id: `n${id++}`, name: 'Container', type: 'FRAME', visible: true, bindings: [bind(fillFor(combo))] }],
          });
        }
        const propertyDefinitions = {
          type: { type: 'VARIANT' as const, defaultValue: 'Primary', variantOptions: ['Primary'] },
          size: { type: 'VARIANT' as const, defaultValue: 'Small', variantOptions: sizes },
          hover: { type: 'VARIANT' as const, defaultValue: 'False', variantOptions: bools },
          disabled: { type: 'VARIANT' as const, defaultValue: 'False', variantOptions: bools },
        };
        return { id: 'set', name: 'buttonPrimary', type: 'COMPONENT_SET', visible: true, propertyDefinitions, children };
      };
      const plain = (c: Record<string, string>) => c.hover === 'True' ? 'color/surface/primary/hover'
        : c.disabled === 'True' ? 'color/surface/disabled' : 'color/surface/primary/default';
      const before = specHashProjection(extract(set(plain), { figmaFile: 'F' }));
      const after = specHashProjection(extract(set((c) =>
        c.size === 'Large' && c.hover === 'False' && c.disabled === 'False' ? 'colors/gray/1000' : plain(c)), { figmaFile: 'F' }));
      expect(componentChangeGroups(before, after)).toEqual([
        G('Tokens', {
          text: 'Container / fill: color/surface/primary/default changed to colors/gray/1000',
          scope: '1 of 8 variants: size Large · others at default',
        }),
      ]);
    });
  });

  it('itemizes unbound values with their issue and value', () => {
    const after = projection({
      gaps: [
        { part: 'Label', property: 'padding', issue: 'hardcoded-value', value: 12 },
        { part: 'Container', property: 'fill', issue: 'hardcoded-color', value: '#FFFFFF' },
        { part: 'Icon', property: 'stroke', issue: 'missing-token-binding' },
      ],
    });
    expect(componentChangeGroups(projection(), after)).toEqual([
      G('Unbound values',
        'Container / fill (hardcoded color) added: #FFFFFF',
        'Icon / stroke (missing token binding) added',
        'Label / padding (hardcoded value): 8 changed to 12',
      ),
    ]);
  });

  it('itemizes layout by part', () => {
    const after = projection({
      layout: [{ part: 'Container', summary: 'vertical, gap 12' }, { part: 'Label', summary: 'hug' }],
    });
    expect(componentChangeGroups(projection(), after)).toEqual([
      G('Layout',
        'Layout of Label added: hug',
        'Layout of Container: horizontal, gap 8 changed to vertical, gap 12',
      ),
    ]);
  });

  it('keeps groups in the fixed order', () => {
    const after = projection({
      name: 'X', props: [], variants: [], anatomy: [], states: [], tokens: [], gaps: [], layout: [], related: [],
    });
    expect(componentChangeGroups(projection(), after).map((g) => g.label)).toEqual([
      'Name', 'Properties', 'Variants', 'Anatomy', 'States', 'Tokens', 'Unbound values', 'Layout', 'Related',
    ]);
  });

  it('treats a projection missing its lists as empty rather than throwing', () => {
    const partial = { name: 'Button', figmaKey: 'key-1', figmaFile: 'FILE1', figmaNode: '1:1', anatomyComponentId: '1:2' } as unknown as SpecHashProjection;
    const result = componentChangeGroups(partial, projection());
    expect(result.find((g) => g.label === 'States')).toEqual(G('States', 'State default added', 'State hover added'));
  });
});

/**
 * A structural guard, not a behavior test.
 *
 * `componentChangeGroups` itemizes a fixed set of fields per projection entry.
 * A field added to a projection entry later is invisible in the change list
 * until it is added to the diff too, and an invisible change is worse than no
 * change list at all: the panel would show "Source changed" over a list that
 * silently omits what moved. These assertions fail the moment a key set moves,
 * which is the prompt to decide whether the new field earns an item line.
 *
 * Keys are ordered with the default `.sort()` over ASCII identifiers, never
 * `localeCompare`, so the expectations do not depend on the machine's locale.
 */
describe('the projection key sets the diff itemizes', () => {
  const node = JSON.parse(readFileSync('packages/extractor/test/fixtures/button.json', 'utf8'));
  const projection = specHashProjection(extract(node, { figmaFile: 'FILE1' }));
  const lists = projection as unknown as Record<string, Array<Record<string, unknown>>>;
  const sortedKeys = (value: object): string[] => Object.keys(value).sort();

  it('pins the top-level projection keys, so a new one has to be routed into the diff', () => {
    expect(sortedKeys(projection)).toEqual([
      'anatomy', 'anatomyComponentId', 'description', 'figmaFile', 'figmaKey',
      'figmaNode', 'gaps', 'layout', 'name', 'props', 'related', 'states', 'tokens', 'variantInstances', 'variants',
    ]);
  });

  /** Required keys every entry carries, and the keys that are legitimately
   *  optional (absent on some entries of the same list). */
  const REQUIRED: Record<string, string[]> = {
    props: ['default', 'kind', 'name'],
    variants: ['prop', 'values'],
    variantInstances: ['name', 'nodeId', 'values'],
    anatomy: ['id', 'name', 'nested', 'type'],
    tokens: ['conditions', 'part', 'property', 'token'],
    gaps: ['issue', 'part', 'property'],
    layout: ['part', 'summary'],
  };
  const OPTIONAL: Record<string, string[]> = { props: ['options'], gaps: ['value'] };

  it('pins each itemized entry shape, so a new field on an entry has to be itemized too', () => {
    for (const [field, required] of Object.entries(REQUIRED)) {
      const entries = lists[field];
      // The guard is only meaningful over a populated list; the fixture
      // populates all seven, and this says so rather than passing vacuously.
      expect(Array.isArray(entries) && entries.length > 0, `${field} is empty in the fixture`).toBe(true);
      const allowed = [...required, ...(OPTIONAL[field] ?? [])].sort();
      // The first entry carries every documented key, optional ones included.
      expect(sortedKeys(entries[0]), field).toEqual(allowed);
      for (const entry of entries) {
        const keys = sortedKeys(entry);
        for (const key of required) expect(keys, field).toContain(key);
        for (const key of keys) expect(allowed, field).toContain(key);
      }
    }
  });
});

describe('exported scope helpers', () => {
  it('build an axis model from declared axes, cover a subset, and describe it', () => {
    const universe = [{ size: 'Small' }, { size: 'Large' }, { size: 'Huge' }];
    const axes = axisModel([{ prop: 'size', values: ['Small', 'Large', 'Huge', 'Unused'] }], universe);
    expect([...axes]).toEqual([['size', ['Small', 'Large', 'Huge']]]);
    const cover = coverConditions([{ size: 'Large' }, { size: 'Huge' }], universe, axes);
    expect(cover).toEqual([{ conditions: { size: ['Large', 'Huge'] }, count: 2 }]);
    expect(describeScope(cover[0].conditions, 2, 3, 1, new Map([['size', 'Small']]))).toBe('2 of 3 variants: size Large or Huge');
    expect(describeScope({}, 3, 3, 1, new Map())).toBeUndefined();
    expect(comboKey({ b: '1', a: '2' })).toBe(comboKey({ a: '2', b: '1' }));
  });

  it('covers a non-rectangular subset with the same two rules, in the same order (pin for the key cache)', () => {
    const universe = [
      { size: 'Small', tone: 'A' }, { size: 'Small', tone: 'B' },
      { size: 'Large', tone: 'A' }, { size: 'Large', tone: 'B' },
    ];
    const axes = axisModel([{ prop: 'size', values: ['Small', 'Large'] }, { prop: 'tone', values: ['A', 'B'] }], universe);
    // Greedy from Small/A: size frees (both tone A variants are in), tone
    // cannot; then from Small/B: tone frees. Overlap on Small/A is by design.
    expect(coverConditions([universe[0], universe[1], universe[2]], universe, axes)).toEqual([
      { conditions: { tone: ['A'] }, count: 2 },
      { conditions: { size: ['Small'] }, count: 2 },
    ]);
  });
});
