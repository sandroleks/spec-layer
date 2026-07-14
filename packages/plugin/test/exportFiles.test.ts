import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildExportFiles, zipFiles } from '../src/exportFiles';
import type { IntermediateSpec } from '@spec-layer/extractor';

// Minimal IntermediateSpec stub carrying the field that powers the docs
// variant grid (variantInstances). Only the shape matters for serialization.
function specStub(name: string, overrides: Partial<IntermediateSpec> = {}): IntermediateSpec {
  return {
    name,
    figmaFile: 'abc123',
    anatomy: [],
    props: [],
    tokens: [],
    variants: [],
    variantInstances: [
      { nodeId: '1:2', values: { Type: 'Primary', State: 'Default' } },
    ],
    related: [],
    gaps: [],
    ...overrides,
  } as unknown as IntermediateSpec;
}

// ---------------------------------------------------------------------------
// buildExportFiles
// ---------------------------------------------------------------------------

describe('buildExportFiles', () => {
  it('produces kebab-cased filenames with folder prefix', () => {
    const result = buildExportFiles(
      [{ name: 'Text Field', markdown: '# Text Field' }],
      'my-system',
    );
    expect(Object.keys(result)).toEqual(['my-system/text-field.md']);
    expect(result['my-system/text-field.md']).toBe('# Text Field');
  });

  it('omits folder prefix when folder is empty string', () => {
    const result = buildExportFiles(
      [{ name: 'Button', markdown: '# Button' }],
      '',
    );
    expect(Object.keys(result)).toEqual(['button.md']);
  });

  it('handles empty markdown (still produces an entry)', () => {
    const result = buildExportFiles(
      [{ name: 'Empty', markdown: '' }],
      'ds',
    );
    expect(result['ds/empty.md']).toBe('');
  });

  it('handles collision: two items with the same name get -2 suffix', () => {
    const result = buildExportFiles(
      [
        { name: 'Card', markdown: 'first' },
        { name: 'Card', markdown: 'second' },
      ],
      'ds',
    );
    expect(result['ds/card.md']).toBe('first');
    expect(result['ds/card-2.md']).toBe('second');
  });

  it('handles collision: three items with the same name get -3 suffix', () => {
    const result = buildExportFiles(
      [
        { name: 'Card', markdown: 'first' },
        { name: 'Card', markdown: 'second' },
        { name: 'Card', markdown: 'third' },
      ],
      'ds',
    );
    expect(result['ds/card.md']).toBe('first');
    expect(result['ds/card-2.md']).toBe('second');
    expect(result['ds/card-3.md']).toBe('third');
  });

  it('does not let a literal "Card-2" overwrite the suffixed form of duplicate "Card"', () => {
    const result = buildExportFiles(
      [
        { name: 'Card', markdown: 'first' },
        { name: 'Card', markdown: 'second' },
        { name: 'Card-2', markdown: 'literal' },
      ],
      'ds',
    );
    // Three distinct inputs must yield three distinct files (no silent overwrite).
    expect(Object.keys(result)).toHaveLength(3);
    expect(result['ds/card.md']).toBe('first');
    expect(result['ds/card-2.md']).toBe('second');
    expect(result['ds/card-2-2.md']).toBe('literal');
  });

  it('uses "component" fallback when the name reduces to only hyphens (---)', () => {
    const result = buildExportFiles(
      [{ name: '---', markdown: 'content' }],
      'ds',
    );
    expect(Object.keys(result)).toEqual(['ds/component.md']);
  });

  it('strips trailing hyphen from slash-only Figma names (Icon/)', () => {
    const result = buildExportFiles(
      [{ name: 'Icon/', markdown: 'content' }],
      'ds',
    );
    expect(Object.keys(result)).toEqual(['ds/icon.md']);
  });

  it('handles multiple distinct names correctly', () => {
    const result = buildExportFiles(
      [
        { name: 'Button', markdown: 'btn' },
        { name: 'Text Field', markdown: 'tf' },
        { name: 'Dialog', markdown: 'dlg' },
      ],
      'design-system',
    );
    expect(result['design-system/button.md']).toBe('btn');
    expect(result['design-system/text-field.md']).toBe('tf');
    expect(result['design-system/dialog.md']).toBe('dlg');
  });

  it('handles figma hierarchy names with slashes', () => {
    const result = buildExportFiles(
      [{ name: 'Icon/Arrow Up', markdown: 'icon' }],
      'ds',
    );
    expect(result['ds/icon-arrow-up.md']).toBe('icon');
  });

  // --- spec-data sidecars (parity with "Send to docs") -----------------------
  // The docs site renders the interactive Variants grid / Anatomy / Properties
  // from the `.spec-data/<path>.json` sidecar (the full IntermediateSpec with
  // variantInstances), NOT from the markdown. "Send to docs" persists that
  // sidecar; the zip must include it too, at the same relative layout, so an
  // extracted archive renders identically.
  it('emits a .spec-data sidecar alongside the markdown when a spec is present', () => {
    const spec = specStub('Button');
    const result = buildExportFiles(
      [{ name: 'Button', markdown: '# Button', spec }],
      'design-system',
    );
    expect(result['design-system/button.md']).toBe('# Button');
    expect(result['.spec-data/design-system/button.json']).toBe(
      JSON.stringify(spec, null, 2),
    );
  });

  it('places the sidecar at .spec-data/<slug>.json when folder is empty', () => {
    const spec = specStub('Button');
    const result = buildExportFiles([{ name: 'Button', markdown: '# Button', spec }], '');
    expect(result['button.md']).toBe('# Button');
    expect(result['.spec-data/button.json']).toBe(JSON.stringify(spec, null, 2));
  });

  it('keeps sidecar slugs in lockstep with collided markdown slugs', () => {
    const a = specStub('Card', { figmaFile: 'a' });
    const b = specStub('Card', { figmaFile: 'b' });
    const result = buildExportFiles(
      [
        { name: 'Card', markdown: 'first', spec: a },
        { name: 'Card', markdown: 'second', spec: b },
      ],
      'ds',
    );
    expect(result['ds/card.md']).toBe('first');
    expect(result['ds/card-2.md']).toBe('second');
    expect(result['.spec-data/ds/card.json']).toBe(JSON.stringify(a, null, 2));
    expect(result['.spec-data/ds/card-2.json']).toBe(JSON.stringify(b, null, 2));
  });

  it('omits the sidecar when no spec is provided (legacy/raw markdown)', () => {
    const result = buildExportFiles([{ name: 'Button', markdown: '# Button' }], 'ds');
    expect(Object.keys(result)).toEqual(['ds/button.md']);
  });
});

// ---------------------------------------------------------------------------
// zipFiles — round-trip test
// ---------------------------------------------------------------------------

describe('zipFiles', () => {
  it('returns a Uint8Array', () => {
    const zip = zipFiles({ 'test.md': 'hello' });
    expect(zip).toBeInstanceOf(Uint8Array);
    expect(zip.length).toBeGreaterThan(0);
  });

  it('round-trips file contents through zip/unzip', () => {
    const files = {
      'ds/button.md': '# Button\n\nA button component.',
      'ds/text-field.md': '# Text Field\n\nA text field.',
    };
    const zipped = zipFiles(files);
    const unzipped = unzipSync(zipped);

    for (const [path, content] of Object.entries(files)) {
      expect(unzipped[path]).toBeDefined();
      expect(strFromU8(unzipped[path])).toBe(content);
    }
  });

  it('handles empty content in a file', () => {
    const zipped = zipFiles({ 'empty.md': '' });
    const unzipped = unzipSync(zipped);
    expect(strFromU8(unzipped['empty.md'])).toBe('');
  });
});
