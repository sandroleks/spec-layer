import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  buildSingleExportBundle,
  createState,
  refreshRenderedSpecFileKey,
} from '../src/ui/actions';
import type { IntermediateSpec, SerializedNode } from '@spec-layer/extractor';

const node: SerializedNode = {
  id: '12:34',
  name: 'Button',
  type: 'COMPONENT',
  visible: true,
  key: 'component-key',
  children: [],
};

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
  };
}

describe('refreshRenderedSpecFileKey', () => {
  it('regenerates an existing extracted spec with the new file key', () => {
    const state = createState();
    state.currentNode = node;
    state.currentFileKey = 'unknown';
    state.currentSpec = {
      name: 'Button',
      figmaKey: 'component-key',
      figmaFile: 'unknown',
      figmaNode: '12:34',
      anatomy: [], anatomyComponentId: '',
      props: [],
      variants: [],
      variantInstances: [],
      states: [],
      tokens: [],
      related: [],
      gaps: [],
      layout: [],
    };
    state.renderedMd = 'stale markdown';

    refreshRenderedSpecFileKey(state, 'REALKEY');

    expect(state.currentFileKey).toBe('REALKEY');
    expect(state.currentSpec?.figmaFile).toBe('REALKEY');
    expect(state.renderedMd).toContain('figma_file: REALKEY');
  });

  it('only updates connection state before a spec has been extracted', () => {
    const state = createState();
    state.currentNode = node;

    refreshRenderedSpecFileKey(state, 'REALKEY');

    expect(state.currentFileKey).toBe('REALKEY');
    expect(state.currentSpec).toBeNull();
    expect(state.renderedMd).toBe('');
  });
});

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
