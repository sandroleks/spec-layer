import { describe, it, expect } from 'vitest';
import {
  LIBRARY_BUNDLE_SCHEMA, LIBRARY_BUNDLE_VERSION, LibraryBundleError, parseLibraryBundle,
} from '../src/libraryBundle';

const artifact = (hash: string) => ({ spec_layer: { export: { content_hash: hash.repeat(64) } } });

const GOOD = {
  schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'DS',
  pluginVersion: '5.0.0', extractorVersion: '2',
  foundation: { ai: 'a: 1\n', artifact: artifact('f') },
  components: [{ name: 'Button', ai: 'b: 2\n', artifact: artifact('c') }],
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof LibraryBundleError) return err.code;
    throw err;
  }
  throw new Error('expected a LibraryBundleError');
}

describe('parseLibraryBundle', () => {
  it('names the schema and version the plugin writes', () => {
    expect(LIBRARY_BUNDLE_SCHEMA).toBe('spec-layer-library-bundle');
    expect(LIBRARY_BUNDLE_VERSION).toBe('1.0.0');
  });

  it('parses a valid bundle from a string or an already-parsed value', () => {
    const fromString = parseLibraryBundle(JSON.stringify(GOOD));
    expect(fromString.components[0].name).toBe('Button');
    expect(fromString.foundation?.ai).toBe('a: 1\n');
    expect(parseLibraryBundle(GOOD)).toEqual(fromString);
  });

  it('normalizes optional fields: missing fileName and pluginVersion become null', () => {
    const { fileName: _f, pluginVersion: _p, ...rest } = GOOD;
    const bundle = parseLibraryBundle({ ...rest, foundation: null });
    expect(bundle.fileName).toBeNull();
    expect(bundle.pluginVersion).toBeNull();
    expect(bundle.foundation).toBeNull();
  });

  it('reports not_json for a string that is not JSON', () => {
    expect(codeOf(() => parseLibraryBundle('nope'))).toBe('not_json');
  });

  it('reports not_bundle for the wrong schema or a non-object', () => {
    expect(codeOf(() => parseLibraryBundle({ ...GOOD, schema: 'other' }))).toBe('not_bundle');
    expect(codeOf(() => parseLibraryBundle([]))).toBe('not_bundle');
    expect(codeOf(() => parseLibraryBundle(null))).toBe('not_bundle');
  });

  it('accepts any 1.x version and rejects other majors as unsupported_version', () => {
    expect(parseLibraryBundle({ ...GOOD, version: '1.4.2' }).version).toBe('1.4.2');
    expect(codeOf(() => parseLibraryBundle({ ...GOOD, version: '2.0.0' }))).toBe('unsupported_version');
    expect(codeOf(() => parseLibraryBundle({ ...GOOD, version: 'latest' }))).toBe('unsupported_version');
  });

  it('reports malformed when required fields or entries are wrong', () => {
    const { extractorVersion: _e, ...noExtractor } = GOOD;
    expect(codeOf(() => parseLibraryBundle(noExtractor))).toBe('malformed');
    expect(codeOf(() => parseLibraryBundle({ ...GOOD, components: 'Button' }))).toBe('malformed');
    expect(codeOf(() => parseLibraryBundle({ ...GOOD, foundation: { ai: 1, artifact: artifact('f') } }))).toBe('malformed');
    expect(codeOf(() => parseLibraryBundle({
      ...GOOD, components: [{ name: 'Button', ai: 'b\n', artifact: { spec_layer: { export: {} } } }],
    }))).toBe('malformed');
  });

  it('keeps the message plain and specific', () => {
    expect(() => parseLibraryBundle({ ...GOOD, version: '2.0.0' })).toThrow(/version 2\.0\.0/);
    expect(() => parseLibraryBundle({
      ...GOOD, components: [GOOD.components[0], { name: 'Card', artifact: artifact('d') }],
    })).toThrow(/component 1/);
  });
});
