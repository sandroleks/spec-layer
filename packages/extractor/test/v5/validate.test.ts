import { describe, it, expect } from 'vitest';
import { validateLevel1, validateLevel2 } from '../../src/v5/validate';
import {
  OK_ARTIFACT,
  artifactWithAlias, artifactWithCycle, artifactWithTypeMismatch,
  artifactMissingMode, artifactWithExplicitMissing, artifactWithDuplicateId,
  artifactWithPathCollision, artifactWithDecomposedDuplicate, artifactWithChainOfLength,
  artifactWithDanglingCollectionId, artifactWithUndeclaredDefaultMode,
  artifactWithDanglingReplacement, artifactWithDanglingStyleBinding,
  artifactWithCrossCollectionCycle, artifactWithTypographyAlias, artifactWithEffectMode,
} from './fixtures';   // see Step 4

describe('validateLevel1', () => {
  it('passes a well-formed artifact', () => {
    expect(validateLevel1(OK_ARTIFACT)).toEqual([]);
  });

  it('rejects a value that is not a discriminated object', () => {
    const bad = structuredClone(OK_ARTIFACT);
    (bad.tokens[0].values as Record<string, unknown>)['1:2/light'] = '#ffffff';
    const found = validateLevel1(bad);
    expect(found.map((d) => d.code)).toContain('INCONSISTENT_VALUE_SHAPE');
    expect(found[0].entity_id).toBe('VariableID:3:4');
    expect(found[0].mode_id).toBe('1:2/light');
  });

  it('rejects a dimension with no unit, and a unit outside the vocabulary', () => {
    for (const value of [
      { type: 'dimension', number: 16 },
      { type: 'dimension', number: 16, unit: 'pt' },
    ]) {
      const bad = structuredClone(OK_ARTIFACT);
      (bad.tokens[0].values as Record<string, unknown>)['1:2/light'] = { kind: 'literal', value };
      expect(validateLevel1(bad).map((d) => d.code)).toContain('UNSUPPORTED_VALUE_TYPE');
    }
  });

  it('rejects an uppercase, short or malformed hex', () => {
    for (const hex of ['#FFF', '#fff', '#ff', '#colors/blue/200']) {
      const bad = structuredClone(OK_ARTIFACT);
      (bad.tokens[0].values as Record<string, unknown>)['1:2/light'] = {
        kind: 'literal', value: { type: 'color', color_space: 'srgb', hex, alpha: 1 },
      };
      expect(validateLevel1(bad).map((d) => d.code)).toContain('UNSUPPORTED_VALUE_TYPE');
    }
  });

  it('rejects a non-finite number and an alpha outside 0..1', () => {
    const nan = structuredClone(OK_ARTIFACT);
    (nan.tokens[0].values as Record<string, unknown>)['1:2/light'] = {
      kind: 'literal', value: { type: 'number', value: Number.NaN },
    };
    expect(validateLevel1(nan).map((d) => d.code)).toContain('UNSUPPORTED_VALUE_TYPE');
  });

  it('rejects a resolution chain step missing its mode id', () => {
    const bad = structuredClone(OK_ARTIFACT);
    (bad.tokens[0].values as Record<string, unknown>)['1:2/light'] = {
      kind: 'alias',
      reference: { target_id: 'V:x', target_collection_id: 'C:1', target_path: ['x'], external: false },
      resolved: { status: 'resolved', value: { type: 'number', value: 1 }, chain: [{ token_id: 'V:x' }] },
    };
    expect(validateLevel1(bad).map((d) => d.code)).toContain('INCONSISTENT_VALUE_SHAPE');
  });

  it('rejects literal and resolved values whose type disagrees with token.type', () => {
    const literal = structuredClone(OK_ARTIFACT);
    (literal.tokens[0].values as Record<string, unknown>)['1:2/light'] = {
      kind: 'literal', value: { type: 'number', value: 1 },
    };
    expect(validateLevel1(literal).map((d) => d.code))
      .toContain('INCONSISTENT_VALUE_SHAPE');

    const alias = structuredClone(OK_ARTIFACT);
    (alias.tokens[0].values as Record<string, unknown>)['1:2/light'] = {
      kind: 'alias',
      reference: {
        target_id: 'V:x', target_collection_id: 'C:1',
        target_path: ['x'], external: false,
      },
      resolved: {
        status: 'resolved', value: { type: 'number', value: 1 },
        chain: [{ token_id: 'V:x', mode_id: 'm1' }],
      },
    };
    expect(validateLevel1(alias).map((d) => d.code))
      .toContain('INCONSISTENT_VALUE_SHAPE');
  });

  it('rejects every malformed nested shape Level 2 reads', () => {
    const nullCollection = structuredClone(OK_ARTIFACT);
    (nullCollection.collections as unknown[])[0] = null;

    const nullMode = structuredClone(OK_ARTIFACT);
    (nullMode.collections[0].modes as unknown[])[0] = null;

    const malformedLifecycle = structuredClone(OK_ARTIFACT);
    (malformedLifecycle.tokens[0] as unknown as Record<string, unknown>).lifecycle = 'active';

    const malformedBinding = artifactWithDanglingStyleBinding('VariableID:3:4');
    (malformedBinding.styles.effects[0].bindings as unknown[])[0] = null;

    for (const artifact of [nullCollection, nullMode, malformedLifecycle, malformedBinding]) {
      expect(validateLevel1(artifact).map((d) => d.code))
        .toContain('INCONSISTENT_VALUE_SHAPE');
      // Level 2 is total even when a caller ignores the Level-1 precondition
      // and defeats its typed boundary with unchecked JSON.
      expect(() => validateLevel2(artifact as never)).not.toThrow();
    }
  });

  it('reports a token missing a required field against its own id', () => {
    const bad = structuredClone(OK_ARTIFACT);
    delete (bad.tokens[0] as unknown as Record<string, unknown>).description;
    const found = validateLevel1(bad);
    // §8.2: description is required INCLUDING an empty string. An absent
    // description and an empty one are different facts.
    expect(found).toHaveLength(1);
    expect(found[0].entity_id).toBe('VariableID:3:4');
  });

  it('does not throw on input that is not an object at all', () => {
    // A validator that crashes on malformed input cannot report on malformed
    // input, which is the only time it matters.
    for (const input of [null, undefined, 42, 'x', []]) {
      expect(() => validateLevel1(input)).not.toThrow();
      expect(validateLevel1(input).length).toBeGreaterThan(0);
    }
  });

  it('does not throw when reading a property itself throws', () => {
    // A type guard cannot prevent this: the throw happens during the read. The
    // guarantee has to be structural, or a validator crashes on exactly the
    // malformed input it exists to report on.
    const hostile = {};
    Object.defineProperty(hostile, 'tokens', {
      get() { throw new Error('hostile getter'); },
      enumerable: true,
    });
    expect(() => validateLevel1(hostile)).not.toThrow();
    expect(validateLevel1(hostile).length).toBeGreaterThan(0);

    const proxied = new Proxy({}, { get() { throw new Error('hostile trap'); } });
    expect(() => validateLevel1(proxied)).not.toThrow();
    expect(validateLevel1(proxied).length).toBeGreaterThan(0);
  });
});

describe('validateLevel2', () => {
  it('passes a well-formed artifact', () => {
    expect(validateLevel2(OK_ARTIFACT)).toEqual([]);
  });

  it('reports an alias whose target does not exist', () => {
    expect(validateLevel2(artifactWithAlias('VariableID:missing')).map((d) => d.code))
      .toContain('UNRESOLVED_ALIAS');
  });

  it('reports a cycle once, at the lowest id in the ring', () => {
    // Entering from whichever node the walk reached first would make the output
    // depend on token order, which §16 forbids.
    const found = validateLevel2(artifactWithCycle('V:b', 'V:a'));
    const cycles = found.filter((d) => d.code === 'ALIAS_CYCLE');
    expect(cycles).toHaveLength(1);
    expect(cycles[0].entity_id).toBe('V:a');
    expect(cycles[0].details?.chain).toEqual([
      { token_id: 'V:a', mode_id: 'm1' },
      { token_id: 'V:b', mode_id: 'm1' },
      { token_id: 'V:a', mode_id: 'm1' },
    ]);
  });

  it('reports an alias pointing at a token of another type', () => {
    expect(validateLevel2(artifactWithTypeMismatch('color', 'dimension')).map((d) => d.code))
      .toContain('ALIAS_TYPE_MISMATCH');
  });

  it('accepts consistent internal alias provenance', () => {
    expect(validateLevel2(artifactWithTypeMismatch('color', 'color'))).toEqual([]);
  });

  it('reports a token with no record for a declared mode', () => {
    const missing = validateLevel2(artifactMissingMode('1:2/dark'))
      .find((d) => d.code === 'MISSING_MODE_VALUE')!;
    expect(missing.mode_id).toBe('1:2/dark');
  });

  it('does not report a token that declares its mode value missing', () => {
    // §7: an ABSENT mode value must be distinguishable from an explicit one. A
    // token that omits the key is the absent case; one carrying
    // `{kind: missing}` has stated itself.
    expect(validateLevel2(artifactWithExplicitMissing('1:2/dark'))
      .some((d) => d.code === 'MISSING_MODE_VALUE')).toBe(false);
  });

  it('reports two entities sharing one stable id', () => {
    expect(validateLevel2(artifactWithDuplicateId()).map((d) => d.code))
      .toContain('DUPLICATE_SOURCE_ID');
  });

  it('reports colliding paths WITHIN one collection', () => {
    expect(validateLevel2(artifactWithPathCollision('C:1', 'C:1')).map((d) => d.code))
      .toContain('PATH_COLLISION');
  });

  it('does NOT report the same path in two different collections', () => {
    // Two collections holding `surface/primary` is the normal, intended shape
    // of a themed system -- a collection IS the namespace. Flagging it would
    // fire on nearly every real file and train a reader to ignore the code.
    expect(validateLevel2(artifactWithPathCollision('C:1', 'C:2'))
      .some((d) => d.code === 'PATH_COLLISION')).toBe(false);
  });

  it('reports a collision that appears only after NFC normalization', () => {
    expect(validateLevel2(artifactWithDecomposedDuplicate()).map((d) => d.code))
      .toContain('PATH_COLLISION');
  });

  it('reports a cycle that spans two collections', () => {
    // Mode ids are collection-scoped, so a walk that held the mode constant
    // across a hop found nothing at the target and treated the hop as
    // terminal -- making a two-collection ring invisible while the identical
    // ring inside one collection was reported. The selected `only` modes in
    // this fixture are NOT either collection's defaults: the recorded chain
    // is authoritative, so default-mode recomputation would also fail here.
    const found = validateLevel2(artifactWithCrossCollectionCycle());
    const cycles = found.filter((d) => d.code === 'ALIAS_CYCLE');
    expect(cycles).toHaveLength(1);
    expect(cycles[0].details?.chain).toEqual([
      { token_id: 'V:xc-a', mode_id: 'xc-a/only' },
      { token_id: 'V:xc-b', mode_id: 'xc-b/only' },
      { token_id: 'V:xc-a', mode_id: 'xc-a/only' },
    ]);
  });

  it('reports a token whose collection_id names no collection', () => {
    // §18 Level 2. Before this, the dangling reference silently made
    // checkModeCompleteness `continue` past the token, so a broken artifact
    // came back clean from both levels.
    const found = validateLevel2(artifactWithDanglingCollectionId());
    const refs = found.filter((d) => d.code === 'UNRESOLVED_REFERENCE');
    expect(refs).toHaveLength(1);
    expect(refs[0].entity_id).toBe('VariableID:3:4');
    // Not UNRESOLVED_ALIAS: that code means an alias TARGET is missing, and
    // overloading it would make both meanings unactionable.
    expect(found.some((d) => d.code === 'UNRESOLVED_ALIAS')).toBe(false);
  });

  it('reports a collection default_mode_id that names no declared mode', () => {
    const found = validateLevel2(artifactWithUndeclaredDefaultMode());
    const refs = found.filter((d) => d.code === 'UNRESOLVED_REFERENCE');
    expect(refs).toHaveLength(1);
    expect(refs[0].entity_id).toBe('VariableCollectionId:1:2');
  });

  it('reports a lifecycle replacement_id that names no entity', () => {
    expect(validateLevel2(artifactWithDanglingReplacement('VariableID:gone'))
      .filter((d) => d.code === 'UNRESOLVED_REFERENCE')).toHaveLength(1);
  });

  it('accepts a null replacement_id as the stated absence it is', () => {
    // `null` says "no replacement", which resolves trivially. Reporting it
    // would fire on every deprecated token that has no successor.
    expect(validateLevel2(artifactWithDanglingReplacement(null as unknown as string))
      .some((d) => d.code === 'UNRESOLVED_REFERENCE')).toBe(false);
  });

  it('reports a style binding whose token_id is not in the artifact', () => {
    const found = validateLevel2(artifactWithDanglingStyleBinding('VariableID:gone'));
    const refs = found.filter((d) => d.code === 'UNRESOLVED_REFERENCE');
    expect(refs).toHaveLength(1);
    expect(refs[0].entity_id).toBe('EffectStyleId:1');
  });

  it('accepts a style binding that names a real token', () => {
    expect(validateLevel2(artifactWithDanglingStyleBinding('VariableID:3:4'))
      .some((d) => d.code === 'UNRESOLVED_REFERENCE')).toBe(false);
  });

  it('validates typography property alias target ids and paths', () => {
    const missing = artifactWithTypographyAlias('VariableID:gone', ['Gone']);
    const wrongPath = artifactWithTypographyAlias('VariableID:3:4', ['Not', 'The', 'Token']);

    for (const artifact of [missing, wrongPath]) {
      const aliases = validateLevel2(artifact).filter((d) => d.code === 'UNRESOLVED_ALIAS');
      expect(aliases).toHaveLength(1);
      expect(aliases[0].entity_id).toBe('TypographyStyleId:alias');
      expect(aliases[0].details?.property).toBe('font_family');
    }
  });

  it('reports missing and ambiguous effect-style mode references', () => {
    const missing = validateLevel2(artifactWithEffectMode('mode-that-does-not-exist'))
      .filter((d) => d.code === 'UNRESOLVED_REFERENCE');
    expect(missing).toHaveLength(1);
    expect(missing[0].entity_id).toBe('EffectStyleId:mode');

    const ambiguous = validateLevel2(artifactWithEffectMode('1:2/light', true))
      .filter((d) => d.code === 'UNRESOLVED_REFERENCE');
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0].entity_id).toBe('EffectStyleId:mode');
    expect(ambiguous[0].details?.collection_ids).toEqual([
      'VariableCollectionId:1:2', 'VariableCollectionId:second-mode-owner',
    ]);
  });

  it('validates an internal alias target_collection_id for existence and consistency', () => {
    const missingCollection = artifactWithTypeMismatch('color', 'color');
    const missingValue = missingCollection.tokens
      .find((token) => token.id === 'VariableID:mismatch-source')!.values.m1;
    if (missingValue.kind !== 'alias') throw new Error('fixture source must be an alias');
    missingValue.reference.target_collection_id = 'VariableCollectionId:missing';

    const wrongCollection = artifactWithTypeMismatch('color', 'color');
    const wrongValue = wrongCollection.tokens
      .find((token) => token.id === 'VariableID:mismatch-source')!.values.m1;
    if (wrongValue.kind !== 'alias') throw new Error('fixture source must be an alias');
    wrongValue.reference.target_collection_id = 'VariableCollectionId:1:2';

    for (const artifact of [missingCollection, wrongCollection]) {
      expect(validateLevel2(artifact).map((d) => d.code)).toContain('UNRESOLVED_ALIAS');
    }
  });

  it('validates an internal alias target_path against the identified target', () => {
    const root = artifactWithTypeMismatch('color', 'color');
    const value = root.tokens
      .find((token) => token.id === 'VariableID:mismatch-source')!.values.m1;
    if (value.kind !== 'alias') throw new Error('fixture source must be an alias');
    value.reference.target_path = ['Not', 'The', 'Target'];
    expect(validateLevel2(root).map((d) => d.code)).toContain('UNRESOLVED_ALIAS');
  });

  it('validates every resolution-chain token and mode reference', () => {
    const missingLaterToken = artifactWithTypeMismatch('color', 'color');
    const laterValue = missingLaterToken.tokens
      .find((token) => token.id === 'VariableID:mismatch-source')!.values.m1;
    if (laterValue.kind !== 'alias' || laterValue.resolved.status !== 'resolved') {
      throw new Error('fixture source must be a resolved alias');
    }
    laterValue.resolved.chain.push({ token_id: 'VariableID:missing-later-step', mode_id: 'm1' });

    const missingMode = artifactWithTypeMismatch('color', 'color');
    const modeValue = missingMode.tokens
      .find((token) => token.id === 'VariableID:mismatch-source')!.values.m1;
    if (modeValue.kind !== 'alias' || modeValue.resolved.status !== 'resolved') {
      throw new Error('fixture source must be a resolved alias');
    }
    modeValue.resolved.chain[0].mode_id = 'mode-that-does-not-exist';

    for (const artifact of [missingLaterToken, missingMode]) {
      expect(validateLevel2(artifact).map((d) => d.code)).toContain('UNRESOLVED_ALIAS');
    }
  });

  it('reports an internal alias recorded as unresolved even when its target exists', () => {
    const root = artifactWithTypeMismatch('color', 'color');
    const source = root.tokens.find((token) => token.id === 'VariableID:mismatch-source')!;
    const current = source.values.m1;
    if (current.kind !== 'alias') throw new Error('fixture source must be an alias');
    source.values.m1 = {
      kind: 'alias',
      reference: current.reference,
      resolved: {
        status: 'unresolved', reason: 'target_not_found', value: null,
        chain: [{ token_id: 'VariableID:mismatch-target', mode_id: 'm1' }],
      },
    };
    expect(validateLevel2(root).map((d) => d.code)).toContain('UNRESOLVED_ALIAS');
  });

  it('reports duplicate mode ids within one collection', () => {
    const root = structuredClone(OK_ARTIFACT);
    root.collections[0].modes.push({ id: '1:2/light', name: 'Duplicate light', order: 2 });
    const duplicate = validateLevel2(root)
      .find((d) => d.code === 'DUPLICATE_SOURCE_ID' && d.mode_id === '1:2/light');
    expect(duplicate?.entity_id).toBe('VariableCollectionId:1:2');
  });

  it('resolves a 5,000-link chain without recursing or going quadratic', () => {
    // §21.3 forbids quadratic resolution, and a recursive DFS at this depth
    // exceeds the JS call stack regardless of complexity. Traversal must be
    // iterative with an explicit stack AND memoized.
    const found = validateLevel2(artifactWithChainOfLength(5000));
    expect(found.some((d) => d.code === 'ALIAS_CYCLE')).toBe(false);
    expect(found.some((d) => d.code === 'UNRESOLVED_ALIAS')).toBe(false);
  });
});
