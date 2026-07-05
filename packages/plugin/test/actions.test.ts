import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildSingleExportBundle } from '../src/ui/actions';
import type { IntermediateSpec } from '@spec-layer/extractor';

function specStub(name = 'Button'): IntermediateSpec {
  return {
    name,
    figmaKey: 'component-key',
    figmaFile: 'file-key',
    figmaNode: '12:34',
    anatomy: [], anatomyComponentId: '',
    props: [],
    variants: [],
    variantInstances: [
      { nodeId: '12:35', name: 'Primary', values: { Type: 'Primary' } },
    ],
    states: [],
    tokens: [],
    related: [],
    gaps: [],
    layout: [],
    rawValues: [],
  };
}

describe('buildSingleExportBundle', () => {
  it('builds a single-component zip bundle containing markdown and sidecar', () => {
    const spec = specStub('Button');
    const bundle = buildSingleExportBundle('# Edited Button', spec, 'Button');

    expect(bundle.filename).toBe('button.spec-layer.zip');

    const unzipped = unzipSync(bundle.bytes);
    expect(strFromU8(unzipped['button.md'])).toBe('# Edited Button');
    expect(JSON.parse(strFromU8(unzipped['.spec-data/button.json']))).toEqual(spec);
  });
});
