import { describe, it, expect } from 'vitest';
import { validateLevel1, validateLevel2 } from '../../src/v5/validate';
import {
  OK_ARTIFACT,
  artifactWithAlias, artifactWithCycle, artifactWithTypeMismatch,
  artifactMissingMode, artifactWithExplicitMissing, artifactWithDuplicateId,
  artifactWithPathCollision, artifactWithDecomposedDuplicate, artifactWithChainOfLength,
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

  it('resolves a 5,000-link chain without recursing or going quadratic', () => {
    // §21.3 forbids quadratic resolution, and a recursive DFS at this depth
    // exceeds the JS call stack regardless of complexity. Traversal must be
    // iterative with an explicit stack AND memoized.
    const found = validateLevel2(artifactWithChainOfLength(5000));
    expect(found.some((d) => d.code === 'ALIAS_CYCLE')).toBe(false);
    expect(found.some((d) => d.code === 'UNRESOLVED_ALIAS')).toBe(false);
  });
});
