import { describe, expect, it } from 'vitest';
import {
  dtcgExportFiles, dtcgPathOf, dtcgSegments, foundationDtcg, foundationDtcgDocument,
} from '../../src/index';
import { leaf, syntheticArtifact } from './dtcgFixture';

describe('dtcgSegments', () => {
  it('splits on slash and keeps casing', () => {
    expect(dtcgSegments('Background/Chip/Chip (Hover)').segments)
      .toEqual(['Background', 'Chip', 'Chip (Hover)']);
  });
  it('splits a dotted segment into groups and notes it', () => {
    const out = dtcgSegments('md.sys.color/primary');
    expect(out.segments).toEqual(['md', 'sys', 'color', 'primary']);
    expect(out.notes).toEqual([{ code: 'segment_split', original: 'md.sys.color' }]);
  });
  it('escapes braces, a leading dollar, and empty segments', () => {
    const out = dtcgSegments('$a/{b}//c');
    expect(out.segments).toEqual(['_$a', '_b_', '_', 'c']);
    expect(out.notes.map((n) => n.code)).toEqual(['name_escaped', 'name_escaped', 'name_escaped']);
  });
  it('joins a path with the collection at the head', () => {
    expect(dtcgPathOf('Mapped Colors', 'color/surface/primary')).toBe('Mapped Colors.color.surface.primary');
  });
});

describe('foundationDtcg files and literals', () => {
  const out = foundationDtcg(syntheticArtifact());

  it('writes one file per collection and mode, named by slug, rooted at the collection', () => {
    expect(Object.keys(out.files).sort()).toEqual([
      'primitives.dark.json', 'primitives.light-2.json', 'primitives.light.json',
      'semantic.dark.json', 'semantic.light.json',
      'styles.effects.json', 'styles.typography.json',
    ]);
    expect(Object.keys(out.files['primitives.light.json'])).toEqual(['Primitives']);
  });

  it('emits standard 2025.10 colors with exact components and the hex', () => {
    const red = leaf(out.files['primitives.light.json'], 'Primitives.color.exact.red');
    expect(red).toEqual({
      $type: 'color',
      $value: { colorSpace: 'srgb', components: [1, 0, 0], alpha: 1, hex: '#ff0000' },
      $description: 'Exactly representable source channels.',
    });
    const teal = leaf(out.files['primitives.light.json'], 'Primitives.color.lossy.teal');
    expect(teal?.$value).toEqual({
      colorSpace: 'srgb', components: [0.5001, 0.1001, 0.0001], alpha: 0.125, hex: '#801a00',
    });
  });

  it('emits dimensions as value and unit objects, font weight by scope, and bare numbers otherwise', () => {
    expect(leaf(out.files['primitives.light.json'], 'Primitives.spacing.gap')?.$value)
      .toEqual({ value: 8, unit: 'px' });
    const weight = leaf(out.files['primitives.light.json'], 'Primitives.typography.weight.strong');
    expect(weight?.$type).toBe('fontWeight');
    expect(weight?.$value).toBe(600);
    const n = leaf(out.files['primitives.light.json'], 'Primitives.number.unknown-scope');
    expect(n).toMatchObject({ $type: 'number', $value: 1.5 });
  });

  it('emits font families as fontFamily strings', () => {
    expect(leaf(out.files['primitives.light.json'], 'Primitives.typography.family.body'))
      .toMatchObject({ $type: 'fontFamily', $value: 'Inter' });
  });

  it('omits boolean tokens and reports them once per token', () => {
    const boolToken = syntheticArtifact().tokens.find((t) => t.type === 'boolean');
    if (!boolToken) throw new Error('fixture lost its boolean token');
    const path = dtcgPathOf('Primitives', boolToken.name);
    expect(leaf(out.files['primitives.light.json'], path)).toBeUndefined();
    // The fixture also carries a string-typed token ("string/declared-missing"),
    // which legitimately produces its own `type_not_expressible` entry, so this
    // scopes to the boolean token's own entry rather than asserting on the
    // report's total length.
    const entries = out.report.filter((r) => r.code === 'type_not_expressible' && r.details.id === boolToken.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ severity: 'warning', path });
    expect(entries[0].details).toMatchObject({ type: 'boolean', id: boolToken.id });
  });

  it('legacy values are the string forms', () => {
    const legacy = foundationDtcg(syntheticArtifact(), { values: 'legacy' });
    expect(leaf(legacy.files['primitives.light.json'], 'Primitives.color.exact.red')?.$value).toBe('#ff0000');
    expect(leaf(legacy.files['primitives.light.json'], 'Primitives.color.lossy.teal')?.$value).toBe('#801a0020');
    expect(leaf(legacy.files['primitives.light.json'], 'Primitives.spacing.gap')?.$value).toBe('8px');
  });

  it('does not mutate the artifact', () => {
    const artifact = syntheticArtifact();
    const before = JSON.stringify(artifact);
    foundationDtcg(artifact);
    expect(JSON.stringify(artifact)).toBe(before);
  });
});

describe('foundationDtcg aliases and omissions', () => {
  const out = foundationDtcg(syntheticArtifact());

  it('writes a local alias as a reference to the target DTCG path', () => {
    const primary = leaf(out.files['semantic.dark.json'], 'Semantic.color.surface.primary');
    expect(primary).toMatchObject({ $type: 'color', $value: '{Primitives.color.chain.bridge}' });
  });

  it('reports the target path when an alias target was itself omitted', () => {
    const artifact = syntheticArtifact();
    const target = artifact.tokens.find((t) => t.id === 'VariableID:chain-bridge');
    if (!target) throw new Error('fixture lost the alias target Primitives.color.chain.bridge');
    // DTCG has no boolean type, so omitInexpressibleTypes drops this token
    // whole, which is what makes its dependent alias's target look up empty.
    target.type = 'boolean';
    const withOmittedTarget = foundationDtcg(artifact);
    expect(leaf(withOmittedTarget.files['semantic.dark.json'], 'Semantic.color.surface.primary')).toBeUndefined();
    expect(withOmittedTarget.report).toContainEqual(expect.objectContaining({
      code: 'value_omitted', severity: 'warning', path: 'Semantic.color.surface.primary', mode: 'Dark',
      details: expect.objectContaining({
        id: 'VariableID:chain-owner', reason: 'target_omitted', target_path: 'color/chain/bridge',
      }),
    }));
  });

  it('omits missing values and unresolved aliases with a reason, never a literal or a fake reference', () => {
    expect(leaf(out.files['primitives.light-2.json'], 'Primitives.color.shared')).toBeUndefined();
    expect(out.report).toContainEqual(expect.objectContaining({
      code: 'value_omitted', severity: 'warning', path: 'Primitives.color.shared',
      details: expect.objectContaining({ id: 'VariableID:local-collision', reason: 'no_value_for_mode' }),
    }));
    expect(leaf(out.files['semantic.light.json'], 'Semantic.color.legacy.readable')).toBeUndefined();
    expect(out.report).toContainEqual(expect.objectContaining({
      code: 'value_omitted', path: 'Semantic.color.legacy.readable', mode: 'Light',
      details: expect.objectContaining({
        reason: 'source_library_unavailable', source_library_name: 'Deprecated Core',
      }),
    }));
    expect(leaf(out.files['primitives.light.json'], 'Primitives.cycle.a')).toBeUndefined();
    expect(out.report).toContainEqual(expect.objectContaining({
      code: 'value_omitted', path: 'Primitives.cycle.a', details: expect.objectContaining({ reason: 'cycle' }),
    }));
    for (const text of Object.values(out.files).map((f) => JSON.stringify(f))) {
      expect(text).not.toContain('unresolved');
      expect(text).not.toContain('"$value":null');
    }
  });

  it('keeps the sidecar keyed by DTCG path with the stable id, scopes, and code syntax', () => {
    expect(out.meta['Primitives.color.exact.red']).toEqual({
      id: 'VariableID:color-exact', collection_id: 'CollectionID:primitives', type: 'color',
      scopes: ['FRAME_FILL'], code_syntax: { WEB: '--color-exact-red' },
    });
    const boolToken = syntheticArtifact().tokens.find((t) => t.type === 'boolean');
    if (!boolToken) throw new Error('fixture lost its boolean token');
    const omitted = out.meta[dtcgPathOf('Primitives', boolToken.name)];
    expect(omitted.omitted).toBe(true);
    expect(omitted.values).toEqual({
      'Light [ModeID:p-light]': true, Dark: false, 'Light [ModeID:p-light-duplicate]': true,
    });
  });

  it('promotes a scope-less number to a dimension only under a declared override', () => {
    const forced = foundationDtcg(syntheticArtifact(), { units: { 'Primitives/number/*': 'px' } });
    expect(leaf(forced.files['primitives.light.json'], 'Primitives.number.unknown-scope'))
      .toMatchObject({ $type: 'dimension', $value: { value: 1.5, unit: 'px' } });
    const conflicting = foundationDtcg(syntheticArtifact(), { units: { 'Primitives/typography/weight/*': 'px' } });
    expect(leaf(conflicting.files['primitives.light.json'], 'Primitives.typography.weight.strong')?.$type)
      .toBe('fontWeight');
    expect(conflicting.report).toContainEqual(expect.objectContaining({
      code: 'unit_override_conflicts_with_scope', path: 'Primitives.typography.weight.strong',
    }));
  });

  it('reports a code syntax identifier that two tokens share', () => {
    const artifact = syntheticArtifact();
    const [a, b] = artifact.tokens.filter((t) => t.type === 'color').slice(0, 2);
    a.code_syntax = { WEB: '--dup' };
    b.code_syntax = { WEB: '--dup' };
    const dup = foundationDtcg(artifact).report.filter((r) => r.code === 'duplicate_code_syntax');
    expect(dup).toHaveLength(2);
    expect(dup[0].details).toMatchObject({ platform: 'WEB', identifier: '--dup' });
  });
});

describe('foundationDtcg styles', () => {
  const out = foundationDtcg(syntheticArtifact());

  it('maps a text style to the typography composite with references for bound properties', () => {
    const body = leaf(out.files['styles.typography.json'], 'Typography styles.Body.Regular');
    expect(body?.$type).toBe('typography');
    expect(body?.$value).toEqual({
      fontFamily: '{Primitives.typography.family.body}',
      fontWeight: '{Primitives.typography.weight.strong}',
      fontSize: { value: 16, unit: 'px' },
      lineHeight: { value: 24, unit: 'px' },
    });
    expect(body?.$extensions).toEqual({
      'com.spec-layer': {
        letterSpacing: { value: 0, unit: '%' },
        paragraphSpacing: { value: 8, unit: 'px' },
        paragraphIndent: { value: 0, unit: 'px' },
        textCase: 'original',
        textDecoration: 'none',
      },
    });
    expect(body?.$description).toBe('Source style retained for Phase 3.');
    expect(out.report).toContainEqual(expect.objectContaining({
      code: 'unit_not_expressible', path: 'Typography styles.Body.Regular',
      details: expect.objectContaining({ property: 'letterSpacing', unit: '%' }),
    }));
  });

  it('maps an effect style to a shadow array of visible shadows, with every layer under extensions', () => {
    const card = leaf(out.files['styles.effects.json'], 'Effect styles.Shadow.Card');
    expect(card?.$type).toBe('shadow');
    expect(card?.$value).toEqual([{
      color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.2, hex: '#000000' },
      offsetX: { value: 0, unit: 'px' },
      offsetY: { value: 4, unit: 'px' },
      blur: '{Primitives.effect.shadow.blur}',
      spread: { value: 0, unit: 'px' },
      inset: false,
    }]);
    expect(card?.$extensions).toEqual({
      'com.spec-layer': {
        layers: [
          { index: 0, type: 'drop_shadow', visible: true, blend_mode: 'normal' },
          { index: 1, type: 'layer_blur', visible: false, blur: { value: 2, unit: 'px' } },
        ],
      },
    });
  });

  it('writes no style file when the artifact has no styles of that kind', () => {
    const artifact = syntheticArtifact();
    artifact.styles = { typography: [], effects: [] };
    const bare = foundationDtcg(artifact);
    expect(bare.files['styles.typography.json']).toBeUndefined();
    expect(bare.files['styles.effects.json']).toBeUndefined();
  });
});

describe('foundationDtcg resolver and document', () => {
  const artifact = syntheticArtifact();
  const out = foundationDtcg(artifact);

  it('models a multi-mode collection as a modifier and styles as sets, in artifact order', () => {
    expect(out.resolver.version).toBe('2025.10');
    expect(out.resolver.name).toBe('Synthetic Direct Foundation');
    expect(out.resolver.modifiers.Primitives).toEqual({
      contexts: {
        'Light [ModeID:p-light]': [{ $ref: 'primitives.light.json' }],
        Dark: [{ $ref: 'primitives.dark.json' }],
        'Light [ModeID:p-light-duplicate]': [{ $ref: 'primitives.light-2.json' }],
      },
      default: 'Light [ModeID:p-light]',
    });
    expect(out.resolver.modifiers.Semantic.default).toBe('Light');
    expect(out.resolver.sets['Typography styles']).toEqual({ sources: [{ $ref: 'styles.typography.json' }] });
    expect(out.resolver.resolutionOrder).toEqual([
      { $ref: '#/modifiers/Primitives' },
      { $ref: '#/modifiers/Semantic' },
      { $ref: '#/sets/Effect styles' },
      { $ref: '#/sets/Typography styles' },
    ]);
  });

  it('escapes JSON pointer characters in set and modifier names', () => {
    const renamed = syntheticArtifact();
    renamed.collections[1].name = 'a/b~c';
    const r = foundationDtcg(renamed).resolver;
    expect(r.resolutionOrder[1]).toEqual({ $ref: '#/modifiers/a~1b~0c' });
    expect(Object.keys(r.modifiers)).toContain('a/b~c');
  });

  it('puts generated group descriptions on the matching group', () => {
    const annotated = syntheticArtifact();
    annotated.guidelines = { origin: 'generated', group_descriptions: { Primitives: { color: 'Brand ramps.' } } };
    const files = foundationDtcg(annotated).files;
    expect(leaf(files['primitives.light.json'], 'Primitives.color')?.$description).toBe('Brand ramps.');
  });

  it('keeps annotating later groups after one folder is absent from a mode', () => {
    const annotated = syntheticArtifact();
    annotated.guidelines = {
      origin: 'generated',
      group_descriptions: { Primitives: { cycle: 'Cycles.', color: 'Brand ramps.' } },
    };
    const files = foundationDtcg(annotated).files;
    expect(leaf(files['primitives.light.json'], 'Primitives.color')?.$description).toBe('Brand ramps.');
    expect(leaf(files['primitives.light.json'], 'Primitives.cycle')).toBeUndefined();
  });

  it('builds one clipboard document with inline sources and a spec-layer extension', () => {
    const doc = foundationDtcgDocument(artifact);
    expect(doc.version).toBe('2025.10');
    expect(doc.modifiers.Primitives.contexts.Dark[0]).toHaveProperty('Primitives');
    expect(doc.sets['Typography styles'].sources[0]).toHaveProperty('Typography styles');
    const ext = doc.$extensions['com.spec-layer'];
    expect(ext.schema_version).toBe('5.1.0');
    expect(ext.content_hash).toBe(artifact.spec_layer.export.content_hash);
    expect(ext.source).toEqual({ provider: 'figma', file_name: 'Synthetic Direct Foundation' });
    expect(ext.completeness).toEqual(artifact.completeness);
    expect(ext.code_syntax['Primitives.color.exact.red']).toEqual({ WEB: '--color-exact-red' });
    expect(ext.report).toEqual(out.report);
  });

  it('serializes every file deterministically with a trailing newline', () => {
    const texts = dtcgExportFiles(out);
    expect(Object.keys(texts).sort()).toEqual([
      'primitives.dark.json', 'primitives.light-2.json', 'primitives.light.json', 'report.json',
      'resolver.json', 'semantic.dark.json', 'semantic.light.json', 'spec-layer.meta.json',
      'styles.effects.json', 'styles.typography.json',
    ]);
    for (const text of Object.values(texts)) expect(text.endsWith('\n')).toBe(true);
    expect(dtcgExportFiles(foundationDtcg(syntheticArtifact()))).toEqual(texts);
  });
});
