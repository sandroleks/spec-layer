import { describe, expect, it } from 'vitest';
import type { IntermediateSpec } from '../../src/extract';
import type { TokenRule } from '../../src/tokens';
import type {
  CollectionV5, EffectStyleV5, StyleProperty, TokenV5, TypographyStyleV5,
} from '../../src/v5/entities';
import type { FoundationArtifactV5, SemanticPayload } from '../../src/v5/canonical';
import { buildEnvelope } from '../../src/v5/canonical';
import {
  buildComponentArtifactV5, componentAiContext,
  componentFoundationDependencies, componentSemanticContentHash,
  validateComponentArtifactV5,
} from '../../src/v5/componentContext';

const SOURCE = {
  provider: 'figma' as const,
  file_id: 'FILE1', file_name: 'Design System', file_version: null,
  library_enabled: null,
};

const collection = (id: string, name: string): CollectionV5 => ({
  id, name, path: [name], default_mode_id: `${id}:mode`,
  modes: [{ id: `${id}:mode`, name: 'Default', order: 0 }],
});

const literalToken = (
  id: string, collectionId: string, name: string, number: number,
): TokenV5 => ({
  id, collection_id: collectionId, name, path: name.split('/'),
  type: 'dimension', description: '', scopes: ['GAP'],
  values: {
    [`${collectionId}:mode`]: {
      kind: 'literal', value: { type: 'dimension', number, unit: 'px' },
    },
  },
});

const aliasToken = (
  id: string, collectionId: string, name: string, target: TokenV5,
): TokenV5 => ({
  id, collection_id: collectionId, name, path: name.split('/'),
  type: 'dimension', description: '', scopes: ['GAP'],
  values: {
    [`${collectionId}:mode`]: {
      kind: 'alias',
      reference: {
        target_id: target.id, target_collection_id: target.collection_id,
        target_path: target.path, external: false,
      },
      resolved: {
        status: 'resolved', value: { type: 'dimension', number: 8, unit: 'px' },
        chain: [{ token_id: target.id, mode_id: `${target.collection_id}:mode` }],
      },
    },
  },
});

const literalProperty = (resolved: StyleProperty['resolved']): StyleProperty => ({
  source: { kind: 'literal' }, resolved,
});

const typographyStyle = (token: TokenV5): TypographyStyleV5 => ({
  id: 'StyleID:text', name: 'Body/Regular', path: ['Body', 'Regular'], description: '',
  properties: {
    font_family: literalProperty({ type: 'font_family', value: 'Inter' }),
    font_weight: literalProperty({ type: 'number', value: 400 }),
    font_size: {
      source: { kind: 'alias', target_id: token.id, target_path: token.path },
      resolved: { type: 'dimension', number: 8, unit: 'px' },
    },
    line_height: literalProperty({ type: 'dimension', number: 12, unit: 'px' }),
    letter_spacing: literalProperty({ type: 'dimension', number: 0, unit: '%' }),
    paragraph_spacing: literalProperty({ type: 'dimension', number: 0, unit: 'px' }),
    paragraph_indent: literalProperty({ type: 'dimension', number: 0, unit: 'px' }),
    text_case: 'original', text_decoration: 'none',
  },
});

const effectStyle = (token: TokenV5): EffectStyleV5 => ({
  id: 'StyleID:effect', name: 'Elevation/Card', path: ['Elevation', 'Card'],
  mode_id: null,
  effects: [{
    type: 'layer_blur', visible: true,
    blur: { type: 'dimension', number: 8, unit: 'px' },
  }],
  bindings: [{ property: 'effects[0].blur', token_id: token.id }],
});

function foundation(): FoundationArtifactV5 {
  const c1 = collection('CollectionID:space', 'Space');
  const c2 = collection('CollectionID:other', 'Other');
  const base = literalToken('VariableID:base', c1.id, 'space/base', 8);
  const semantic = aliasToken('VariableID:semantic', c1.id, 'space/component', base);
  const sameName = literalToken('VariableID:same-name', c2.id, 'space/component', 99);
  const unrelated = literalToken('VariableID:unrelated', c2.id, 'space/unrelated', 20);
  const payload: SemanticPayload = {
    completeness: { collections: 'complete', styles: 'partial', unavailable_sources: [] },
    collections: [c1, c2], tokens: [base, semantic, sameName, unrelated],
    styles: {
      typography: [typographyStyle(base)],
      effects: [effectStyle(base)],
    },
  };
  return {
    ...payload,
    spec_layer: buildEnvelope(payload, {
      exportId: 'foundation:1', generatedAt: '2026-08-29T00:00:00.000Z',
      build: 'test', source: SOURCE,
    }),
    diagnostics: [], statistics: {},
  };
}

function rule(
  id: string, name: string, kind: TokenRule['kind'], property: string,
  collectionId?: string,
): TokenRule {
  return {
    id, name, kind, remote: false, ...(collectionId ? { collectionId } : {}),
    part: 'container', path: 'Container/container', property, conditions: {},
  };
}

function spec(tokens: TokenRule[]): IntermediateSpec {
  return {
    name: 'Button', figmaKey: 'ComponentKey:button', figmaFile: 'FILE1',
    figmaFileName: 'Design System', figmaNode: 'NodeID:button',
    anatomy: [], anatomyComponentId: 'NodeID:button', props: [], variants: [],
    variantInstances: [{ nodeId: 'NodeID:button', name: 'Button', values: {} }],
    states: ['Default'], tokens, related: [], gaps: [], layout: [], rawValues: [],
    nodeEffects: [],
  };
}

const META = {
  exportId: 'component:1', generatedAt: '2026-08-29T01:00:00.000Z', build: 'test',
};

describe('Component Context v5', () => {
  it('selects an exact-id variable and its transitive alias closure, never a same-named token', () => {
    const source = foundation();
    const refs = [{
      source_id: 'VariableID:semantic', name: 'space/component', kind: 'variable' as const,
      remote: false, collection_id: 'CollectionID:space', status: 'resolved' as const,
    }];
    const sliced = componentFoundationDependencies(source, refs);

    expect(sliced.tokens.map((token) => token.id)).toEqual([
      'VariableID:base', 'VariableID:semantic',
    ]);
    expect(sliced.collections.map((item) => item.id)).toEqual(['CollectionID:space']);
    expect(sliced.tokens.some((token) => token.id === 'VariableID:same-name')).toBe(false);
    expect(sliced.spec_layer.export.content_hash).not.toBe(source.spec_layer.export.content_hash);
  });

  it('validates rendered geometry against the exact token id, not the first same-named token', () => {
    const source = foundation();
    source.collections.reverse();
    source.tokens.reverse();
    const component = spec([rule(
      'VariableID:semantic', 'space/component', 'variable', 'gap', 'CollectionID:space',
    )]);
    component.layout = [{
      part: 'container', path: 'Container/container', summary: 'gap 8', values: { gap: 8 },
    }];

    const artifact = buildComponentArtifactV5(component, { ...META, foundation: source });
    expect((artifact.validation as Array<{ id: string }> | undefined) ?? [])
      .not.toContainEqual(expect.objectContaining({ id: 'geometry-token-mismatch' }));
  });

  it('adds typography/effect property dependencies but excludes unrelated styles and tokens', () => {
    const source = foundation();
    const context = buildComponentArtifactV5(spec([
      rule('StyleID:text', 'Body/Regular', 'text-style', 'typography'),
      rule('StyleID:effect', 'Elevation/Card', 'effect-style', 'effects'),
    ]), { ...META, foundation: source });

    expect(context.references.foundation?.styles.typography.map((style) => style.id))
      .toEqual(['StyleID:text']);
    expect(context.references.foundation?.styles.effects.map((style) => style.id))
      .toEqual(['StyleID:effect']);
    expect(context.references.foundation?.tokens.map((token) => token.id))
      .toEqual(['VariableID:base']);
    expect(context.references.foundation?.tokens.some((token) => token.id === 'VariableID:unrelated'))
      .toBe(false);
  });

  it('includes variable bindings nested inside inline effect fields', () => {
    const component = spec([]);
    component.nodeEffects = [{
      part: 'container', path: 'Container/container',
      effects: [{
        type: 'drop-shadow', visible: true, blendMode: 'NORMAL',
        color: { hex: '#000000', alpha: 0.2 }, offset: { x: 0, y: 2 }, radius: 8,
        bindings: { color: {
          id: 'VariableID:base', name: 'space/base', kind: 'variable', remote: false,
          collectionId: 'CollectionID:space',
        } },
      }],
    }];

    const artifact = buildComponentArtifactV5(component, { ...META, foundation: foundation() });
    expect(artifact.references.used).toContainEqual(expect.objectContaining({
      source_id: 'VariableID:base', status: 'resolved',
    }));
    expect(artifact.references.bindings).toContainEqual(expect.objectContaining({
      path: 'Container/container', property: 'effects[0].color',
      source_id: 'VariableID:base',
    }));
    expect(artifact.references.foundation?.tokens.map((token) => token.id))
      .toEqual(['VariableID:base']);
    expect(componentAiContext(artifact).effects_inline).toEqual([expect.objectContaining({
      layers: [expect.objectContaining({
        bindings: {
          color: expect.objectContaining({ source_id: 'VariableID:base' }),
        },
      })],
    })]);
  });

  it('hashes semantic facts, not export metadata or generated guidelines', () => {
    const source = foundation();
    const component = spec([rule(
      'VariableID:semantic', 'space/component', 'variable', 'gap', 'CollectionID:space',
    )]);
    const first = buildComponentArtifactV5(component, {
      ...META, foundation: source,
      prose: { definition: 'A button.', accessibility: '', dos: [], donts: [] },
    });
    const second = buildComponentArtifactV5(component, {
      ...META, exportId: 'component:2', generatedAt: '2026-08-30T01:00:00.000Z',
      foundation: source,
      prose: { definition: 'New generated wording.', accessibility: '', dos: [], donts: [] },
    });

    expect(first.spec_layer.export.content_hash).toBe(second.spec_layer.export.content_hash);
    expect(first.spec_layer.export.id).not.toBe(second.spec_layer.export.id);
    expect(first.guidelines).not.toEqual(second.guidelines);
  });

  it('does not move a component hash for an unrelated Foundation read failure', () => {
    const complete = foundation();
    const partial = structuredClone(complete);
    partial.completeness.collections = 'partial';
    partial.completeness.unavailable_sources = ['VariableID:outside-component'];
    const component = spec([rule(
      'VariableID:semantic', 'space/component', 'variable', 'gap', 'CollectionID:space',
    )]);

    const first = buildComponentArtifactV5(component, { ...META, foundation: complete });
    const second = buildComponentArtifactV5(component, { ...META, foundation: partial });
    expect(second.references.foundation?.completeness.collections).toBe('complete');
    expect(second.spec_layer.export.content_hash).toBe(first.spec_layer.export.content_hash);
  });

  it('emits exact source ids and a self-contained compact dependency slice', () => {
    const source = foundation();
    source.diagnostics.push({
      code: 'UNIT_METADATA_UNAVAILABLE', severity: 'error', entity_id: 'VariableID:semantic',
      message: 'The source does not state one unit.',
    });
    const artifact = buildComponentArtifactV5(spec([rule(
      'VariableID:semantic', 'space/component', 'variable', 'gap', 'CollectionID:space',
    )]), { ...META, foundation: source });
    const ai = componentAiContext(artifact);
    const dependency = ai.references.foundation as unknown as {
      collections: Array<{ source_id: string; tokens: Array<{ source_id: string }> }>;
      issue_counts: { error: { UNIT_METADATA_UNAVAILABLE: number } };
    };

    expect(ai.spec_layer).toMatchObject({
      kind: 'component', version: 5, profile: 'ai',
      foundation_hash: source.spec_layer.export.content_hash,
    });
    expect(ai.references.used[0]).toMatchObject({
      source_id: 'VariableID:semantic', status: 'resolved',
    });
    expect(dependency.collections[0].source_id).toBe('CollectionID:space');
    expect(dependency.collections[0].tokens.map((token) => token.source_id)).toEqual([
      'VariableID:base', 'VariableID:semantic',
    ]);
    expect(dependency.issue_counts.error.UNIT_METADATA_UNAVAILABLE).toBe(1);
  });

  it('groups otherwise-identical AI bindings by path without changing canonical bindings', () => {
    const first = rule(
      'VariableID:semantic', 'space/component', 'variable', 'fill', 'CollectionID:space',
    );
    first.path = 'Container/Icon A';
    first.conditions = { type: ['Primary'], disabled: ['False'] };
    const second = structuredClone(first);
    second.path = 'Container/Icon B';
    const differentCondition = structuredClone(first);
    differentCondition.path = 'Container/Icon C';
    differentCondition.conditions = { type: ['Primary'], disabled: ['True'] };
    const artifact = buildComponentArtifactV5(
      spec([first, second, differentCondition]), { ...META, foundation: foundation() },
    );
    const canonicalHash = artifact.spec_layer.export.content_hash;

    expect(artifact.references.bindings.map((binding) => binding.path)).toEqual([
      'Container/Icon A', 'Container/Icon B', 'Container/Icon C',
    ]);
    const ai = componentAiContext(artifact);
    expect(ai.references.bindings).toEqual([
      {
        paths: ['Container/Icon A', 'Container/Icon B'],
        property: 'fill', source_id: 'VariableID:semantic', kind: 'variable',
        when: { type: ['Primary'], disabled: ['False'] },
      },
      {
        path: 'Container/Icon C',
        property: 'fill', source_id: 'VariableID:semantic', kind: 'variable',
        when: { type: ['Primary'], disabled: ['True'] },
      },
    ]);
    expect(artifact.references.bindings.map((binding) => binding.path)).toEqual([
      'Container/Icon A', 'Container/Icon B', 'Container/Icon C',
    ]);
    expect(componentSemanticContentHash(artifact)).toBe(canonicalHash);
  });

  it('states no-foundation and unavailable references instead of resolving by name', () => {
    const noFoundation = buildComponentArtifactV5(spec([rule(
      'VariableID:missing', 'space/component', 'variable', 'gap', 'CollectionID:space',
    )]), META);
    expect(noFoundation.references.used[0].status).toBe('no_foundation');
    expect(noFoundation.diagnostics).toMatchObject([{
      code: 'UNRESOLVED_REFERENCE', severity: 'warning', entity_id: 'VariableID:missing',
    }]);
    expect(componentAiContext(noFoundation).references.foundation).toEqual({ status: 'not_read' });

    const source = foundation();
    source.completeness.unavailable_sources.push('VariableID:missing');
    const unavailable = buildComponentArtifactV5(spec([rule(
      'VariableID:missing', 'space/component', 'variable', 'gap', 'CollectionID:space',
    )]), { ...META, foundation: source });
    expect(unavailable.references.used[0].status).toBe('unavailable');
  });

  it('reports a binding whose used reference was removed after construction', () => {
    const artifact = buildComponentArtifactV5(spec([rule(
      'VariableID:semantic', 'space/component', 'variable', 'gap', 'CollectionID:space',
    )]), { ...META, foundation: foundation() });
    artifact.references.used = [];

    expect(validateComponentArtifactV5(artifact)).toContainEqual(expect.objectContaining({
      code: 'INCONSISTENT_REFERENCE', severity: 'error',
    }));
  });
});
