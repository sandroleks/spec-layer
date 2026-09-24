import { describe, expect, it } from 'vitest';
import {
  dtcgExportFiles, dtcgPathOf, dtcgSegments, foundationDtcg, foundationDtcgDocument,
  type DtcgExport, type DtcgJson, type FoundationArtifactV5, type TokenV5, type UnitEvidence,
  type UsageUnitMap,
} from '../../src/index';
import { leaf, radiusMismatchArtifact, syntheticArtifact } from './dtcgFixture';

/** Every dot-joined path a tree writes a `$type`/`$value` leaf at. Stops
 *  descending at the first such leaf: a group never itself holds one. */
function declaredPaths(tree: DtcgJson): Set<string> {
  const found = new Set<string>();
  const walk = (node: DtcgJson, path: string[]): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
    const record = node as Record<string, DtcgJson>;
    if ('$value' in record) { found.add(path.join('.')); return; }
    for (const [key, value] of Object.entries(record)) {
      if (!key.startsWith('$')) walk(value, [...path, key]);
    }
  };
  walk(tree, []);
  return found;
}

/** Every path a plain token leaf's `$value` references with `{path}`. A
 *  typography or effect leaf's `$value` is an object or array, never a bare
 *  ref string, so this only ever finds a plain token's own alias. */
function references(tree: DtcgJson): string[] {
  const refs: string[] = [];
  const walk = (node: DtcgJson): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
    const record = node as Record<string, DtcgJson>;
    if ('$value' in record) {
      const value = record.$value;
      if (typeof value === 'string') {
        const match = /^\{(.+)\}$/.exec(value);
        if (match) refs.push(match[1]);
      }
      return;
    }
    for (const [key, value] of Object.entries(record)) {
      if (!key.startsWith('$')) walk(value);
    }
  };
  walk(tree);
  return refs;
}

/** Every `{path}` string anywhere in a tree: plain token values, style
 *  composite members, and extension members alike. */
function everyReference(tree: DtcgJson): string[] {
  const refs: string[] = [];
  const walk = (node: DtcgJson): void => {
    if (typeof node === 'string') {
      const match = /^\{([^{}]+)\}$/.exec(node);
      if (match) refs.push(match[1]);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node !== null && typeof node === 'object') Object.values(node).forEach(walk);
  };
  walk(tree);
  return refs;
}

const sourceFiles = (sources: DtcgJson[]): string[] => sources.flatMap((s) =>
  (typeof s === 'object' && s !== null && !Array.isArray(s) && typeof s.$ref === 'string' ? [s.$ref] : []));

/**
 * Every reference in an export that does not resolve in every resolver
 * context. A reference resolves when the file it sits in declares the path,
 * or when another resolution entry declares it in every one of its
 * alternatives: a set's files, or each context of a modifier, since a
 * resolver may select any of them. A mode file's own modifier is never that
 * other entry, because its sibling mode files are never loaded beside it.
 */
function unresolvedReferences(out: DtcgExport): string[] {
  const entries: string[][][] = [
    ...Object.values(out.resolver.sets).map((set) => [sourceFiles(set.sources)]),
    ...Object.values(out.resolver.modifiers).map((m) => Object.values(m.contexts).map(sourceFiles)),
  ];
  const declared = new Map(Object.entries(out.files).map(([name, tree]) => [name, declaredPaths(tree)]));
  const failures: string[] = [];
  for (const [name, tree] of Object.entries(out.files)) {
    for (const ref of everyReference(tree)) {
      if (declared.get(name)?.has(ref)) continue;
      const resolves = entries.some((alternatives) =>
        !alternatives.some((files) => files.includes(name))
        && alternatives.every((files) => files.some((file) => declared.get(file)?.has(ref))));
      if (!resolves) failures.push(`${name} -> {${ref}}`);
    }
  }
  return failures;
}

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

  it('never lets a collection file take a name the export reserves', () => {
    const artifact = syntheticArtifact();
    artifact.collections[0].name = 'Styles';
    artifact.collections[0].modes[0].name = 'Typography';
    const clashing = foundationDtcg(artifact);
    expect(Object.keys(clashing.files)).toContain('styles.typography-2.json');
    expect(Object.keys(clashing.files['styles.typography-2.json'])).toEqual(['Styles']);
    // The style file is still the style file.
    expect(leaf(clashing.files['styles.typography.json'], 'Typography styles.Body.Regular')?.$type)
      .toBe('typography');
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
    // The mode is the resolver context label, not the raw display name: the
    // fixture has two modes named "Light" and only the second lacks a value.
    expect(out.report).toContainEqual(expect.objectContaining({
      code: 'value_omitted', severity: 'warning', path: 'Primitives.color.shared',
      mode: 'Light [ModeID:p-light-duplicate]',
      details: expect.objectContaining({ id: 'VariableID:local-collision', reason: 'no_value_for_mode' }),
    }));
    expect(leaf(out.files['primitives.light.json'], 'Primitives.color.shared')).toBeDefined();
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
      transform: {
        Dark: 'color', 'Light [ModeID:p-light-duplicate]': 'color', 'Light [ModeID:p-light]': 'color',
      },
    });
    const boolToken = syntheticArtifact().tokens.find((t) => t.type === 'boolean');
    if (!boolToken) throw new Error('fixture lost its boolean token');
    const omitted = out.meta[dtcgPathOf('Primitives', boolToken.name)];
    expect(omitted.omitted).toBe(true);
    expect(omitted.values).toEqual({
      'Light [ModeID:p-light]': true, Dark: false, 'Light [ModeID:p-light-duplicate]': true,
    });
  });

  it('still emits the reference when Figma resolved a hop through another mode', () => {
    const artifact = syntheticArtifact();
    const primitives = artifact.collections.find((c) => c.id === 'CollectionID:primitives');
    const dark = primitives?.modes.find((m) => m.id === 'ModeID:p-dark');
    if (!dark) throw new Error('fixture lost the Primitives Dark mode');
    // Now every Primitives mode is named "Light", so the hop Figma resolved
    // through no longer matches the consuming Semantic "Dark" mode by name.
    dark.name = 'Light';
    const renamed = foundationDtcg(artifact);
    expect(leaf(renamed.files['semantic.dark.json'], 'Semantic.color.surface.primary'))
      .toMatchObject({ $type: 'color', $value: '{Primitives.color.chain.bridge}' });
    expect(renamed.report).toContainEqual(expect.objectContaining({
      code: 'mode_selection_not_expressible', severity: 'info',
      path: 'Semantic.color.surface.primary', mode: 'Dark',
      details: expect.objectContaining({
        id: 'VariableID:chain-owner', target_id: 'VariableID:chain-bridge',
        // Both labels are the resolver's, not the raw display names, which now
        // collide inside Primitives.
        target_mode: 'Light [ModeID:p-dark]',
      }),
    }));
  });

  it('does not report mode selection for an alias into a single-mode collection', () => {
    const artifact = syntheticArtifact();
    const primitives = artifact.collections.find((c) => c.id === 'CollectionID:primitives');
    if (!primitives) throw new Error('fixture lost Primitives');
    // Collapse Primitives to one mode so every cross-collection hop lands on it.
    const keep = primitives.modes[0];
    primitives.modes = [keep];
    primitives.default_mode_id = keep.id;
    for (const token of artifact.tokens) {
      if (token.collection_id !== primitives.id) continue;
      token.values = { [keep.id]: token.values[keep.id] };
    }
    const out = foundationDtcg(artifact);
    expect(out.report.filter((r) => r.code === 'mode_selection_not_expressible')).toEqual([]);
    expect(leaf(out.files['semantic.dark.json'], 'Semantic.color.surface.primary')?.$value)
      .toBe('{Primitives.color.chain.bridge}');
  });

  it('keeps a sidecar entry for every token in a DTCG path collision', () => {
    const artifact = syntheticArtifact();
    const ids = ['VariableID:color-exact', 'VariableID:color-lossy'];
    for (const id of ids) {
      const token = artifact.tokens.find((t) => t.id === id);
      if (!token) throw new Error(`fixture lost ${id}`);
      token.name = 'color/twin';
    }
    const collided = foundationDtcg(artifact);
    for (const [name, file] of Object.entries(collided.files)) {
      expect(leaf(file, 'Primitives.color.twin'), name).toBeUndefined();
    }
    for (const id of ids) {
      expect(collided.report).toContainEqual(expect.objectContaining({
        code: 'path_collision', severity: 'error', path: 'Primitives.color.twin',
        details: expect.objectContaining({ id, ids }),
      }));
      // Keyed by path alone, one collider's record would overwrite the other's.
      const entry = collided.meta[`Primitives.color.twin [${id}]`];
      expect(entry, id).toBeDefined();
      expect(entry.id).toBe(id);
      expect(entry.omitted).toBe(true);
      expect(Object.keys(entry.values ?? {})).toEqual([
        'Light [ModeID:p-light]', 'Dark', 'Light [ModeID:p-light-duplicate]',
      ]);
    }
    expect(collided.meta['Primitives.color.twin']).toBeUndefined();
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

  it('gives an alias the projected type of the token it references', () => {
    // DTCG requires a referencing token's $type to equal the referenced token's,
    // so a unit override or a FONT_WEIGHT scope on the target must reach the alias.
    const aliasedToNumber = (): ReturnType<typeof syntheticArtifact> => {
      const artifact = syntheticArtifact();
      const gap = artifact.tokens.find((t) => t.id === 'VariableID:gap');
      if (!gap) throw new Error('fixture lost Primitives.spacing.gap');
      gap.values['ModeID:p-light'] = {
        kind: 'alias',
        reference: {
          target_id: 'VariableID:unknown-number',
          target_collection_id: 'CollectionID:primitives',
          target_path: ['number', 'unknown-scope'],
          external: false,
        },
        resolved: {
          status: 'resolved',
          value: { type: 'number', value: 1.5 },
          chain: [{ token_id: 'VariableID:unknown-number', mode_id: 'ModeID:p-light' }],
        },
      };
      return artifact;
    };

    const overridden = foundationDtcg(aliasedToNumber(), { units: { 'Primitives/number/*': 'px' } });
    expect(leaf(overridden.files['primitives.light.json'], 'Primitives.number.unknown-scope')?.$type)
      .toBe('dimension');
    expect(leaf(overridden.files['primitives.light.json'], 'Primitives.spacing.gap'))
      .toEqual({ $type: 'dimension', $value: '{Primitives.number.unknown-scope}' });

    // Same shape, but the target's type comes from its scope rather than an override.
    const scoped = aliasedToNumber();
    const gap = scoped.tokens.find((t) => t.id === 'VariableID:gap');
    const value = gap?.values['ModeID:p-light'];
    if (!gap || value?.kind !== 'alias') throw new Error('the alias mutation did not take');
    value.reference.target_id = 'VariableID:font-weight';
    value.reference.target_path = ['typography', 'weight', 'strong'];
    value.resolved = {
      status: 'resolved',
      value: { type: 'number', value: 600 },
      chain: [{ token_id: 'VariableID:font-weight', mode_id: 'ModeID:p-light' }],
    };
    expect(gap.scopes).not.toContain('FONT_WEIGHT');
    expect(leaf(foundationDtcg(scoped).files['primitives.light.json'], 'Primitives.spacing.gap'))
      .toEqual({ $type: 'fontWeight', $value: '{Primitives.typography.weight.strong}' });
  });

  it('reports a dimension token whose alias target is a number', () => {
    const out = foundationDtcg(radiusMismatchArtifact());

    const entry = out.report.find((r) => r.code === 'alias_type_mismatch');
    expect(entry).toBeDefined();
    expect(entry?.severity).toBe('error');
    expect(entry?.path).toBe('Radius.rd-sm');
    expect(entry?.details).toMatchObject({
      target: 'Foundation.radius.300',
      own_type: 'dimension',
      target_type: 'number',
    });
  });

  it('writes the resolved dimension when the alias target cannot carry the unit', () => {
    const out = foundationDtcg(radiusMismatchArtifact());
    const rdSm = leaf(out.files['radius.light.json'], 'Radius.rd-sm');

    expect(rdSm?.$type).toBe('dimension');
    expect(rdSm?.$value).toEqual({ value: 8, unit: 'px' });
    expect(String(rdSm?.$value)).not.toContain('{');
  });

  it('records a repaired leaf in the sidecar as its own literal rule, not as an alias', () => {
    // `transform` promises "the rule that produced this mode's $value", and
    // `resolved` is documented absent for a literal token because its value
    // is already in the file -- both would be false for rd-sm once the
    // reference is replaced by a literal, so neither may survive the repair.
    const out = foundationDtcg(radiusMismatchArtifact());
    const entry = out.meta['Radius.rd-sm'];
    expect(entry.transform).toEqual({ Light: 'dimension' });
    expect(entry.resolved).toBeUndefined();
  });

  it('stands down from the repair when usage evidence gives the alias target the same type', () => {
    // The production composition, which no test reached before: `pull` runs
    // usageUnits over the whole bundle and hands the result to foundationDtcg,
    // and on this very token pair Rule A reads rd-sm's own CORNER_RADIUS scope
    // as evidence for what it aliases. Foundation.radius.300 then projects as
    // a dimension of its own, terminalOwnType agrees with the alias owner's
    // type, and there is nothing left to report: the reference survives and
    // carries a real length. That is the better outcome, and it means a user
    // on this path will not find alias_type_mismatch in tokens/report.json.
    const derived: UsageUnitMap = new Map<string, UnitEvidence>([
      ['VariableID:unknown-number', {
        unit: 'px', via: 'alias-scope', source: 'Radius.rd-sm', reason: 'CORNER_RADIUS',
      }],
    ]);
    const out = foundationDtcg(radiusMismatchArtifact(), {}, derived);

    expect(out.report.find((r) => r.code === 'alias_type_mismatch')).toBeUndefined();
    expect(leaf(out.files['radius.light.json'], 'Radius.rd-sm'))
      .toEqual({ $type: 'dimension', $value: '{Foundation.radius.300}' });
    expect(leaf(out.files['foundation.light.json'], 'Foundation.radius.300'))
      .toEqual({ $type: 'dimension', $value: { value: 8, unit: 'px' } });
    // The derivation is disclosed, not silent.
    expect(out.report.find((r) => r.code === 'unit_derived_from_usage')?.path)
      .toBe('Foundation.radius.300');
  });

  it('still repairs when no usage evidence survives for the alias target', () => {
    // The other direction of the same composition. usageUnits returns no entry
    // for a token whose evidence its own guardrails vetoed (a component binds
    // something on the chain to a non-length property, or an OPACITY-scoped
    // token aliases it), and an empty map is exactly what foundationDtcg then
    // sees. The repair is the only thing standing between that and a
    // `dimension` reference to a bare number.
    const out = foundationDtcg(radiusMismatchArtifact(), {}, new Map());

    expect(out.report.find((r) => r.code === 'alias_type_mismatch')?.severity).toBe('error');
    expect(leaf(out.files['radius.light.json'], 'Radius.rd-sm'))
      .toEqual({ $type: 'dimension', $value: { value: 8, unit: 'px' } });
    expect(leaf(out.files['foundation.light.json'], 'Foundation.radius.300'))
      .toEqual({ $type: 'number', $value: 8 });
    expect(out.report.find((r) => r.code === 'unit_derived_from_usage')).toBeUndefined();
  });

  it('leaves a well-typed alias recorded as alias with its resolved value', () => {
    // The repair path must not swallow the ordinary case: an alias whose
    // type agrees with its target still records `transform: 'alias'` and a
    // `resolved` snapshot.
    const out = foundationDtcg(syntheticArtifact());
    const entry = out.meta['Semantic.color.surface.primary'];
    expect(entry.transform?.Dark).toBe('alias');
    expect(entry.resolved?.Dark).toBeDefined();
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

describe('a token whose DTCG path is also a group', () => {
  const GROUP = 'VariableID:color-exact';
  const LEAF = 'VariableID:color-lossy';

  /** `color/red` beside `color/red/dark`, with `first` listed before `second`. */
  const nested = (first: string, second: string) => {
    const artifact = syntheticArtifact();
    const group = artifact.tokens.find((t) => t.id === GROUP);
    const nestedLeaf = artifact.tokens.find((t) => t.id === LEAF);
    if (!group || !nestedLeaf) throw new Error('fixture lost the two Primitives colours');
    group.name = 'color/red';
    nestedLeaf.name = 'color/red/dark';
    const rest = artifact.tokens.filter((t) => t.id !== GROUP && t.id !== LEAF);
    const byId = (id: string) => (id === GROUP ? group : nestedLeaf);
    artifact.tokens = [byId(first), byId(second), ...rest];
    return artifact;
  };

  it('keeps the nested token and omits the one at the group path, in either order', () => {
    for (const [first, second] of [[GROUP, LEAF], [LEAF, GROUP]]) {
      const out = foundationDtcg(nested(first, second));
      for (const [name, file] of Object.entries(out.files)) {
        if (!name.startsWith('primitives.')) continue;
        expect(leaf(file, 'Primitives.color.red.dark')?.$type, `${first} first, ${name}`).toBe('color');
        expect(leaf(file, 'Primitives.color.red'), `${first} first, ${name}`).not.toHaveProperty('$value');
      }
      expect(out.report).toContainEqual(expect.objectContaining({
        code: 'path_collision', severity: 'error', path: 'Primitives.color.red',
        details: { id: GROUP, ids: [GROUP, LEAF], reason: 'group' },
      }));
      expect(out.meta['Primitives.color.red']).toMatchObject({ id: GROUP, omitted: true });
      expect(out.meta['Primitives.color.red.dark']).toMatchObject({ id: LEAF });
      expect(out.meta['Primitives.color.red.dark'].omitted).toBeUndefined();
    }
  });

  it('projects both token orders to identical bytes', () => {
    expect(dtcgExportFiles(foundationDtcg(nested(GROUP, LEAF))))
      .toEqual(dtcgExportFiles(foundationDtcg(nested(LEAF, GROUP))));
  });

  it('does not treat a token as a group when everything beneath it was omitted', () => {
    const artifact = nested(GROUP, LEAF);
    const dark = artifact.tokens.find((t) => t.id === LEAF);
    if (!dark) throw new Error('fixture lost color/red/dark');
    dark.type = 'string';
    for (const modeId of Object.keys(dark.values)) {
      dark.values[modeId] = { kind: 'literal', value: { type: 'string', value: 'x' } };
    }
    const out = foundationDtcg(artifact);
    expect(leaf(out.files['primitives.light.json'], 'Primitives.color.red')?.$type).toBe('color');
    expect(out.report.filter((r) => r.code === 'path_collision')).toEqual([]);
  });

  it('omits a style whose path is a group of other styles, in either order', () => {
    const grouped = (groupFirst: boolean) => {
      const artifact = syntheticArtifact();
      const regular = artifact.styles.typography[0]; // Body/Regular
      const body = { ...structuredClone(regular), id: 'StyleID:body', name: 'Body', path: ['Body'] };
      artifact.styles.typography = groupFirst ? [body, regular] : [regular, body];
      return artifact;
    };
    for (const groupFirst of [true, false]) {
      const out = foundationDtcg(grouped(groupFirst));
      const file = out.files['styles.typography.json'];
      expect(leaf(file, 'Typography styles.Body.Regular')?.$type, `group first: ${groupFirst}`).toBe('typography');
      expect(leaf(file, 'Typography styles.Body'), `group first: ${groupFirst}`).not.toHaveProperty('$value');
      expect(out.report.filter((r) => r.code === 'path_collision')).toEqual([
        expect.objectContaining({
          path: 'Typography styles.Body', details: { id: 'StyleID:body', reason: 'group' },
        }),
      ]);
    }
    expect(dtcgExportFiles(foundationDtcg(grouped(true))))
      .toEqual(dtcgExportFiles(foundationDtcg(grouped(false))));
  });
});

describe('an alias whose reference chain ends in an omitted token', () => {
  /** `color/chain/terminal` renamed to `color/chain`, a group over its own
   *  two-hop-deep dependents `color/chain/middle` and `color/chain/bridge`:
   *  the reviewer's reproduction for Task 1's group-conflict fix. */
  const chainGroupConflict = (): ReturnType<typeof syntheticArtifact> => {
    const artifact = syntheticArtifact();
    const terminal = artifact.tokens.find((t) => t.id === 'VariableID:chain-terminal');
    if (!terminal) throw new Error('fixture lost color/chain/terminal');
    terminal.name = 'color/chain';
    return artifact;
  };

  it('omits a token two hops from a group conflict, reports it target_omitted, and writes no dangling reference', () => {
    const out = chainGroupConflict();
    const exported = foundationDtcg(out);

    expect(exported.meta['Primitives.color.chain.middle'])
      .toMatchObject({ id: 'VariableID:chain-middle', omitted: true });
    expect(exported.meta['Primitives.color.chain.bridge'])
      .toMatchObject({ id: 'VariableID:chain-bridge', omitted: true });

    for (const id of ['VariableID:chain-middle', 'VariableID:chain-bridge']) {
      const reports = exported.report.filter((r) => r.code === 'value_omitted' && r.details.id === id);
      expect(reports.length, id).toBeGreaterThan(0);
      for (const r of reports) expect(r.details.reason, id).toBe('target_omitted');
    }

    // Every reference any token file writes resolves to a path some token
    // file actually declares -- middle and bridge are both gone, so nothing
    // may still point at them.
    const tokenFiles = Object.entries(exported.files).filter(([name]) => !name.startsWith('styles.'));
    const declared = new Set<string>();
    for (const [, tree] of tokenFiles) for (const path of declaredPaths(tree)) declared.add(path);
    expect(declared.has('Primitives.color.chain.middle')).toBe(false);
    expect(declared.has('Primitives.color.chain.bridge')).toBe(false);
    for (const [name, tree] of tokenFiles) {
      for (const ref of references(tree)) expect(declared.has(ref), `${name} references ${ref}`).toBe(true);
    }
  });

  it('projects a dead alias chain the same regardless of token order', () => {
    const reordered = (): ReturnType<typeof syntheticArtifact> => {
      const artifact = chainGroupConflict();
      artifact.tokens = [...artifact.tokens].reverse();
      return artifact;
    };
    expect(dtcgExportFiles(foundationDtcg(chainGroupConflict())))
      .toEqual(dtcgExportFiles(foundationDtcg(reordered())));
  });

  it('propagates a dead alias chain across a collection boundary', () => {
    const artifact = chainGroupConflict();
    const owner = artifact.tokens.find((t) => t.id === 'VariableID:chain-owner');
    if (!owner) throw new Error('fixture lost color/surface/primary');
    // Both modes now alias the doomed Primitives chain; no literal fallback
    // is left to keep this Semantic token alive.
    owner.values['ModeID:s-light'] = owner.values['ModeID:s-dark'];
    const out = foundationDtcg(artifact);

    expect(out.meta['Semantic.color.surface.primary'])
      .toMatchObject({ id: 'VariableID:chain-owner', omitted: true });
    for (const [name, file] of Object.entries(out.files)) {
      expect(leaf(file, 'Semantic.color.surface.primary'), name).toBeUndefined();
    }
    const reports = out.report.filter((r) => r.code === 'value_omitted' && r.details.id === 'VariableID:chain-owner');
    expect(reports).toHaveLength(2);
    for (const r of reports) expect(r.details.reason).toBe('target_omitted');
  });

  it('reports no stale mode_selection_not_expressible for a token that ends up fully omitted', () => {
    const artifact = chainGroupConflict();
    const owner = artifact.tokens.find((t) => t.id === 'VariableID:chain-owner');
    if (!owner) throw new Error('fixture lost color/surface/primary');
    const dark = owner.values['ModeID:s-dark'];
    if (dark.kind !== 'alias' || dark.resolved.status !== 'resolved') {
      throw new Error('fixture changed shape: chain-owner Dark is no longer a resolved alias');
    }
    // Figma resolved this hop through a target mode named differently than
    // the consuming Semantic mode -- on its own, before bridge is recognised
    // dead, this would report mode_selection_not_expressible and say the
    // reference is kept. Both modes now take this shape, so no literal
    // fallback is left to keep chain-owner alive once bridge dies.
    const mismatchedHop = {
      ...dark, resolved: { ...dark.resolved, chain: [{ ...dark.resolved.chain[0], mode_id: 'ModeID:p-light' }] },
    };
    owner.values['ModeID:s-dark'] = mismatchedHop;
    owner.values['ModeID:s-light'] = mismatchedHop;

    const out = foundationDtcg(artifact);
    expect(out.meta['Semantic.color.surface.primary'])
      .toMatchObject({ id: 'VariableID:chain-owner', omitted: true });
    for (const [name, file] of Object.entries(out.files)) {
      expect(leaf(file, 'Semantic.color.surface.primary'), name).toBeUndefined();
    }
    const reports = out.report.filter((r) => r.details.id === 'VariableID:chain-owner');
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) expect(r.code).toBe('value_omitted');
    expect(out.report.filter((r) => r.code === 'mode_selection_not_expressible')).toEqual([]);
  });

  it('reports no stale alias_type_mismatch for a token that ends up fully omitted', () => {
    const artifact = syntheticArtifact();
    const terminal = artifact.tokens.find((t) => t.id === 'VariableID:unknown-number');
    if (!terminal) throw new Error('fixture lost Primitives.number.unknown-scope');
    const twin = { ...structuredClone(terminal), id: 'VariableID:unknown-number-twin' };
    artifact.tokens.push(twin); // terminal collides with its twin -- both omitted

    const collectionId = terminal.collection_id;
    const modeIds = Object.keys(terminal.values);
    for (const modeId of modeIds) {
      terminal.values[modeId] = { kind: 'literal', value: { type: 'number', value: 8 } };
      twin.values[modeId] = { kind: 'literal', value: { type: 'number', value: 8 } };
    }

    /** `throughTerminal` mirrors Figma's own chain metadata: `mid` resolves in
     *  one hop straight to `terminal`, and `outer` resolves in two, through
     *  `mid` to `terminal`, the same as Figma would record for a real chain. */
    const aliasChain = (targetId: string, targetPath: string[], throughTerminal: boolean) => {
      const values: TokenV5['values'] = {};
      for (const modeId of modeIds) {
        values[modeId] = {
          kind: 'alias',
          reference: {
            target_id: targetId, target_collection_id: collectionId, target_path: targetPath, external: false,
          },
          resolved: {
            status: 'resolved',
            value: { type: 'dimension', number: 8, unit: 'px' },
            chain: throughTerminal
              ? [{ token_id: targetId, mode_id: modeId }]
              : [{ token_id: targetId, mode_id: modeId }, { token_id: terminal.id, mode_id: modeId }],
          },
        };
      }
      return values;
    };
    const mid = {
      ...structuredClone(terminal), id: 'VariableID:mid', name: 'x/mid', scopes: [] as string[],
      values: aliasChain(terminal.id, terminal.name.split('/'), true),
    };
    // CORNER_RADIUS pins this token's own projected type to a dimension, but
    // its alias target (mid) is a bare number: before mid is recognised dead
    // this would report alias_type_mismatch and fall back to a literal.
    const outer = {
      ...structuredClone(terminal), id: 'VariableID:outer-mismatch', name: 'x/outer', scopes: ['CORNER_RADIUS'],
      values: aliasChain(mid.id, ['x', 'mid'], false),
    };
    artifact.tokens.push(mid, outer);

    const out = foundationDtcg(artifact);
    const path = Object.keys(out.meta).find((k) => out.meta[k].id === 'VariableID:outer-mismatch');
    expect(path).toBeDefined();
    expect(out.meta[path as string]).toMatchObject({ omitted: true });
    for (const [name, tree] of Object.entries(out.files)) {
      expect(leaf(tree, path as string), name).toBeUndefined();
    }

    const reports = out.report.filter((r) => r.details.id === 'VariableID:outer-mismatch');
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) expect(r.code).toBe('value_omitted');
    expect(out.report.filter((r) => r.code === 'alias_type_mismatch')).toEqual([]);
  });

  it('omits every level of a three-deep group conflict, in either order', () => {
    const NAMES: Record<string, string> = {
      'VariableID:color-exact': 'x', 'VariableID:color-lossy': 'x/y', 'VariableID:chain-terminal': 'x/y/z',
    };
    const threeDeep = (order: string[]): ReturnType<typeof syntheticArtifact> => {
      const artifact = syntheticArtifact();
      for (const [id, name] of Object.entries(NAMES)) {
        const token = artifact.tokens.find((t) => t.id === id);
        if (!token) throw new Error(`fixture lost ${id}`);
        token.name = name;
      }
      const targeted = new Set(Object.keys(NAMES));
      const rest = artifact.tokens.filter((t) => !targeted.has(t.id));
      const byId = (id: string) => artifact.tokens.find((t) => t.id === id);
      const picked = order.map(byId);
      if (picked.some((t) => !t)) throw new Error('fixture lost one of the three chained tokens');
      artifact.tokens = [...picked, ...rest] as typeof artifact.tokens;
      return artifact;
    };
    const orders = [
      Object.keys(NAMES),
      [...Object.keys(NAMES)].reverse(),
    ];
    for (const order of orders) {
      const out = foundationDtcg(threeDeep(order));
      for (const [name, file] of Object.entries(out.files)) {
        if (!name.startsWith('primitives.')) continue;
        expect(leaf(file, 'Primitives.x.y.z')?.$type, name).toBe('color');
        expect(leaf(file, 'Primitives.x'), name).not.toHaveProperty('$value');
        expect(leaf(file, 'Primitives.x.y'), name).not.toHaveProperty('$value');
      }
      const groupReports = out.report.filter((r) => r.code === 'path_collision' && r.details.reason === 'group');
      expect(groupReports.map((r) => r.path).sort()).toEqual(['Primitives.x', 'Primitives.x.y']);
    }
    expect(dtcgExportFiles(foundationDtcg(threeDeep(orders[0]))))
      .toEqual(dtcgExportFiles(foundationDtcg(threeDeep(orders[1]))));
  });
});

describe('a reference to a token that has no value in some mode', () => {
  const find = (artifact: FoundationArtifactV5, id: string): TokenV5 => {
    const token = artifact.tokens.find((t) => t.id === id);
    if (!token) throw new Error(`fixture lost ${id}`);
    return token;
  };

  /** A resolved alias to `target`, through `hops` (token, mode) in order. */
  const aliasTo = (
    target: TokenV5, hops: Array<[TokenV5, string]>, value: TokenV5['values'][string],
  ): TokenV5['values'][string] => {
    if (value.kind !== 'literal') throw new Error('aliasTo needs a literal to resolve to');
    return {
      kind: 'alias',
      reference: {
        target_id: target.id, target_collection_id: target.collection_id,
        target_path: target.name.split('/'), external: false,
      },
      resolved: {
        status: 'resolved', value: value.value,
        chain: hops.map(([token, modeId]) => ({ token_id: token.id, mode_id: modeId })),
      },
    };
  };

  /**
   * The reviewer's reproduction. `color/red` is omitted as a group beside
   * `color/red/dark`; `brand/primary` is a literal in both Light modes and
   * aliases `color/red` in Dark; `button/bg` aliases `brand/primary` in every
   * mode. So `brand/primary` is alive, but has no leaf in the Dark file.
   */
  const perModeChain = (): FoundationArtifactV5 => {
    const artifact = syntheticArtifact();
    const red = find(artifact, 'VariableID:color-exact');
    find(artifact, 'VariableID:color-lossy').name = 'color/red/dark';
    red.name = 'color/red';
    const brand: TokenV5 = { ...structuredClone(red), id: 'VariableID:brand-primary', name: 'brand/primary' };
    delete brand.code_syntax;
    brand.values['ModeID:p-dark'] = aliasTo(red, [[red, 'ModeID:p-dark']], red.values['ModeID:p-dark']);
    const button: TokenV5 = { ...structuredClone(brand), id: 'VariableID:button-bg', name: 'button/bg' };
    for (const modeId of Object.keys(button.values)) {
      const hops: Array<[TokenV5, string]> = modeId === 'ModeID:p-dark'
        ? [[brand, modeId], [red, modeId]] : [[brand, modeId]];
      button.values[modeId] = aliasTo(brand, hops, red.values[modeId]);
    }
    artifact.tokens.push(brand, button);
    return artifact;
  };

  /** `perModeChain`, plus the Semantic Dark mode of `color/surface/primary`
   *  aliasing `brand/primary` across the collection boundary. */
  const crossCollection = (): FoundationArtifactV5 => {
    const artifact = perModeChain();
    const brand = find(artifact, 'VariableID:brand-primary');
    const red = find(artifact, 'VariableID:color-exact');
    find(artifact, 'VariableID:chain-owner').values['ModeID:s-dark'] = aliasTo(
      brand, [[brand, 'ModeID:p-dark'], [red, 'ModeID:p-dark']], red.values['ModeID:p-dark'],
    );
    return artifact;
  };

  /** The style bindings' targets each lose their Dark value. */
  const stylesBoundToPartialTokens = (): FoundationArtifactV5 => {
    const artifact = syntheticArtifact();
    const missing = find(artifact, 'VariableID:local-collision').values['ModeID:p-light-duplicate'];
    for (const id of ['VariableID:font-family', 'VariableID:shadow-blur']) {
      find(artifact, id).values['ModeID:p-dark'] = structuredClone(missing);
    }
    return artifact;
  };

  it('omits a same-collection reference in the one mode whose file lacks the target', () => {
    const out = foundationDtcg(perModeChain());

    expect(leaf(out.files['primitives.dark.json'], 'Primitives.brand.primary')).toBeUndefined();
    expect(leaf(out.files['primitives.dark.json'], 'Primitives.button.bg')).toBeUndefined();
    for (const file of ['primitives.light.json', 'primitives.light-2.json']) {
      expect(leaf(out.files[file], 'Primitives.button.bg'), file)
        .toMatchObject({ $type: 'color', $value: '{Primitives.brand.primary}' });
    }
    expect(out.report.filter((r) => r.details.id === 'VariableID:button-bg')).toEqual([
      expect.objectContaining({
        code: 'value_omitted', severity: 'warning', path: 'Primitives.button.bg', mode: 'Dark',
        details: {
          id: 'VariableID:button-bg', reason: 'target_omitted',
          target_path: 'brand/primary', target_id: 'VariableID:brand-primary',
        },
      }),
    ]);
    // Alive in two of three modes, so it is not an omitted token.
    expect(out.meta['Primitives.button.bg'].omitted).toBeUndefined();
    expect(out.meta['Primitives.button.bg'].transform).toEqual({
      'Light [ModeID:p-light-duplicate]': 'alias', 'Light [ModeID:p-light]': 'alias',
    });
    expect(unresolvedReferences(out)).toEqual([]);
  });

  it('omits a cross-collection reference to a token some context of its collection lacks', () => {
    const out = foundationDtcg(crossCollection());

    expect(leaf(out.files['semantic.dark.json'], 'Semantic.color.surface.primary')).toBeUndefined();
    expect(leaf(out.files['semantic.light.json'], 'Semantic.color.surface.primary')?.$type).toBe('color');
    expect(out.report.filter((r) => r.details.id === 'VariableID:chain-owner')).toEqual([
      expect.objectContaining({
        code: 'value_omitted', path: 'Semantic.color.surface.primary', mode: 'Dark',
        details: expect.objectContaining({ reason: 'target_omitted', target_id: 'VariableID:brand-primary' }),
      }),
    ]);
    expect(out.meta['Semantic.color.surface.primary'].omitted).toBeUndefined();
    expect(unresolvedReferences(out)).toEqual([]);
  });

  it('marks a token omitted when the per-mode search leaves it no mode at all', () => {
    const artifact = perModeChain();
    const brand = find(artifact, 'VariableID:brand-primary');
    const red = find(artifact, 'VariableID:color-exact');
    // Every mode of brand/primary now aliases the omitted colour, so it and
    // button/bg are dead everywhere.
    for (const modeId of Object.keys(brand.values)) {
      brand.values[modeId] = aliasTo(red, [[red, modeId]], red.values[modeId]);
    }
    const out = foundationDtcg(artifact);
    expect(out.meta['Primitives.brand.primary']).toMatchObject({ omitted: true });
    expect(out.meta['Primitives.button.bg']).toMatchObject({ omitted: true });
    expect(unresolvedReferences(out)).toEqual([]);
  });

  it('writes a literal for a style bound to a token some context lacks, and reports the binding', () => {
    const out = foundationDtcg(stylesBoundToPartialTokens());
    const body = leaf(out.files['styles.typography.json'], 'Typography styles.Body.Regular');
    expect((body?.$value as Record<string, DtcgJson>).fontFamily).toBe('Inter');
    expect((body?.$value as Record<string, DtcgJson>).fontWeight).toBe('{Primitives.typography.weight.strong}');
    const card = leaf(out.files['styles.effects.json'], 'Effect styles.Shadow.Card');
    const shadow = (card?.$value as DtcgJson[])[0] as Record<string, DtcgJson>;
    expect(typeof shadow.blur).not.toBe('string');
    const dropped = out.report.filter((r) => r.code === 'binding_dropped');
    expect(dropped.map((r) => r.details)).toEqual([
      { property: 'effects[0].blur', target_id: 'VariableID:shadow-blur', reason: 'target_omitted' },
      { property: 'fontFamily', target_id: 'VariableID:font-family', reason: 'target_omitted' },
    ]);
    expect(unresolvedReferences(out)).toEqual([]);
  });

  it('projects a per-mode dead chain the same regardless of token order', () => {
    const reversed = crossCollection();
    reversed.tokens.reverse();
    expect(dtcgExportFiles(foundationDtcg(reversed))).toEqual(dtcgExportFiles(foundationDtcg(crossCollection())));
  });

  it('writes no reference that fails to resolve in some resolver context, for every fixture here', () => {
    const chainGroup = syntheticArtifact();
    find(chainGroup, 'VariableID:chain-terminal').name = 'color/chain';
    const radiusDerived: UsageUnitMap = new Map<string, UnitEvidence>([
      ['VariableID:unknown-number', { unit: 'px', via: 'alias-scope', source: 'Radius.rd-sm', reason: 'CORNER_RADIUS' }],
    ]);
    const cases: Array<[string, DtcgExport]> = [
      ['synthetic', foundationDtcg(syntheticArtifact())],
      ['synthetic legacy', foundationDtcg(syntheticArtifact(), { values: 'legacy' })],
      ['radius mismatch', foundationDtcg(radiusMismatchArtifact())],
      ['radius mismatch, derived unit', foundationDtcg(radiusMismatchArtifact(), {}, radiusDerived)],
      ['chain group conflict', foundationDtcg(chainGroup)],
      ['per-mode chain', foundationDtcg(perModeChain())],
      ['cross collection', foundationDtcg(crossCollection())],
      ['styles bound to partial tokens', foundationDtcg(stylesBoundToPartialTokens())],
    ];
    for (const [name, out] of cases) expect(unresolvedReferences(out), name).toEqual([]);
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
    });
    expect(body?.$extensions).toEqual({
      'com.spec-layer': {
        lineHeight: { value: 24, unit: 'px' },
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
    // DTCG line height is a unitless multiplier of the font size. A measured
    // 24px is not that, and dividing it by 16 would be a derivation.
    expect(out.report).toContainEqual(expect.objectContaining({
      code: 'unit_not_expressible', path: 'Typography styles.Body.Regular',
      details: expect.objectContaining({ property: 'lineHeight', unit: 'px', number: 24 }),
    }));
  });

  it('reports a typography property whose bound token is not in the artifact, and keeps the literal', () => {
    const artifact = syntheticArtifact();
    const style = artifact.styles.typography[0];
    style.properties.font_size.source = { kind: 'alias', target_id: 'VariableID:not-here', target_path: [] };
    const withMissingTarget = foundationDtcg(artifact);
    const body = leaf(withMissingTarget.files['styles.typography.json'], 'Typography styles.Body.Regular');
    expect(body?.$value).toMatchObject({ fontSize: { value: 16, unit: 'px' } });
    expect(withMissingTarget.report).toContainEqual(expect.objectContaining({
      code: 'binding_dropped', severity: 'warning', path: 'Typography styles.Body.Regular',
      details: { property: 'fontSize', target_id: 'VariableID:not-here', reason: 'target_unavailable' },
    }));
  });

  it('keeps a line height in $value only when it is a unitless number', () => {
    const multiplier = syntheticArtifact();
    multiplier.styles.typography[0].properties.line_height = {
      source: { kind: 'alias', target_id: 'VariableID:unknown-number', target_path: ['number', 'unknown-scope'] },
      resolved: { type: 'number', value: 1.5 },
    };
    const asNumber = foundationDtcg(multiplier);
    const body = leaf(asNumber.files['styles.typography.json'], 'Typography styles.Body.Regular');
    expect(body?.$value).toMatchObject({ lineHeight: '{Primitives.number.unknown-scope}' });
    expect(asNumber.report.filter((r) => r.details.property === 'lineHeight')).toEqual([]);

    // A binding to a dimension token cannot become a reference either: the
    // target's own $type is dimension, which lineHeight does not accept.
    const bound = syntheticArtifact();
    bound.styles.typography[0].properties.line_height = {
      source: { kind: 'alias', target_id: 'VariableID:gap', target_path: ['spacing', 'gap'] },
      resolved: { type: 'dimension', number: 8, unit: 'px' },
    };
    const asDimension = foundationDtcg(bound);
    const boundBody = leaf(asDimension.files['styles.typography.json'], 'Typography styles.Body.Regular');
    expect(boundBody?.$value).not.toHaveProperty('lineHeight');
    expect(boundBody?.$extensions).toMatchObject({
      'com.spec-layer': { lineHeight: { value: 8, unit: 'px' } },
    });
    expect(asDimension.report).toContainEqual(expect.objectContaining({
      code: 'unit_not_expressible', severity: 'info', path: 'Typography styles.Body.Regular',
      details: expect.objectContaining({
        property: 'lineHeight', unit: 'px', number: 8, target_id: 'VariableID:gap',
      }),
    }));
  });

  it('writes a percent line height as a multiplier and keeps a px line height under extensions', () => {
    const artifact = syntheticArtifact();
    const style = artifact.styles.typography[0];
    style.properties.line_height = { source: { kind: 'literal' }, resolved: { type: 'dimension', number: 140, unit: '%' } };
    const out = foundationDtcg(artifact);
    const body = leaf(out.files['styles.typography.json'], 'Typography styles.Body.Regular');
    expect((body?.$value as Record<string, unknown>).lineHeight).toBe(1.4);
    expect((body?.$extensions as Record<string, Record<string, unknown>>)['com.spec-layer']).not.toHaveProperty('lineHeight');
    expect(out.report.filter((r) => r.code === 'unit_not_expressible' && r.details.property === 'lineHeight')).toEqual([]);
  });

  it('converts a percent line height bound to a token this export does not carry, and reports the dropped binding', () => {
    const artifact = syntheticArtifact();
    const style = artifact.styles.typography[0];
    style.properties.line_height = {
      source: { kind: 'alias', target_id: 'VariableID:not-here', target_path: [] },
      resolved: { type: 'dimension', number: 150, unit: '%' },
    };
    const out = foundationDtcg(artifact);
    const body = leaf(out.files['styles.typography.json'], 'Typography styles.Body.Regular');
    expect((body?.$value as Record<string, unknown>).lineHeight).toBe(1.5);
    expect((body?.$extensions as Record<string, Record<string, unknown>>)['com.spec-layer']).not.toHaveProperty('lineHeight');
    expect(out.report.filter((r) => r.code === 'unit_not_expressible' && r.details.property === 'lineHeight')).toEqual([]);
    expect(out.report.filter((r) => r.code === 'binding_dropped' && r.details.property === 'lineHeight')).toEqual([
      expect.objectContaining({
        code: 'binding_dropped', path: 'Typography styles.Body.Regular',
        details: { property: 'lineHeight', target_id: 'VariableID:not-here', reason: 'target_unavailable' },
      }),
    ]);
  });

  it('keeps a percent line height bound to an exported token under extensions, naming the target', () => {
    // The target token is `dimension`-typed and DTCG `lineHeight` accepts only
    // a unitless number, so no reference can be written; the literal goes
    // under $extensions and the report names the binding it stood for.
    const artifact = syntheticArtifact();
    artifact.styles.typography[0].properties.line_height = {
      source: { kind: 'alias', target_id: 'VariableID:gap', target_path: ['spacing', 'gap'] },
      resolved: { type: 'dimension', number: 150, unit: '%' },
    };
    const out = foundationDtcg(artifact);
    const body = leaf(out.files['styles.typography.json'], 'Typography styles.Body.Regular');

    expect(body?.$value).not.toHaveProperty('lineHeight');
    expect(body?.$extensions).toMatchObject({
      'com.spec-layer': { lineHeight: { value: 150, unit: '%' } },
    });
    expect(out.report.filter((r) => r.code === 'unit_not_expressible' && r.details.property === 'lineHeight')).toEqual([
      expect.objectContaining({
        code: 'unit_not_expressible', severity: 'info', path: 'Typography styles.Body.Regular',
        details: {
          property: 'lineHeight', unit: '%', number: 150, target_id: 'VariableID:gap',
        },
      }),
    ]);
    expect(out.report.filter((r) => r.code === 'binding_dropped' && r.details.property === 'lineHeight')).toEqual([]);
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

  it('reports a shadow field whose bound token was omitted, and keeps the literal', () => {
    const artifact = syntheticArtifact();
    const blur = artifact.tokens.find((t) => t.id === 'VariableID:shadow-blur');
    if (!blur) throw new Error('fixture lost shadow-blur');
    blur.type = 'boolean'; // boolean tokens are omitted by the projection
    const withOmittedTarget = foundationDtcg(artifact);
    const card = leaf(withOmittedTarget.files['styles.effects.json'], 'Effect styles.Shadow.Card');
    expect((card?.$value as Array<Record<string, unknown>>)[0].blur).toEqual({ value: 12, unit: 'px' });
    expect(withOmittedTarget.report).toContainEqual(expect.objectContaining({
      code: 'binding_dropped', path: 'Effect styles.Shadow.Card',
      details: { property: 'effects[0].blur', target_id: 'VariableID:shadow-blur', reason: 'target_omitted' },
    }));
  });

  it('keeps the first of two styles that share a DTCG path and reports the later one', () => {
    const artifact = syntheticArtifact();
    const original = artifact.styles.typography[0];
    artifact.styles.typography.push({
      ...structuredClone(original), id: 'StyleID:body-regular-copy', description: 'The later twin.',
    });
    const collided = foundationDtcg(artifact);
    const body = leaf(collided.files['styles.typography.json'], 'Typography styles.Body.Regular');
    expect(body?.$description).toBe('Source style retained for Phase 3.');
    expect(collided.report.filter((r) => r.code === 'path_collision')).toEqual([
      expect.objectContaining({
        code: 'path_collision', severity: 'error', path: 'Typography styles.Body.Regular',
        details: {
          id: 'StyleID:body-regular-copy',
          ids: ['StyleID:body-regular', 'StyleID:body-regular-copy'],
        },
      }),
    ]);
  });

  it('reports an effect style with no visible shadow and keeps every layer under extensions', () => {
    const artifact = syntheticArtifact();
    // The drop shadow turns invisible, leaving only a hidden shadow and a blur,
    // neither of which DTCG's shadow type can state.
    artifact.styles.effects[0].effects[0].visible = false;
    const blurred = foundationDtcg(artifact);
    const card = leaf(blurred.files['styles.effects.json'], 'Effect styles.Shadow.Card');
    expect(card?.$type).toBe('shadow');
    expect(card?.$value).toEqual([]);
    expect(card?.$extensions).toEqual({
      'com.spec-layer': {
        layers: [
          { index: 0, type: 'drop_shadow', visible: false, blend_mode: 'normal' },
          { index: 1, type: 'layer_blur', visible: false, blur: { value: 2, unit: 'px' } },
        ],
      },
    });
    expect(blurred.report).toContainEqual(expect.objectContaining({
      code: 'effect_not_expressible', severity: 'warning', path: 'Effect styles.Shadow.Card',
      details: { id: 'StyleID:shadow-card' },
    }));
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

  it('labels two collections that share a name apart and reports the collision', () => {
    const clashing = syntheticArtifact();
    clashing.collections[1].name = clashing.collections[0].name;
    const clashed = foundationDtcg(clashing);
    const first = 'Primitives [CollectionID:primitives]';
    const second = 'Primitives [CollectionID:semantic]';
    expect(Object.keys(clashed.resolver.modifiers).sort()).toEqual([first, second]);
    expect(clashed.resolver.resolutionOrder).toEqual([
      { $ref: `#/modifiers/${first}` },
      { $ref: `#/modifiers/${second}` },
      { $ref: '#/sets/Effect styles' },
      { $ref: '#/sets/Typography styles' },
    ]);
    // The second collection's modes must survive rather than overwrite the first's.
    expect(Object.keys(clashed.resolver.modifiers[second].contexts)).toEqual(['Light', 'Dark']);
    const collisions = clashed.report.filter((r) => r.code === 'collection_name_collision');
    expect(collisions).toHaveLength(2);
    expect(collisions.map((r) => r.path).sort()).toEqual([first, second]);
    for (const entry of collisions) {
      expect(entry.severity).toBe('warning');
      expect(entry.details.ids).toEqual(['CollectionID:primitives', 'CollectionID:semantic']);
    }
    const doc = foundationDtcgDocument(clashing);
    expect(Object.keys(doc.modifiers).sort()).toEqual([first, second]);
  });

  it('keeps a collection named like a style set apart from that set', () => {
    const artifact = syntheticArtifact();
    const semantic = artifact.collections.find((c) => c.id === 'CollectionID:semantic');
    if (!semantic) throw new Error('fixture lost Semantic');
    // One mode, so the collection becomes a resolver set rather than a modifier.
    const keep = semantic.modes[0];
    semantic.modes = [keep];
    semantic.default_mode_id = keep.id;
    for (const token of artifact.tokens) {
      if (token.collection_id === semantic.id) token.values = { [keep.id]: token.values[keep.id] };
    }
    semantic.name = 'Typography styles';
    const out = foundationDtcg(artifact);
    const label = 'Typography styles [CollectionID:semantic]';
    expect(out.resolver.sets['Typography styles']).toEqual({ sources: [{ $ref: 'styles.typography.json' }] });
    expect(out.resolver.sets[label]).toEqual({ sources: [{ $ref: 'typography-styles.light.json' }] });
    expect(out.resolver.resolutionOrder).toContainEqual({ $ref: `#/sets/${label}` });
    expect(out.report).toContainEqual(expect.objectContaining({
      code: 'collection_name_collision', severity: 'warning', path: label,
      details: { id: 'CollectionID:semantic', reserved: 'Typography styles' },
    }));
  });

  it('escapes JSON pointer characters in set and modifier names', () => {
    const renamed = syntheticArtifact();
    renamed.collections[1].name = 'a/b~c';
    const r = foundationDtcg(renamed).resolver;
    expect(r.resolutionOrder[1]).toEqual({ $ref: '#/modifiers/a~1b~0c' });
    expect(Object.keys(r.modifiers)).toContain('a/b~c');
  });

  it('puts generated group descriptions under the spec-layer extension, never $description', () => {
    const annotated = syntheticArtifact();
    annotated.guidelines = { origin: 'generated', group_descriptions: { Primitives: { color: 'Brand ramps.' } } };
    const files = foundationDtcg(annotated).files;
    const group = leaf(files['primitives.light.json'], 'Primitives.color');
    expect(group?.$description).toBeUndefined();
    expect(group?.$extensions).toEqual({ 'com.spec-layer': { generated_description: 'Brand ramps.' } });
    // A token's own $description is the designer's, and stays where it was.
    expect(leaf(files['primitives.light.json'], 'Primitives.color.exact.red')?.$description)
      .toBe('Exactly representable source channels.');
  });

  it('keeps annotating later groups after one folder is absent from a mode', () => {
    const annotated = syntheticArtifact();
    annotated.guidelines = {
      origin: 'generated',
      group_descriptions: { Primitives: { cycle: 'Cycles.', color: 'Brand ramps.' } },
    };
    const files = foundationDtcg(annotated).files;
    expect(leaf(files['primitives.light.json'], 'Primitives.color')?.$extensions)
      .toEqual({ 'com.spec-layer': { generated_description: 'Brand ramps.' } });
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

describe('the document extension', () => {
  it('is written into resolver.json', () => {
    const files = dtcgExportFiles(foundationDtcg(syntheticArtifact()));
    const resolver = JSON.parse(files['resolver.json']);
    const ext = resolver.$extensions['com.spec-layer'];
    expect(ext.content_hash).toBe(syntheticArtifact().spec_layer.export.content_hash);
    expect(ext.source.provider).toBe('figma');
  });

  it('is byte-identical in resolver.json and the clipboard document', () => {
    const artifact = syntheticArtifact();
    const onDisk = JSON.parse(dtcgExportFiles(foundationDtcg(artifact))['resolver.json']);
    const clipboard = foundationDtcgDocument(artifact);
    expect(onDisk.$extensions['com.spec-layer'])
      .toEqual(clipboard.$extensions['com.spec-layer']);
  });
});

describe('config_hash', () => {
  const hashOf = (options: Parameters<typeof foundationDtcg>[1]) =>
    foundationDtcg(syntheticArtifact(), options).extension.config_hash;

  it('is a sha256 digest', () => {
    expect(hashOf({})).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('ignores the key order of the unit overrides', () => {
    const a = hashOf({ units: { 'A/one': 'px', 'B/two': 'rem' } });
    const b = hashOf({ units: { 'B/two': 'rem', 'A/one': 'px' } });
    expect(a).toBe(b);
  });

  it('treats an omitted value style as the standard style', () => {
    expect(hashOf({})).toBe(hashOf({ values: 'standard' }));
  });

  it('changes when the value style changes', () => {
    expect(hashOf({ values: 'legacy' })).not.toBe(hashOf({ values: 'standard' }));
  });

  it('changes when a unit override changes', () => {
    expect(hashOf({ units: { 'A/one': 'px' } })).not.toBe(hashOf({ units: { 'A/one': 'rem' } }));
  });
});

describe('units derived from stated usage', () => {
  const PATH = 'Primitives.number.unknown-scope';
  const evidence = (over: Partial<UnitEvidence> = {}): UnitEvidence => ({
    unit: 'px', via: 'binding', source: 'Button', reason: 'height', ...over,
  });
  const derived = (id: string, over?: Partial<UnitEvidence>): UsageUnitMap =>
    new Map([[id, evidence(over)]]);

  it('writes a real dimension and reports the evidence that pinned it', () => {
    const out = foundationDtcg(syntheticArtifact(), {}, derived('VariableID:unknown-number'));

    expect(leaf(out.files['primitives.light.json'], PATH))
      .toMatchObject({ $type: 'dimension', $value: { value: 1.5, unit: 'px' } });

    // Guardrail: a derived unit a reader cannot audit is a guess. The entry
    // must name what pinned it, not just that something did.
    const entries = out.report.filter((r) => r.code === 'unit_derived_from_usage');
    expect(entries).toHaveLength(1); // one fact about the token, not one per mode
    expect(entries[0].severity).toBe('info');
    expect(entries[0].path).toBe(PATH);
    expect(entries[0].details).toMatchObject({
      id: 'VariableID:unknown-number', unit: 'px', via: 'binding', source: 'Button', reason: 'height',
    });
    expect(entries[0].message).toContain('Button binds it to `height`');

    // The sidecar names the rule that produced the value, rather than claiming
    // the token held a dimension of its own.
    const transforms = Object.values(out.meta[PATH].transform ?? {});
    expect(transforms.every((t) => t === 'number-unit-usage')).toBe(true);
    expect(transforms.length).toBeGreaterThan(0);
  });

  it('words a scope-pinned alias as an aliasing, scoped token rather than a binding', () => {
    const out = foundationDtcg(
      syntheticArtifact(), {},
      derived('VariableID:unknown-number', { via: 'alias-scope', source: 'Radius.rd-sm', reason: 'CORNER_RADIUS' }),
    );
    const entry = out.report.find((r) => r.code === 'unit_derived_from_usage');
    expect(entry?.message).toContain('Radius.rd-sm aliases it and is scoped `CORNER_RADIUS`.');
    expect(entry?.message).not.toContain('binds it to');
  });

  it('lets an explicit units override beat the derived evidence', () => {
    // Guardrail: the config is the human's own statement about their tokens.
    const out = foundationDtcg(
      syntheticArtifact(), { units: { 'Primitives/number/*': 'rem' } },
      derived('VariableID:unknown-number'),
    );
    expect(leaf(out.files['primitives.light.json'], PATH))
      .toMatchObject({ $type: 'dimension', $value: { value: 1.5, unit: 'rem' } });
    expect(out.report.find((r) => r.code === 'unit_derived_from_usage')).toBeUndefined();
    expect(Object.values(out.meta[PATH].transform ?? {})).toContain('number-unit-override');
  });

  it('ignores evidence about a token whose own scopes already state a unit', () => {
    // A FONT_WEIGHT scope states "unitless number"; nothing read off usage may
    // overrule the file's own statement.
    const out = foundationDtcg(syntheticArtifact(), {}, derived('VariableID:font-weight'));
    expect(leaf(out.files['primitives.light.json'], 'Primitives.typography.weight.strong')?.$type)
      .toBe('fontWeight');
    expect(out.report.find((r) => r.code === 'unit_derived_from_usage')).toBeUndefined();
  });

  it('never reports a derived unit through a chain terminal projection the final build does not reach', () => {
    // A -> B -> C, where C lost its DTCG path to a collision and so is never
    // built as a leaf. B's only value aliases C directly, so B dies exactly
    // as C does, from a consumer's point of view; A's only value aliases B,
    // so A dies the same way, one hop further out (see "an alias whose
    // reference chain ends in an omitted token" below -- this is that fix's
    // own reporting machinery interacting with a chain that dies for a
    // different reason, a collision rather than a group conflict).
    //
    // Before the fixed-point search was made side-effect-free, an early
    // attempt -- taken before B was recognised dead -- resolved A's own leaf
    // through Figma's own resolved chain straight to C (the call site that
    // projects the chain TERMINAL rather than the token being built) and
    // reported C's derived unit there; that entry then survived into the
    // final report even once B and A were both recognised dead and dropped,
    // describing an attempt the authoritative build never actually makes.
    // The one real, reporting build never reaches that call site here -- A
    // returns via `target_omitted`, straight from its own direct target
    // check, before it ever asks what type its chain resolves to -- so
    // nothing names C's derived unit at all. The pin is simply unreachable
    // from the finished export, and the report must not claim otherwise.
    const artifact = syntheticArtifact();
    const terminal = artifact.tokens.find((t) => t.id === 'VariableID:unknown-number');
    if (!terminal) throw new Error('fixture lost Primitives.number.unknown-scope');
    artifact.tokens.push({ ...structuredClone(terminal), id: 'VariableID:unknown-number-twin' });

    const aliasTo = (targetId: string, collectionId: string, targetPath: string[]) => ({
      kind: 'alias' as const,
      reference: {
        target_id: targetId, target_collection_id: collectionId, target_path: targetPath, external: false,
      },
      resolved: {
        status: 'resolved' as const,
        value: { type: 'number' as const, value: 1.5 },
        chain: [{ token_id: 'VariableID:unknown-number', mode_id: 'ModeID:p-light' }],
      },
    });
    const inner = {
      id: 'VariableID:inner', collection_id: 'CollectionID:semantic',
      name: 'derived/inner', path: ['derived', 'inner'], type: 'number' as const,
      description: '', scopes: [],
      values: {
        'ModeID:s-light': aliasTo('VariableID:unknown-number', 'CollectionID:primitives', ['number', 'unknown-scope']),
        'ModeID:s-dark': aliasTo('VariableID:unknown-number', 'CollectionID:primitives', ['number', 'unknown-scope']),
      },
    };
    const outer = {
      ...inner, id: 'VariableID:outer', name: 'derived/outer', path: ['derived', 'outer'],
      values: {
        'ModeID:s-light': aliasTo('VariableID:inner', 'CollectionID:semantic', ['derived', 'inner']),
        'ModeID:s-dark': aliasTo('VariableID:inner', 'CollectionID:semantic', ['derived', 'inner']),
      },
    };
    artifact.tokens.push(inner, outer);

    const out = foundationDtcg(artifact, {}, derived('VariableID:unknown-number'));

    // The collided token really has no leaf: both twins were omitted.
    expect(out.report.some((r) => r.code === 'path_collision')).toBe(true);
    expect(leaf(out.files['primitives.light.json'], PATH)).toBeUndefined();
    // Neither hop between the collision and the surface token writes a leaf
    // either: a reference to a token that itself resolves to nothing is
    // exactly as dangling as a reference straight to the collision.
    expect(leaf(out.files['semantic.light.json'], 'Semantic.derived.inner')).toBeUndefined();
    expect(leaf(out.files['semantic.light.json'], 'Semantic.derived.outer')).toBeUndefined();
    expect(out.meta['Semantic.derived.inner']).toMatchObject({ omitted: true });
    expect(out.meta['Semantic.derived.outer']).toMatchObject({ omitted: true });

    // ... and nothing reports the derived unit either: the report describes
    // only the final build, and the final build never reaches C.
    expect(out.report.filter((r) => r.code === 'unit_derived_from_usage')).toEqual([]);
  });

  it('leaves a number alone when nothing states a unit for it', () => {
    const out = foundationDtcg(syntheticArtifact());
    expect(leaf(out.files['primitives.light.json'], PATH)).toMatchObject({ $type: 'number', $value: 1.5 });
    expect(out.report.find((r) => r.code === 'unit_derived_from_usage')).toBeUndefined();
  });
});

describe('meta transform', () => {
  const metaOf = (options?: Parameters<typeof foundationDtcg>[1]) =>
    foundationDtcg(syntheticArtifact(), options).meta;

  it('names alias for a token written as a reference', () => {
    const meta = metaOf();
    const aliasEntry = Object.entries(meta)
      .find(([, e]) => e.transform && Object.values(e.transform).includes('alias'));
    expect(aliasEntry).toBeDefined();
  });

  it('names the literal rule for a colour token', () => {
    const meta = metaOf();
    const transforms = Object.values(meta)
      .flatMap((e) => Object.values(e.transform ?? {}));
    expect(transforms).toContain('color');
  });

  it('keys transform by mode label', () => {
    const meta = metaOf();
    for (const entry of Object.values(meta)) {
      if (!entry.transform) continue;
      for (const key of Object.keys(entry.transform)) {
        expect(typeof key).toBe('string');
        expect(key.length).toBeGreaterThan(0);
      }
    }
  });

  it('leaves an omitted token without a transform', () => {
    const meta = metaOf();
    for (const entry of Object.values(meta)) {
      if (entry.omitted) expect(entry.transform).toBeUndefined();
    }
  });
});

describe('meta resolved values', () => {
  const leafAt = (tree: Record<string, unknown>, path: string): Record<string, unknown> | null => {
    let node: unknown = tree;
    for (const segment of path.split('.')) {
      if (typeof node !== 'object' || node === null) return null;
      node = (node as Record<string, unknown>)[segment];
    }
    return typeof node === 'object' && node !== null ? node as Record<string, unknown> : null;
  };

  /** Follows a chain of `{references}` inside one file until it reaches a
   *  literal. Returns undefined when the chain leaves this file or runs too
   *  deep, which the caller treats as "not checkable here". */
  const followToLiteral = (
    tree: Record<string, unknown>, path: string, depth = 0,
  ): unknown => {
    if (depth > 16) return undefined;
    const leaf = leafAt(tree, path);
    const value = leaf?.$value;
    if (value === undefined) return undefined;
    if (typeof value === 'string' && value.startsWith('{')) {
      return followToLiteral(tree, value.slice(1, -1), depth + 1);
    }
    return value;
  };

  it('stores a resolved value for every alias mode', () => {
    const exp = foundationDtcg(syntheticArtifact());
    const withAlias = Object.values(exp.meta)
      .filter((e) => Object.values(e.transform ?? {}).includes('alias'));
    expect(withAlias.length).toBeGreaterThan(0);
    for (const entry of withAlias) {
      for (const [mode, rule] of Object.entries(entry.transform ?? {})) {
        if (rule === 'alias') expect(entry.resolved?.[mode]).toBeDefined();
      }
    }
  });

  it('agrees with the value the reference points at', () => {
    const exp = foundationDtcg(syntheticArtifact());
    // The resolver states which file backs which mode label, so the mapping
    // comes from the document itself rather than from guessing at file names.
    // A mode label is only unique WITHIN its own collection ("Dark" can name a
    // mode in both Primitives and Semantic), so the map is keyed per
    // collection rather than globally — `exp.resolver.modifiers` is already
    // keyed by collection, and this keeps that owning key instead of
    // collapsing every collection's contexts into one flat map.
    const refOf = (sources: unknown): string | null => {
      const first = Array.isArray(sources) ? sources[0] : null;
      return first && typeof first === 'object' && typeof (first as { $ref?: unknown }).$ref === 'string'
        ? (first as { $ref: string }).$ref : null;
    };
    const fileForModeByCollection = new Map<string, Map<string, string>>();
    for (const [collectionLabel, modifier] of Object.entries(exp.resolver.modifiers)) {
      const byMode = new Map<string, string>();
      for (const [mode, sources] of Object.entries(modifier.contexts)) {
        const ref = refOf(sources);
        if (ref !== null) byMode.set(mode, ref);
      }
      fileForModeByCollection.set(collectionLabel, byMode);
    }
    // A single-mode collection has no modifier (just one `sets` entry), so
    // every mode of that collection resolves to its one file regardless of
    // the mode's own label.
    const singleFileByCollection = new Map<string, string>();
    for (const [collectionLabel, set] of Object.entries(exp.resolver.sets)) {
      if (fileForModeByCollection.has(collectionLabel)) continue;
      const ref = refOf(set.sources);
      if (ref !== null) singleFileByCollection.set(collectionLabel, ref);
    }
    // A meta path is collection-headed (e.g. "Semantic.color.surface.primary"),
    // so its first dot-separated segment names the owning collection.
    const fileFor = (path: string, mode: string): string | undefined =>
      fileForModeByCollection.get(path.split('.')[0])?.get(mode)
        ?? singleFileByCollection.get(path.split('.')[0]);

    let checked = 0;
    for (const [path, entry] of Object.entries(exp.meta)) {
      for (const [mode, resolved] of Object.entries(entry.resolved ?? {})) {
        const file = fileFor(path, mode);
        const tree = file === undefined ? undefined : exp.files[file];
        if (!tree) continue;
        // This token's own leaf, then the reference chain it points at,
        // followed all the way to a literal.
        const leaf = leafAt(tree as Record<string, unknown>, path);
        const value = leaf?.$value;
        if (typeof value !== 'string' || !value.startsWith('{')) continue;
        const target = followToLiteral(tree as Record<string, unknown>, value.slice(1, -1));
        if (target === undefined) continue;
        expect(resolved).toEqual(target);
        checked += 1;
      }
    }
    expect(checked).toBe(6);
  });

  it('agrees on the cross-collection alias too', () => {
    // Semantic.color.surface.primary's Dark value aliases
    // {Primitives.color.chain.bridge}, which is written to a different file
    // than the Semantic Dark file this token lives in. `followToLiteral`
    // above only walks references inside one file, so this case is never
    // counted by the walk — it is exactly where Figma's chain resolution and
    // DTCG's consumer-context resolution can diverge, and the projection
    // reports it via `mode_selection_not_expressible` rather than guessing.
    // Reimplementing cross-file resolution here to verify it would be a
    // second interpretation of resolution semantics, which `resolved` exists
    // to avoid, so this asserts against the value already recorded in the
    // golden fixture (packages/extractor/test/fixtures/v5/synthetic-foundation-dtcg/spec-layer.meta.json)
    // for this exact case instead.
    const exp = foundationDtcg(syntheticArtifact());
    expect(exp.meta['Semantic.color.surface.primary'].resolved?.Dark).toEqual({
      colorSpace: 'srgb', components: [0, 0, 0], alpha: 1, hex: '#000000',
    });
  });

  it('stores nothing for a literal token', () => {
    const exp = foundationDtcg(syntheticArtifact());
    for (const entry of Object.values(exp.meta)) {
      const rules = Object.values(entry.transform ?? {});
      if (rules.length > 0 && !rules.includes('alias')) expect(entry.resolved).toBeUndefined();
    }
  });
});

describe('the census', () => {
  const countLeaves = (node: unknown): number => {
    if (typeof node !== 'object' || node === null) return 0;
    const record = node as Record<string, unknown>;
    if ('$value' in record) return 1;
    return Object.entries(record)
      .filter(([k]) => !k.startsWith('$'))
      .reduce((sum, [, v]) => sum + countLeaves(v), 0);
  };

  it('has an entry for every emitted file', () => {
    const exp = foundationDtcg(syntheticArtifact());
    expect(Object.keys(exp.extension.census).sort())
      .toEqual(Object.keys(exp.files).sort());
  });

  it('counts exactly the tokens each file holds', () => {
    const exp = foundationDtcg(syntheticArtifact());
    for (const [file, tree] of Object.entries(exp.files)) {
      expect(exp.extension.census[file].tokens).toBe(countLeaves(tree));
    }
  });

  it('splits every file total into aliases and literals or leaves both out', () => {
    const exp = foundationDtcg(syntheticArtifact());
    for (const entry of Object.values(exp.extension.census)) {
      if (entry.aliases === undefined) {
        expect(entry.literals).toBeUndefined();
        continue;
      }
      expect(entry.aliases + (entry.literals ?? 0)).toBe(entry.tokens);
    }
  });

  it('makes the type histogram sum to the file total', () => {
    const exp = foundationDtcg(syntheticArtifact());
    for (const entry of Object.values(exp.extension.census)) {
      const sum = Object.values(entry.types).reduce((a, b) => a + b, 0);
      expect(sum).toBe(entry.tokens);
    }
  });

  it('accounts for every description', () => {
    const exp = foundationDtcg(syntheticArtifact());
    for (const entry of Object.values(exp.extension.census)) {
      expect(entry.descriptions.present + entry.descriptions.missing).toBe(entry.tokens);
    }
  });
});

describe('determinism', () => {
  it('projects the same artifact to identical bytes twice', () => {
    const options = { units: { 'A/one': 'px' as const } };
    const first = dtcgExportFiles(foundationDtcg(syntheticArtifact(), options));
    const second = dtcgExportFiles(foundationDtcg(syntheticArtifact(), options));
    expect(first).toEqual(second);
  });

  it('orders census and sidecar keys the same way on every run', () => {
    const a = foundationDtcg(syntheticArtifact());
    const b = foundationDtcg(syntheticArtifact());
    expect(Object.keys(a.extension.census)).toEqual(Object.keys(b.extension.census));
    expect(Object.keys(a.meta)).toEqual(Object.keys(b.meta));
  });
});

describe('dtcg.units overrides', () => {
  it('matches a collection whose name contains a slash by its whole name', () => {
    const artifact = syntheticArtifact();
    artifact.collections[0].name = 'Brand/Core';
    const out = foundationDtcg(artifact, { units: { 'Brand/Core/number/*': 'px' } });
    expect(leaf(out.files['brand-core.light.json'], 'Brand.Core.number.unknown-scope'))
      .toMatchObject({ $type: 'dimension', $value: { value: 1.5, unit: 'px' } });
    expect(out.report.filter((r) => r.code === 'unit_override_unmatched')).toEqual([]);
  });

  it('reports an override that names no collection, and one whose glob matches nothing', () => {
    const out = foundationDtcg(syntheticArtifact(), {
      units: { 'Nowhere/number/*': 'px', 'Primitives/no-such-token/*': 'rem' },
    });
    expect(out.report.filter((r) => r.code === 'unit_override_unmatched')).toEqual([
      expect.objectContaining({
        severity: 'info', path: 'Nowhere/number/*',
        details: { override: 'Nowhere/number/*', unit: 'px', reason: 'no_such_collection' },
      }),
      expect.objectContaining({
        severity: 'info', path: 'Primitives',
        details: { override: 'Primitives/no-such-token/*', unit: 'rem', reason: 'no_matching_token' },
      }),
    ]);
  });

  it('reports nothing for an override that named a token', () => {
    const out = foundationDtcg(syntheticArtifact(), { units: { 'Primitives/number/*': 'px' } });
    expect(out.report.filter((r) => r.code === 'unit_override_unmatched')).toEqual([]);
  });
});
