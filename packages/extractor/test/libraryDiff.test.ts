import { describe, it, expect } from 'vitest';
import {
  bumpFor, compareBump, isSemver, nextVersion, compareChanges, libraryDiff,
  type ChangeEntity, type ChangeKind, type LibraryChange, type LibraryDiff,
} from '../src/libraryDiff';
import type { LibraryBundleV1 } from '../src/libraryBundle';

/** A component artifact with the v5 fields the diff reads, and nothing it must ignore left out. */
function componentArtifact(over: Record<string, unknown> = {}) {
  return {
    spec_layer: {
      kind: 'component', schema_version: '5.2.0',
      export: { id: 'export:1', generated_at: '2026-09-12T00:00:00.000Z', deterministic: true, content_hash: 'c1' },
      source: { provider: 'figma', node_id: '1:1', node_name: 'Button', component_key: 'key-button' },
    },
    component: { name: 'Button' },
    api: {
      variants: { size: { options: ['Small', 'Large'], default: 'Small' } },
      states: ['Hover'],
      booleans: { showIcon: { default: false } },
      slots: { label: { type: 'text', default: 'Button' } },
    },
    anatomy: [{ part: 'Container', path: 'Container', type: 'FRAME', children: [
      { part: 'Label', path: 'Container/Label', type: 'TEXT' },
      { part: 'Icon', path: 'Container/Icon', type: 'INSTANCE', shown_by: 'showIcon', component: 'Icon' },
    ] }],
    layout: { scope: 'default_variant', items: [{ path: 'Container', summary: 'row, gap 8, padding 12 16' }] },
    references: {
      used: [{ source_id: 'VariableID:1', name: 'color/primary', kind: 'variable', remote: false, status: 'resolved' }],
      bindings: [
        { path: 'Container', property: 'fill', source_id: 'VariableID:1', kind: 'variable' },
        { path: 'Container', property: 'fill', source_id: 'VariableID:1', kind: 'variable', when: { size: ['Large'] } },
      ],
    },
    diagnostics: [],
    ...over,
  };
}

function component(name: string, artifact: Record<string, unknown>, ai = 'component: x\n'): LibraryBundleV1['components'][number] {
  return { name, ai, artifact: artifact as unknown as LibraryBundleV1['components'][number]['artifact'] };
}

function bundle(over: Partial<LibraryBundleV1> = {}): LibraryBundleV1 {
  return {
    schema: 'spec-layer-library-bundle', version: '1.0.0', fileName: 'DS', pluginVersion: '5.1.0',
    extractorVersion: '2', foundation: null, components: [component('Button', componentArtifact())], ...over,
  };
}

/** Deep-set one key path on a fresh artifact copy, so a test names exactly the fact it moves. */
function withComponent(mutate: (artifact: Record<string, unknown>) => void): LibraryBundleV1 {
  const artifact = componentArtifact();
  mutate(artifact);
  return bundle({ components: [component('Button', artifact)] });
}

const only = (diff: LibraryDiff, entity: string) => diff.changes.filter((c) => c.entity === entity);

describe('bumpFor', () => {
  const structural: ChangeEntity[] = [
    'component', 'property', 'option', 'variant_axis', 'state', 'anatomy_part', 'collection', 'mode', 'token',
  ];
  const valueLike: ChangeEntity[] = ['binding', 'value', 'token_value', 'style'];

  it.each(structural)('%s removed or renamed is major, added is minor, changed is patch', (entity) => {
    expect(bumpFor(entity, 'removed')).toBe('major');
    expect(bumpFor(entity, 'renamed')).toBe('major');
    expect(bumpFor(entity, 'added')).toBe('minor');
    expect(bumpFor(entity, 'changed')).toBe('patch');
  });

  it.each(valueLike)('%s is patch for every kind', (entity) => {
    const kinds: ChangeKind[] = ['added', 'removed', 'renamed', 'changed'];
    for (const kind of kinds) expect(bumpFor(entity, kind)).toBe('patch');
  });
});

describe('compareBump', () => {
  it('orders patch < minor < major', () => {
    expect(compareBump('patch', 'minor')).toBeLessThan(0);
    expect(compareBump('minor', 'major')).toBeLessThan(0);
    expect(compareBump('major', 'patch')).toBeGreaterThan(0);
    expect(compareBump('minor', 'minor')).toBe(0);
  });
});

describe('isSemver', () => {
  it('accepts three dotted integers and nothing else', () => {
    expect(isSemver('1.0.0')).toBe(true);
    expect(isSemver('10.20.30')).toBe(true);
    expect(isSemver('1.0')).toBe(false);
    expect(isSemver('v1.0.0')).toBe(false);
    expect(isSemver('1.0.0-beta')).toBe(false);
    expect(isSemver(null)).toBe(false);
    expect(isSemver(100)).toBe(false);
  });
});

describe('nextVersion', () => {
  it.each([
    ['1.2.3', 'major', '2.0.0'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'patch', '1.2.4'],
    [null, 'major', '1.0.0'],
    [null, 'minor', '1.0.0'],
    [null, 'patch', '1.0.0'],
  ] as const)('%s + %s = %s', (current, bump, expected) => {
    expect(nextVersion(current, bump)).toBe(expected);
  });

  it('refuses a current version it cannot parse rather than guessing', () => {
    expect(() => nextVersion('1.2', 'patch')).toThrow(RangeError);
  });
});

describe('compareChanges', () => {
  const change = (over: Partial<LibraryChange>): LibraryChange => ({
    kind: 'added', entity: 'token', component: null, id: 'a', name: 'a',
    from: null, to: null, scope: null, bump: 'minor', ...over,
  });

  it('sorts foundation changes first, then by component, entity, id, scope, kind', () => {
    const sorted = [
      change({ component: 'Button', id: 'b' }),
      change({ component: null, id: 'z' }),
      change({ component: 'Button', id: 'a', scope: 'size Large' }),
      change({ component: 'Button', id: 'a', scope: null }),
    ].sort(compareChanges);
    expect(sorted.map((c) => `${c.component ?? ''}|${c.id}|${c.scope ?? ''}`)).toEqual([
      '|z|', 'Button|a|', 'Button|a|size Large', 'Button|b|',
    ]);
  });
});

describe('libraryDiff: components', () => {
  const base = bundle();

  it('an unchanged bundle yields no changes and a null minimum', () => {
    const diff = libraryDiff(base, bundle());
    expect(diff).toEqual({ changes: [], minimumBump: null, counts: { major: 0, minor: 0, patch: 0 } });
  });

  it('a removed component is major, an added one is minor', () => {
    const removed = libraryDiff(base, bundle({ components: [] }));
    expect(removed.changes).toEqual([expect.objectContaining({ entity: 'component', kind: 'removed', component: 'Button', id: 'key-button', bump: 'major' })]);
    expect(removed.minimumBump).toBe('major');

    const card = componentArtifact({ spec_layer: { ...componentArtifact().spec_layer, source: { provider: 'figma', node_id: '2:2', node_name: 'Card', component_key: 'key-card' } } });
    const added = libraryDiff(base, bundle({ components: [component('Button', componentArtifact()), component('Card', card)] }));
    expect(added.changes).toEqual([expect.objectContaining({ entity: 'component', kind: 'added', component: 'Card', id: 'key-card', bump: 'minor' })]);
    expect(added.minimumBump).toBe('minor');
  });

  it('identity is the component key, so a new node name is a rename, not a remove plus an add', () => {
    const renamed = withComponent((a) => {
      (a.spec_layer as { source: { node_name: string } }).source.node_name = 'Primary button';
      (a.component as { name: string }).name = 'Primary button';
    });
    const diff = libraryDiff(base, renamed);
    expect(diff.changes).toEqual([expect.objectContaining({
      entity: 'component', kind: 'renamed', id: 'key-button', component: 'Primary button',
      from: 'Button', to: 'Primary button', bump: 'major',
    })]);
  });

  it('falls back to the node id when the component key is null', () => {
    const keyless = componentArtifact({ spec_layer: { ...componentArtifact().spec_layer, source: { provider: 'figma', node_id: '1:1', node_name: 'Button', component_key: null } } });
    const diff = libraryDiff(bundle({ components: [component('Button', keyless)] }), bundle({ components: [] }));
    expect(diff.changes[0].id).toBe('1:1');
  });

  it('variant axis: removed is major, added is minor, default changed is patch', () => {
    const api = () => componentArtifact().api as Record<string, unknown>;
    const noAxis = withComponent((a) => { a.api = { ...api(), variants: {} }; });
    expect(only(libraryDiff(base, noAxis), 'variant_axis')).toEqual([expect.objectContaining({ kind: 'removed', id: 'size', bump: 'major' })]);

    const twoAxes = withComponent((a) => { a.api = { ...api(), variants: { ...(api().variants as object), tone: { options: ['Brand'], default: 'Brand' } } }; });
    expect(only(libraryDiff(base, twoAxes), 'variant_axis')).toEqual([expect.objectContaining({ kind: 'added', id: 'tone', bump: 'minor' })]);

    const newDefault = withComponent((a) => { a.api = { ...api(), variants: { size: { options: ['Small', 'Large'], default: 'Large' } } }; });
    expect(only(libraryDiff(base, newDefault), 'variant_axis')).toEqual([expect.objectContaining({ kind: 'changed', id: 'size', from: 'Small', to: 'Large', bump: 'patch' })]);
  });

  it('option: removed is major, added is minor, and the id is axis/option', () => {
    const api = () => componentArtifact().api as Record<string, unknown>;
    const fewer = withComponent((a) => { a.api = { ...api(), variants: { size: { options: ['Small'], default: 'Small' } } }; });
    expect(only(libraryDiff(base, fewer), 'option')).toEqual([expect.objectContaining({ kind: 'removed', id: 'size/Large', name: 'Large', bump: 'major' })]);

    const more = withComponent((a) => { a.api = { ...api(), variants: { size: { options: ['Small', 'Medium', 'Large'], default: 'Small' } } }; });
    expect(only(libraryDiff(base, more), 'option')).toEqual([expect.objectContaining({ kind: 'added', id: 'size/Medium', bump: 'minor' })]);
  });

  it('property: removed is major, added is minor, kind or default changed is patch', () => {
    const api = () => componentArtifact().api as Record<string, unknown>;
    const gone = withComponent((a) => { a.api = { ...api(), booleans: {} }; });
    expect(only(libraryDiff(base, gone), 'property')).toEqual([expect.objectContaining({ kind: 'removed', id: 'showIcon', bump: 'major' })]);

    const more = withComponent((a) => { a.api = { ...api(), slots: { label: { type: 'text', default: 'Button' }, icon: { type: 'instanceSwap' } } }; });
    expect(only(libraryDiff(base, more), 'property')).toEqual([expect.objectContaining({ kind: 'added', id: 'icon', to: 'instanceSwap', bump: 'minor' })]);

    const newDefault = withComponent((a) => { a.api = { ...api(), booleans: { showIcon: { default: true } } }; });
    expect(only(libraryDiff(base, newDefault), 'property')).toEqual([expect.objectContaining({ kind: 'changed', id: 'showIcon', from: 'boolean, default false', to: 'boolean, default true', bump: 'patch' })]);
  });

  it('state: removed is major, added is minor', () => {
    const api = () => componentArtifact().api as Record<string, unknown>;
    const gone = withComponent((a) => { a.api = { ...api(), states: [] }; });
    expect(only(libraryDiff(base, gone), 'state')).toEqual([expect.objectContaining({ kind: 'removed', id: 'Hover', bump: 'major' })]);
    const more = withComponent((a) => { a.api = { ...api(), states: ['Hover', 'Pressed'] }; });
    expect(only(libraryDiff(base, more), 'state')).toEqual([expect.objectContaining({ kind: 'added', id: 'Pressed', bump: 'minor' })]);
  });

  it('anatomy part: removed is major, added is minor, type or shown_by changed is patch; nested parts are flattened', () => {
    const gone = withComponent((a) => {
      a.anatomy = [{ part: 'Container', path: 'Container', type: 'FRAME', children: [{ part: 'Label', path: 'Container/Label', type: 'TEXT' }] }];
    });
    expect(only(libraryDiff(base, gone), 'anatomy_part')).toEqual([expect.objectContaining({ kind: 'removed', id: 'Container/Icon', name: 'Icon', bump: 'major' })]);

    const retyped = withComponent((a) => {
      a.anatomy = [{ part: 'Container', path: 'Container', type: 'FRAME', children: [
        { part: 'Label', path: 'Container/Label', type: 'TEXT' },
        { part: 'Icon', path: 'Container/Icon', type: 'INSTANCE', shown_by: 'hasIcon', component: 'Icon' },
      ] }];
    });
    expect(only(libraryDiff(base, retyped), 'anatomy_part')).toEqual([expect.objectContaining({
      kind: 'changed', id: 'Container/Icon', name: 'Icon', from: 'INSTANCE, shown by showIcon, component Icon', to: 'INSTANCE, shown by hasIcon, component Icon', bump: 'patch',
    })]);
  });

  it('anatomy part: identity is path, so a same-named part in a different branch is not paired with it', () => {
    const before = bundle({ components: [component('Button', componentArtifact({
      anatomy: [
        { part: 'A', path: 'A', type: 'FRAME', children: [{ part: 'Label', path: 'A/Label', type: 'TEXT' }] },
        { part: 'B', path: 'B', type: 'FRAME', children: [{ part: 'Label', path: 'B/Label', type: 'TEXT' }] },
        { part: 'C', path: 'C', type: 'FRAME', children: [] },
      ],
    }))] });
    const after = bundle({ components: [component('Button', componentArtifact({
      anatomy: [
        { part: 'A', path: 'A', type: 'FRAME', children: [] },
        { part: 'B', path: 'B', type: 'FRAME', children: [{ part: 'Label', path: 'B/Label', type: 'TEXT' }] },
        { part: 'C', path: 'C', type: 'FRAME', children: [{ part: 'Label', path: 'C/Label', type: 'TEXT' }] },
      ],
    }))] });
    const changes = only(libraryDiff(before, after), 'anatomy_part');
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'removed', id: 'A/Label', name: 'Label' }),
      expect.objectContaining({ kind: 'added', id: 'C/Label', name: 'Label' }),
    ]);
    expect(changes.some((c) => c.kind === 'changed')).toBe(false);
  });

  it('binding: identity is path, property and condition; the value is the bound token name; every kind is patch', () => {
    const refs = () => componentArtifact().references as { used: unknown[]; bindings: unknown[] };
    const rebound = withComponent((a) => {
      a.references = {
        used: [...refs().used, { source_id: 'VariableID:2', name: 'color/brand', kind: 'variable', remote: false, status: 'resolved' }],
        bindings: [
          { path: 'Container', property: 'fill', source_id: 'VariableID:2', kind: 'variable' },
          { path: 'Container', property: 'fill', source_id: 'VariableID:1', kind: 'variable', when: { size: ['Large'] } },
        ],
      };
    });
    expect(only(libraryDiff(base, rebound), 'binding')).toEqual([expect.objectContaining({
      kind: 'changed', id: 'Container / fill', scope: null, from: 'color/primary', to: 'color/brand', bump: 'patch',
    })]);

    const unbound = withComponent((a) => {
      a.references = { used: refs().used, bindings: [refs().bindings[0]] };
    });
    expect(only(libraryDiff(base, unbound), 'binding')).toEqual([expect.objectContaining({
      kind: 'removed', id: 'Container / fill', scope: 'size Large', from: 'color/primary', to: null, bump: 'patch',
    })]);
  });

  it('a binding to an id the used list does not name renders the id itself', () => {
    const orphan = withComponent((a) => {
      a.references = { used: [], bindings: [{ path: 'Container', property: 'fill', source_id: 'VariableID:9', kind: 'variable' }] };
    });
    const diff = libraryDiff(base, orphan);
    const changed = only(diff, 'binding').find((c) => c.kind === 'changed');
    expect(changed?.to).toBe('VariableID:9');
  });

  it('value: a layout summary change is patch and the id names the path', () => {
    const relaid = withComponent((a) => {
      a.layout = { scope: 'default_variant', items: [{ path: 'Container', summary: 'row, gap 12, padding 12 16' }] };
    });
    expect(only(libraryDiff(base, relaid), 'value')).toEqual([expect.objectContaining({
      kind: 'changed', id: 'layout:Container', from: 'row, gap 8, padding 12 16', to: 'row, gap 12, padding 12 16', bump: 'patch',
    })]);
  });

  it('value: inline effects and unbound rows are compared by canonical JSON', () => {
    const withEffects = withComponent((a) => { a.effects_inline = [{ path: 'Container', layers: [{ type: 'DROP_SHADOW', radius: 4 }] }]; });
    expect(only(libraryDiff(base, withEffects), 'value')).toEqual([expect.objectContaining({ kind: 'added', id: 'effects:Container', bump: 'patch' })]);

    const withGap = withComponent((a) => { a.unbound = [{ path: 'Container', property: 'cornerRadius', issue: 'raw-value', value: 8 }]; });
    expect(only(libraryDiff(base, withGap), 'value')).toEqual([expect.objectContaining({ kind: 'added', id: 'unbound:Container / cornerRadius', bump: 'patch' })]);
  });

  it('ignores every field that is not a Figma fact', () => {
    const noisy = withComponent((a) => {
      a.diagnostics = [{ code: 'X', severity: 'warning', entity_id: 'e', message: 'm' }];
      a.guidelines = { origin: 'generated', text: 'Use for primary actions.' };
      a.validation = [{ id: 'v', severity: 'warning', message: 'm' }];
      (a.spec_layer as { export: { generated_at: string; id: string } }).export.generated_at = '2027-01-01T00:00:00.000Z';
      (a.spec_layer as { export: { id: string } }).export.id = 'export:2';
    });
    const bundleNoise = { ...noisy, fileName: 'Other', pluginVersion: '9.9.9', extractorVersion: '3' };
    bundleNoise.components[0] = { ...bundleNoise.components[0], ai: 'component: totally different\n' };
    expect(libraryDiff(base, bundleNoise).changes).toEqual([]);
  });

  it('is deterministic across input order', () => {
    const card = componentArtifact({ spec_layer: { ...componentArtifact().spec_layer, source: { provider: 'figma', node_id: '2:2', node_name: 'Card', component_key: 'key-card' } } });
    const forward = bundle({ components: [component('Button', componentArtifact()), component('Card', card)] });
    const backward = bundle({ components: [component('Card', card), component('Button', componentArtifact())] });
    const empty = bundle({ components: [] });
    expect(JSON.stringify(libraryDiff(empty, forward))).toBe(JSON.stringify(libraryDiff(empty, backward)));
  });
});
