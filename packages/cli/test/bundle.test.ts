import { describe, it, expect } from 'vitest';
import { parseBundle } from '../src/bundle';

const GOOD = {
  schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'DS',
  pluginVersion: '5.0.0', extractorVersion: '2',
  foundation: { ai: 'a: 1\n', artifact: { spec_layer: { export: { content_hash: 'f'.repeat(64) } } } },
  components: [{ name: 'Button', ai: 'b: 2\n', artifact: { spec_layer: { export: { content_hash: 'c'.repeat(64) } } } }],
};

describe('parseBundle', () => {
  it('parses a valid bundle', () => {
    const b = parseBundle(JSON.stringify(GOOD));
    expect(b.components[0].name).toBe('Button');
    expect(b.foundation?.ai).toBe('a: 1\n');
  });

  it('accepts a null foundation', () => {
    const withNullFoundation = { ...GOOD, foundation: null };
    const b = parseBundle(JSON.stringify(withNullFoundation));
    expect(b.foundation).toBeNull();
    expect(b.components[0].name).toBe('Button');
  });

  it('rejects non-JSON', () => {
    expect(() => parseBundle('nope')).toThrow(/not valid JSON/);
  });

  it('rejects a wrong schema', () => {
    const wrongSchema = { ...GOOD, schema: 'other' };
    expect(() => parseBundle(JSON.stringify(wrongSchema))).toThrow(/not a Spec Layer library bundle/);
  });

  it('rejects a component without name, ai, or content hash', () => {
    const missingName = {
      ...GOOD,
      components: [{ ai: 'b: 2\n', artifact: { spec_layer: { export: { content_hash: 'c'.repeat(64) } } } }],
    };
    expect(() => parseBundle(JSON.stringify(missingName))).toThrow();

    const missingAi = {
      ...GOOD,
      components: [{ name: 'Button', artifact: { spec_layer: { export: { content_hash: 'c'.repeat(64) } } } }],
    };
    expect(() => parseBundle(JSON.stringify(missingAi))).toThrow();

    const missingHash = {
      ...GOOD,
      components: [{ name: 'Button', ai: 'b: 2\n', artifact: { spec_layer: { export: {} } } }],
    };
    expect(() => parseBundle(JSON.stringify(missingHash))).toThrow();
  });
});
