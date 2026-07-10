import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildSingleExportBundle, proseNeedsRegen, type UiState } from '../src/ui/actions';
import type { IntermediateSpec, ProseKey } from '@spec-layer/extractor';

describe('proseNeedsRegen', () => {
  const withDraft = (keys: ProseKey[]): UiState => ({
    generatedProse: { definition: 'd', accessibility: '', dos: [], donts: [] },
    generatedProseKeys: new Set(keys),
  } as unknown as UiState);

  it('regenerates when the cached draft misses a requested key', () => {
    expect(proseNeedsRegen(withDraft(['definition']), new Set(['definition', 'interactions']))).toBe(true);
  });
  it('reuses when the cached draft covers the request', () => {
    expect(proseNeedsRegen(withDraft(['definition', 'interactions']), new Set(['interactions']))).toBe(false);
  });
  it('regenerates when there is no draft yet', () => {
    expect(proseNeedsRegen({ generatedProse: null, generatedProseKeys: null } as unknown as UiState, new Set(['definition']))).toBe(true);
  });
});

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
