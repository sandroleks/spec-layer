import { describe, expect, it } from 'vitest';
import { dtcgPathOf, dtcgSegments, foundationDtcg } from '../../src/index';
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
