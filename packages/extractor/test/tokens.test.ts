import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractTokens, extractGaps, formatConditions } from '../src/tokens';
import button from './fixtures/button.json';
import chip from './fixtures/chip.json';
import type { SerializedNode, TokenRef, RefIdentity } from '../src/tree';

const root = button as SerializedNode;

/**
 * A binding now carries a full identity, and a rule spreads that identity
 * through. `ident` mints ONE identity per distinct token NAME, which is exactly
 * what a name meant before this change, so a synthetic fixture and the rule it
 * is expected to produce agree without every literal restating four fields.
 *
 * The button and chip fixtures state their own identities, so they are learned
 * first and win: an expectation about a fixture token then carries the real id
 * and collectionId that fixture declared, not a synthetic stand-in.
 */
const minted = new Map<string, RefIdentity>();
const learn = (n: SerializedNode): void => {
  for (const b of n.bindings ?? []) {
    const { property: _property, ...identity } = b;
    if (!minted.has(identity.name)) minted.set(identity.name, identity);
  }
  (n.children ?? []).forEach(learn);
};
learn(button as SerializedNode);
learn(chip as SerializedNode);

const ident = (name: string): RefIdentity => {
  let i = minted.get(name);
  if (!i) minted.set(name, (i = { id: `VariableID:${name}`, name, kind: 'variable', remote: false }));
  return i;
};
const bind = (property: string, token: string): TokenRef => ({ property, ...ident(token) });

/** Build a COMPONENT_SET fixture from variant descriptors. */
function makeSet(
  variants: {
    name: string;
    parts: { name: string; type?: string; visible?: boolean; bindings: TokenRef[] }[];
  }[],
  propertyDefinitions?: SerializedNode['propertyDefinitions'],
): SerializedNode {
  let id = 0;
  return {
    id: 'set', name: 'Set', type: 'COMPONENT_SET', visible: true,
    ...(propertyDefinitions ? { propertyDefinitions } : {}),
    children: variants.map((v) => ({
      id: `v${id++}`, name: v.name, type: 'COMPONENT', visible: true,
      children: v.parts.map((p) => ({
        id: `n${id++}`, name: p.name, type: p.type ?? 'FRAME', visible: p.visible ?? true,
        bindings: p.bindings,
      })),
    })),
  };
}

describe('extractTokens — rule minimization', () => {
  it('emits unconditioned rules for tokens shared by every variant', () => {
    expect(extractTokens(root)).toContainEqual(
      { part: 'container', path: 'Container/container', property: 'border-radius', conditions: {}, ...ident('md.sys.shape.corner.full') },
    );
  });

  it('conditions rules on exactly the determining axes', () => {
    const tokens = extractTokens(root);
    // label fill depends only on Style — State must not appear in the conditions
    expect(tokens).toContainEqual(
      { part: 'label', path: 'Container/label', property: 'fill', conditions: { Style: ['Filled'] }, ...ident('md.sys.color.on-primary') },
    );
    expect(tokens).toContainEqual(
      { part: 'label', path: 'Container/label', property: 'fill', conditions: { Style: ['Outlined'] }, ...ident('md.sys.color.primary') },
    );
  });

  it('keeps presence-driven conditions: container fill exists only on Filled', () => {
    const tokens = extractTokens(root);
    expect(tokens).toContainEqual(
      {
        part: 'container', path: 'Container/container', property: 'fill',
        conditions: { Style: ['Filled'], State: ['Enabled'] },
        ...ident('md.sys.color.primary'),
      },
    );
    // The only State=Hovered variant in the (sparse) fixture is Filled, so the
    // Style condition is non-restrictive and dropped.
    expect(tokens).toContainEqual(
      {
        part: 'container', path: 'Container/container', property: 'fill',
        conditions: { State: ['Hovered'] },
        ...ident('md.sys.color.primary-hover'),
      },
    );
  });

  it('drops non-restrictive axes on a sparse grid (Outlined exists only as Enabled)', () => {
    const tokens = extractTokens(root);
    expect(tokens).toContainEqual(
      { part: 'container', path: 'Container/container', property: 'border', conditions: { Style: ['Outlined'] }, ...ident('md.sys.color.outline') },
    );
  });

  it('does not repeat a single-axis rule for every combination of unrelated axes', () => {
    const set = makeSet([
      { name: 'Size=S, State=Default', parts: [{ name: 'Label', type: 'TEXT', bindings: [bind('typography', 'Action/S')] }] },
      { name: 'Size=L, State=Default', parts: [{ name: 'Label', type: 'TEXT', bindings: [bind('typography', 'Action/L')] }] },
      { name: 'Size=S, State=Hover', parts: [{ name: 'Label', type: 'TEXT', bindings: [bind('typography', 'Action/S')] }] },
      { name: 'Size=L, State=Hover', parts: [{ name: 'Label', type: 'TEXT', bindings: [bind('typography', 'Action/L')] }] },
    ]);
    const tokens = extractTokens(set);
    expect(tokens).toEqual([
      { part: 'Label', path: 'Container/Label', property: 'typography', conditions: { Size: ['S'] }, ...ident('Action/S') },
      { part: 'Label', path: 'Container/Label', property: 'typography', conditions: { Size: ['L'] }, ...ident('Action/L') },
    ]);
  });

  it('collapses an override axis into a wildcard rule (Disabled wins across states)', () => {
    const fill = (token: string) => [bind('fills', token)];
    const set = makeSet([
      { name: 'State=Default, Disabled=false', parts: [{ name: 'bg', bindings: fill('color/base') }] },
      { name: 'State=Hover, Disabled=false', parts: [{ name: 'bg', bindings: fill('color/hover') }] },
      { name: 'State=Default, Disabled=true', parts: [{ name: 'bg', bindings: fill('color/disabled') }] },
      { name: 'State=Hover, Disabled=true', parts: [{ name: 'bg', bindings: fill('color/disabled') }] },
    ]);
    const tokens = extractTokens(set);
    expect(tokens).toContainEqual(
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { Disabled: ['true'] }, ...ident('color/disabled') },
    );
    expect(tokens).toContainEqual(
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { State: ['Default'], Disabled: ['false'] }, ...ident('color/base') },
    );
    expect(tokens).toContainEqual(
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { State: ['Hover'], Disabled: ['false'] }, ...ident('color/hover') },
    );
  });

  it('never claims combinations that do not exist in a sparse grid', () => {
    const fill = (token: string) => [bind('fills', token)];
    // A=2/B=2 does not exist (the Danger x Disabled pattern)
    const set = makeSet([
      { name: 'A=1, B=1', parts: [{ name: 'bg', bindings: fill('color/x') }] },
      { name: 'A=2, B=1', parts: [{ name: 'bg', bindings: fill('color/y') }] },
      { name: 'A=1, B=2', parts: [{ name: 'bg', bindings: fill('color/z') }] },
    ]);
    const tokens = extractTokens(set);
    // y applies to all existing A=2 variants — B is non-restrictive and dropped
    expect(tokens).toContainEqual(
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { A: ['2'] }, ...ident('color/y') },
    );
    expect(tokens).toContainEqual(
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { B: ['2'] }, ...ident('color/z') },
    );
    expect(tokens).toContainEqual(
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { A: ['1'], B: ['1'] }, ...ident('color/x') },
    );
    expect(tokens).toHaveLength(3);
  });

  it('conditions parts that only exist under certain axis values (Focus Rect pattern)', () => {
    const set = makeSet([
      { name: 'State=Default', parts: [] },
      { name: 'State=Hover', parts: [] },
      {
        name: 'State=Focus',
        parts: [{ name: 'Focus Rect', bindings: [bind('strokes', 'border/focus')] }],
      },
    ]);
    expect(extractTokens(set)).toEqual([
      { part: 'Focus Rect', path: 'Container/Focus Rect', property: 'border', conditions: { State: ['Focus'] }, ...ident('border/focus') },
    ]);
  });

  it('conditions on a hidden-but-present part: visible only under one axis value (bug B3)', () => {
    // The common Figma pattern: the layer exists in every variant but is
    // hidden except where it matters. Skipping invisible subtrees lets
    // presence-driven conditioning still fire.
    const focusRect = (visible: boolean) => ({
      name: 'Focus Rect',
      visible,
      bindings: [bind('strokes', 'border/focus')],
    });
    const set = makeSet([
      { name: 'State=Default', parts: [focusRect(false)] },
      { name: 'State=Hover', parts: [focusRect(false)] },
      { name: 'State=Focus', parts: [focusRect(true)] },
    ]);
    expect(extractTokens(set)).toEqual([
      { part: 'Focus Rect', path: 'Container/Focus Rect', property: 'border', conditions: { State: ['Focus'] }, ...ident('border/focus') },
    ]);
  });

  it('emits one rule per token when a cell binds multiple tokens to one property', () => {
    const set = makeSet([
      {
        name: 'A=One',
        parts: [{ name: 'bg', bindings: [
          bind('fills', 'color/overlay'),
          bind('fills', 'color/base'),
        ] }],
      },
      {
        name: 'A=Two',
        parts: [{ name: 'bg', bindings: [bind('fills', 'color/overlay')] }],
      },
    ]);
    const tokens = extractTokens(set);
    // overlay is present everywhere → unconditioned; base only on A=One
    expect(tokens).toContainEqual({ part: 'bg', path: 'Container/bg', property: 'fill', conditions: {}, ...ident('color/overlay') });
    expect(tokens).toContainEqual({ part: 'bg', path: 'Container/bg', property: 'fill', conditions: { A: ['One'] }, ...ident('color/base') });
  });

  it('merges sibling axis values that share a token', () => {
    const fill = (token: string) => [bind('fills', token)];
    const set = makeSet([
      { name: 'Type=Primary', parts: [{ name: 'bg', bindings: fill('color/primary') }] },
      { name: 'Type=Secondary', parts: [{ name: 'bg', bindings: fill('color/muted') }] },
      { name: 'Type=Tertiary', parts: [{ name: 'bg', bindings: fill('color/muted') }] },
    ]);
    const tokens = extractTokens(set);
    expect(tokens).toContainEqual(
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { Type: ['Secondary', 'Tertiary'] }, ...ident('color/muted') },
    );
  });

  it('orders condition values by the declared variantOptions order', () => {
    const fill = (token: string) => [bind('fills', token)];
    const set = makeSet(
      [
        { name: 'Type=Tertiary', parts: [{ name: 'bg', bindings: fill('color/muted') }] },
        { name: 'Type=Secondary', parts: [{ name: 'bg', bindings: fill('color/muted') }] },
        { name: 'Type=Primary', parts: [{ name: 'bg', bindings: fill('color/primary') }] },
      ],
      { Type: { type: 'VARIANT', defaultValue: 'Primary', variantOptions: ['Primary', 'Secondary', 'Tertiary'] } },
    );
    expect(extractTokens(set)).toContainEqual(
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { Type: ['Secondary', 'Tertiary'] }, ...ident('color/muted') },
    );
  });

  it('deduplicates identical (part, property, token) tuples within a variant (bug 4)', () => {
    const tokens = extractTokens(chip as SerializedNode);
    const iconFills = tokens.filter((t) => t.part === 'icon' && t.property === 'fill');
    expect(iconFills).toEqual([
      { part: 'icon', path: 'Container/Contents/icon', property: 'fill', conditions: {}, ...ident('Text Color/Body/Primary') },
    ]);
  });

  it('collapses padding-left/right and top/bottom pairs into padding-x / padding-y', () => {
    const set = makeSet([
      {
        name: 'Size=XSmall',
        parts: [{ name: 'bg', bindings: [
          bind('paddingLeft', 'size-12'),
          bind('paddingRight', 'size-12'),
          bind('paddingTop', 'size-4'),
          bind('paddingBottom', 'size-4'),
        ] }],
      },
    ]);
    const tokens = extractTokens(set);
    expect(tokens).toContainEqual({ part: 'bg', path: 'Container/bg', property: 'padding-x', conditions: {}, ...ident('size-12') });
    expect(tokens).toContainEqual({ part: 'bg', path: 'Container/bg', property: 'padding-y', conditions: {}, ...ident('size-4') });
  });

  it('collapses all four equal paddings into a single padding rule', () => {
    const set = makeSet([
      {
        name: 'Size=M',
        parts: [{ name: 'bg', bindings: [
          bind('paddingLeft', 'size-8'),
          bind('paddingRight', 'size-8'),
          bind('paddingTop', 'size-8'),
          bind('paddingBottom', 'size-8'),
        ] }],
      },
    ]);
    expect(extractTokens(set)).toEqual([
      { part: 'bg', path: 'Container/bg', property: 'padding', conditions: {}, ...ident('size-8') },
    ]);
  });

  it('suppresses typography sub-properties when a composite typography binding exists', () => {
    const set = makeSet([
      {
        name: 'Size=M',
        parts: [{ name: 'Label', type: 'TEXT', bindings: [
          bind('typography', 'Action/M'),
          bind('fontSize', 'font-size/fs-200'),
          bind('lineHeight', 'line-height/lh-400'),
        ] }],
      },
    ]);
    expect(extractTokens(set)).toEqual([
      { part: 'Label', path: 'Container/Label', property: 'typography', conditions: {}, ...ident('Action/M') },
    ]);
  });

  it('strips Figma prop-binding suffixes from part names', () => {
    const set = makeSet([
      {
        name: 'Size=M',
        parts: [{ name: 'icon-primary#', bindings: [bind('fills', 'color/icon')] }],
      },
    ]);
    expect(extractTokens(set)).toEqual([
      { part: 'icon-primary', path: 'Container/icon-primary', property: 'fill', conditions: {}, ...ident('color/icon') },
    ]);
  });

  it('falls back to a Variant pseudo-axis when names are not Axis=Value shaped', () => {
    const fill = (token: string) => [bind('fills', token)];
    const set = makeSet([
      { name: 'Plain', parts: [{ name: 'bg', bindings: fill('color/base') }] },
      { name: 'Fancy Variant', parts: [{ name: 'bg', bindings: fill('color/fancy') }] },
    ]);
    const tokens = extractTokens(set);
    expect(tokens).toContainEqual(
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { Variant: ['Plain'] }, ...ident('color/base') },
    );
    expect(tokens).toContainEqual(
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { Variant: ['Fancy Variant'] }, ...ident('color/fancy') },
    );
  });

  it('lists the default-variant rule before the others', () => {
    const tokens = extractTokens(root);
    const containerFills = tokens.filter((t) => t.part === 'container' && t.property === 'fill');
    expect(containerFills[0].name).toBe('md.sys.color.primary');
  });

  it('handles an Auris-Button-shaped sparse grid without a combinatorial explosion', () => {
    // 4 Sizes x 3 Types x 4 States x 3 Danger/Disabled combos = 144 variants
    // (Danger=true never co-exists with Disabled=true, like the real file).
    const sizes = ['Default', 'Small', 'Large', 'XSmall'];
    const types = ['Primary', 'Secondary', 'Tertiary'];
    const states = ['Default', 'Hover', 'Press', 'Focus'];
    const dd: [string, string][] = [['false', 'false'], ['true', 'false'], ['false', 'true']];

    const fillToken = (type: string, state: string, danger: string, disabled: string) => {
      const family = type === 'Primary' ? 'primary' : 'secondary';
      if (disabled === 'true') return `bg/${family}-disabled`;
      if (danger === 'true') return `bg/danger-${family}-${state}`;
      return `bg/${family}-${state}`;
    };

    const variants = [];
    for (const size of sizes)
      for (const type of types)
        for (const state of states)
          for (const [danger, disabled] of dd)
            variants.push({
              name: `Size=${size}, Type=${type}, State=${state}, Danger=${danger}, Disabled=${disabled}`,
              parts: [
                { name: 'bg', bindings: [bind('fills', fillToken(type, state, danger, disabled))] },
                { name: 'Label', type: 'TEXT', bindings: [bind('typography', `action/${size}`)] },
              ],
            });
    const tokens = extractTokens(makeSet(variants));

    // Label typography depends only on Size: exactly 4 rules, never qualified by other axes.
    const typography = tokens.filter((t) => t.part === 'Label');
    expect(typography).toHaveLength(4);
    for (const t of typography) expect(Object.keys(t.conditions)).toEqual(['Size']);

    // Fill: Size never appears; Secondary/Tertiary merge; Disabled overrides State;
    // Danger rules drop the non-restrictive Disabled=false condition.
    const fills = tokens.filter((t) => t.part === 'bg');
    for (const f of fills) expect(f.conditions).not.toHaveProperty('Size');
    expect(fills).toContainEqual({
      part: 'bg', path: 'Container/bg', property: 'fill',
      conditions: { Type: ['Primary'], Disabled: ['true'] },
      ...ident('bg/primary-disabled'),
    });
    expect(fills).toContainEqual({
      part: 'bg', path: 'Container/bg', property: 'fill',
      conditions: { Type: ['Secondary', 'Tertiary'], State: ['Hover'], Danger: ['true'] },
      ...ident('bg/danger-secondary-Hover'),
    });
    // No rule may claim the non-existent Danger=true + Disabled=true combination.
    for (const f of fills) {
      expect(f.conditions.Danger?.includes('true') && f.conditions.Disabled?.includes('true')).toBeFalsy();
    }
    // 4 base + 4 danger rules per type family (Primary vs merged Secondary/Tertiary)
    // + 1 disabled rule each = 18 rules — versus ~750 rows under the old diffing.
    expect(fills).toHaveLength(18);
    expect(tokens).toHaveLength(22);
  });
});

describe('formatConditions', () => {
  it('renders an em dash for unconditioned rules', () => {
    expect(formatConditions({})).toBe('—');
  });

  it('joins values with a middot and axes with a comma', () => {
    expect(formatConditions({ Type: ['Secondary', 'Tertiary'], State: ['Hover'] }))
      .toBe('Type=Secondary · Tertiary, State=Hover');
  });
});

describe('extractGaps', () => {
  it('reports unbound paints as gaps, including on invisible layers', () => {
    expect(extractGaps(root)).toContainEqual(
      { part: 'debug-overlay', path: 'Container/debug-overlay', property: 'fill', issue: 'hardcoded-color' },
    );
  });

  it('flags TEXT parts with no text style or typography variable', () => {
    expect(extractGaps(root)).toContainEqual(
      { part: 'label', path: 'Container/label', property: 'typography', issue: 'missing-token-binding' },
    );
  });

  it('flags hardcoded layout values not bound to variables', () => {
    const gaps = extractGaps(root);
    // itemSpacing gaps carry property 'gap', the exact same name a real
    // itemSpacing binding normalizes to (SIMPLE_PROPERTY_MAP), so the two can
    // reconcile against each other.
    expect(gaps).toContainEqual({
      part: 'container', path: 'Container/container', property: 'gap',
      issue: 'hardcoded-value', value: 8,
    });
    // The fixture's padding is [top:10, right:24, bottom:10, left:24]: not
    // uniform, but left=right and top=bottom, so it collapses into the same
    // two composite properties a real padding-x/padding-y binding would use.
    expect(gaps).toContainEqual({
      part: 'container', path: 'Container/container', property: 'padding-x',
      issue: 'hardcoded-value', value: 24,
    });
    expect(gaps).toContainEqual({
      part: 'container', path: 'Container/container', property: 'padding-y',
      issue: 'hardcoded-value', value: 10,
    });
    // cornerRadius IS bound on container → must NOT be flagged
    expect(gaps).not.toContainEqual(expect.objectContaining({ property: 'border-radius' }));
  });
});

describe('extractGaps coverage', () => {
  const comp = (extra: Partial<SerializedNode>): SerializedNode => ({
    id: 'v0', name: 'Button', type: 'COMPONENT', visible: true, ...extra,
  });

  it('reports a hardcoded stroke color', () => {
    const gaps = extractGaps(comp({ hasUnboundStroke: true }));
    expect(gaps).toContainEqual({ part: 'Button', path: 'Button', property: 'border', issue: 'hardcoded-color' });
  });

  it('reports a hardcoded stroke color with its hex value', () => {
    const gaps = extractGaps(comp({ hasUnboundStroke: true, unboundStroke: '#ff0000' }));
    expect(gaps).toContainEqual({
      part: 'Button', path: 'Button', property: 'border', issue: 'hardcoded-color', value: '#ff0000',
    });
  });

  it('reports a hardcoded fill color with its hex value', () => {
    const gaps = extractGaps(comp({ hasUnboundPaint: true, unboundFill: '#00ff00' }));
    expect(gaps).toContainEqual({
      part: 'Button', path: 'Button', property: 'fill', issue: 'hardcoded-color', value: '#00ff00',
    });
  });

  it('reports a hardcoded gradient or image fill', () => {
    const gaps = extractGaps(comp({ hasUnboundGradient: true }));
    expect(gaps).toContainEqual({ part: 'Button', path: 'Button', property: 'fill', issue: 'missing-token-binding' });
  });

  it('reports an unbound effect', () => {
    const gaps = extractGaps(comp({ hasUnboundEffect: true }));
    expect(gaps).toContainEqual({ part: 'Button', path: 'Button', property: 'effects', issue: 'missing-token-binding' });
  });

  it('reports a hand-set opacity', () => {
    const gaps = extractGaps(comp({ opacity: 0.5 }));
    expect(gaps).toContainEqual({ part: 'Button', path: 'Button', property: 'opacity', issue: 'hardcoded-value', value: 0.5 });
  });

  it('does not report opacity when it is fully opaque', () => {
    expect(extractGaps(comp({ opacity: 1 }))).toEqual([]);
  });

  it('does not report opacity when it is bound to a variable', () => {
    const gaps = extractGaps(comp({ opacity: 0.5, bindings: [bind('opacity', 'a/b')] }));
    expect(gaps).toEqual([]);
  });

  it('reports both a hardcoded fill and a hardcoded stroke on the same part', () => {
    // pushGap dedupes on (path, issue), not on part alone — two distinct issues
    // on one part must not collapse into one gap.
    const gaps = extractGaps(comp({ hasUnboundPaint: true, hasUnboundStroke: true }));
    expect(gaps).toContainEqual({ part: 'Button', path: 'Button', property: 'fill', issue: 'hardcoded-color' });
    expect(gaps).toContainEqual({ part: 'Button', path: 'Button', property: 'border', issue: 'hardcoded-color' });
    expect(gaps).toHaveLength(2);
  });

  // Regression (code review, Task 3): pushGap's dedupe key joined part and
  // issue with a NUL separator, so two nodes in DIFFERENT subtrees with the
  // same cleaned leaf name ("header > label" and "footer > label") shared a
  // key. Unlike the tokens.ts defect, this didn't corrupt a path — dedup runs
  // BEFORE the push, so the second node's gap was silently dropped rather than
  // merged. Keying on (path, issue) fixes both: two gaps are reported, each
  // with its own correct path.
  it('reports the same issue on two same-named parts in different subtrees as two gaps', () => {
    const root: SerializedNode = {
      id: 'root', name: 'Root', type: 'COMPONENT', visible: true,
      children: [
        { id: 'h', name: 'header', type: 'FRAME', visible: true,
          children: [{ id: 'hl', name: 'label', type: 'RECTANGLE', visible: true, hasUnboundPaint: true }] },
        { id: 'f', name: 'footer', type: 'FRAME', visible: true,
          children: [{ id: 'fl', name: 'label', type: 'RECTANGLE', visible: true, hasUnboundPaint: true }] },
      ],
    };
    const gaps = extractGaps(root);
    expect(gaps).toContainEqual(
      { part: 'label', path: 'Root/header/label', property: 'fill', issue: 'hardcoded-color' },
    );
    expect(gaps).toContainEqual(
      { part: 'label', path: 'Root/footer/label', property: 'fill', issue: 'hardcoded-color' },
    );
    expect(gaps).toHaveLength(2);
  });
});

describe('same-named siblings', () => {
  const set: SerializedNode = {
    id: 'root', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
    propertyDefinitions: { Style: { type: 'VARIANT', variantOptions: ['Filled'] } },
    children: [{
      id: 'v0', name: 'Style=Filled', type: 'COMPONENT', visible: true,
      children: [
        { id: 'a', name: 'icon', type: 'FRAME', visible: true, bindings: [bind('fills', 'tok/leading')] },
        { id: 'b', name: 'label', type: 'TEXT', visible: true, bindings: [bind('fills', 'tok/text')] },
        { id: 'c', name: 'icon', type: 'FRAME', visible: true, bindings: [bind('fills', 'tok/trailing')] },
      ],
    }],
  };

  it('keeps two same-named siblings as distinct parts', () => {
    const byPart = extractTokens(set).map((r) => `${r.part}=${r.name}`);
    expect(byPart).toContain('icon=tok/leading');
    expect(byPart).toContain('icon (2)=tok/trailing');
    // The bug: both landed on `icon`, producing two unconditioned rules for one part.
    expect(byPart.filter((p) => p.startsWith('icon='))).toHaveLength(1);
  });
});

describe('same-named siblings — hidden collision', () => {
  it('does not let a hidden sibling free up its numbering slot for the visible one', () => {
    // First "icon" is hidden, second is visible. Numbering must still run over
    // ALL children (including hidden ones): if it only counted visible
    // children, the visible trailing icon would shift down to plain "icon"
    // whenever its hidden sibling happened to be hidden in this variant but
    // visible in another — silently renaming the same part across variants.
    const set: SerializedNode = {
      id: 'root', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: { Style: { type: 'VARIANT', variantOptions: ['Filled'] } },
      children: [{
        id: 'v0', name: 'Style=Filled', type: 'COMPONENT', visible: true,
        children: [
          { id: 'a', name: 'icon', type: 'FRAME', visible: false, bindings: [bind('fills', 'tok/hidden')] },
          { id: 'b', name: 'label', type: 'TEXT', visible: true, bindings: [bind('fills', 'tok/text')] },
          { id: 'c', name: 'icon', type: 'FRAME', visible: true, bindings: [bind('fills', 'tok/trailing')] },
        ],
      }],
    };
    const byPart = extractTokens(set).map((r) => `${r.part}=${r.name}`);
    expect(byPart).toContain('icon (2)=tok/trailing');
    expect(byPart).not.toContain('icon=tok/trailing');
  });

  it('numbers a three-way collision monotonically: icon, icon (2), icon (3)', () => {
    const set: SerializedNode = {
      id: 'root', name: 'Button', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: { Style: { type: 'VARIANT', variantOptions: ['Filled'] } },
      children: [{
        id: 'v0', name: 'Style=Filled', type: 'COMPONENT', visible: true,
        children: [
          { id: 'a', name: 'icon', type: 'FRAME', visible: true, bindings: [bind('fills', 'tok/1')] },
          { id: 'b', name: 'icon', type: 'FRAME', visible: true, bindings: [bind('fills', 'tok/2')] },
          { id: 'c', name: 'icon', type: 'FRAME', visible: true, bindings: [bind('fills', 'tok/3')] },
        ],
      }],
    };
    const byPart = extractTokens(set).map((r) => `${r.part}=${r.name}`);
    expect(byPart).toContain('icon=tok/1');
    expect(byPart).toContain('icon (2)=tok/2');
    expect(byPart).toContain('icon (3)=tok/3');
  });
});

describe('duplicate parsed combos', () => {
  it('does not union conflicting token sets when two variants parse alike', () => {
    // Both names parse to { Size: 'S' } — the duplicate axis makes the second
    // key win, so these two distinct COMPONENT nodes collide in the axis model.
    const set: SerializedNode = {
      id: 'root', name: 'C', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: { Size: { type: 'VARIANT', variantOptions: ['S'] } },
      children: [
        { id: 'v0', name: 'Size=S', type: 'COMPONENT', visible: true,
          bindings: [bind('fills', 'tok/a')] },
        { id: 'v1', name: 'Size=M, Size=S', type: 'COMPONENT', visible: true,
          bindings: [bind('fills', 'tok/b')] },
      ],
    };
    const rules = extractTokens(set);
    const containerFills = rules.filter((r) => r.part === 'Container' && r.property === 'fill');
    // Exactly one rule survives. Emitting BOTH would tell the reader that one
    // variant carries two different fills at once, which no variant does.
    expect(containerFills).toHaveLength(1);
  });
});

describe('property name normalization', () => {
  it('maps stroke and size properties to CSS-like names, passing others through unchanged', () => {
    const set: SerializedNode = {
      id: 'v0', name: 'Box', type: 'COMPONENT', visible: true,
      bindings: [
        bind('strokeWeight', 'border/width/thin'),
        bind('effects', 'shadow/sm'),
        bind('opacity', 'opacity/muted'),
        bind('width', 'size/track'),
        bind('height', 'size/thumb'),
      ],
    };
    const props = extractTokens(set).map((r) => r.property);
    expect(props).toEqual(['border-width', 'effects', 'opacity', 'width', 'height']);
  });

  it('passes counterAxisSpacing through unchanged, since the correct CSS name depends on layoutMode', () => {
    const set: SerializedNode = {
      id: 'v0', name: 'Box', type: 'COMPONENT', visible: true,
      bindings: [bind('counterAxisSpacing', 'space/sm')],
    };
    const props = extractTokens(set).map((r) => r.property);
    expect(props).toEqual(['counterAxisSpacing']);
  });
});

// Regression (code review, Task 3): grouping by `part` alone let two nodes in
// DIFFERENT subtrees with the same cleaned leaf name ("header > label" and
// "footer > label") merge into one cell, and `pathByKey`'s plain `Map.set`
// left whichever node the walk visited last (footer) stamped as the `path`
// on BOTH resulting rules — so the rule carrying `color.header.label` ended
// up asserting `path: 'Root/footer/label'`, a location that node never had.
// Grouping on (path, property) instead keeps the two subtrees as two
// separate rules, each correctly reporting its own path.
describe('cross-subtree name collision (path grouping)', () => {
  it('keeps two same-named parts in different subtrees as two rules, each with its own correct path', () => {
    const root: SerializedNode = {
      id: 'root', name: 'Root', type: 'COMPONENT', visible: true,
      children: [
        {
          id: 'h', name: 'header', type: 'FRAME', visible: true,
          children: [
            { id: 'hl', name: 'label', type: 'TEXT', visible: true,
              bindings: [bind('fills', 'color.header.label')] },
          ],
        },
        {
          id: 'f', name: 'footer', type: 'FRAME', visible: true,
          children: [
            { id: 'fl', name: 'label', type: 'TEXT', visible: true,
              bindings: [bind('fills', 'color.footer.label')] },
          ],
        },
      ],
    };
    const tokens = extractTokens(root);
    expect(tokens).toHaveLength(2);

    const header = tokens.find((t) => t.name === 'color.header.label');
    const footer = tokens.find((t) => t.name === 'color.footer.label');
    expect(header).toEqual(
      { part: 'label', path: 'Root/header/label', property: 'fill', conditions: {}, ...ident('color.header.label') },
    );
    expect(footer).toEqual(
      { part: 'label', path: 'Root/footer/label', property: 'fill', conditions: {}, ...ident('color.footer.label') },
    );
    // The defect under review: both rules reporting the SAME (wrong-for-one)
    // path is exactly what must not happen.
    expect(header!.path).not.toBe(footer!.path);
  });
});

describe('ref identity', () => {
  const ref = (over: Partial<TokenRef> & { property: string }): TokenRef => ({
    id: 'VariableID:1', name: 'color/brand', kind: 'variable', remote: false, ...over,
  });

  it('carries id, kind and remote onto the emitted rule', () => {
    const root: SerializedNode = {
      id: '1:1', name: 'Card', type: 'COMPONENT', visible: true,
      bindings: [ref({ property: 'fills', id: 'VariableID:9', remote: true,
        collectionId: 'VariableCollectionId:3' })],
    } as SerializedNode;
    const [rule] = extractTokens(root);
    expect(rule.name).toBe('color/brand');
    expect(rule.id).toBe('VariableID:9');
    expect(rule.kind).toBe('variable');
    expect(rule.remote).toBe(true);
    expect(rule.collectionId).toBe('VariableCollectionId:3');
  });

  it('has no `token` field left on a rule', () => {
    const root: SerializedNode = {
      id: '1:1', name: 'Card', type: 'COMPONENT', visible: true,
      bindings: [ref({ property: 'fills' })],
    } as SerializedNode;
    // `in`, not an undefined comparison: a leftover `token: undefined` would
    // still satisfy every consumer that reads it and silently emit nothing.
    expect('token' in extractTokens(root)[0]).toBe(false);
  });
});

describe('identity through minimization', () => {
  const base = (bindings: TokenRef[]): SerializedNode => ({
    id: '1:1', name: 'Card', type: 'COMPONENT', visible: true, bindings,
  } as SerializedNode);

  it('keeps a variable and an effect style that share one name as two rules', () => {
    const rules = extractTokens(base([
      { property: 'fills', id: 'VariableID:1', name: 'Elevation/1', kind: 'variable', remote: false },
      { property: 'effects', id: 'S:effect,1:1', name: 'Elevation/1', kind: 'effect-style', remote: false },
    ]));
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.kind).sort()).toEqual(['effect-style', 'variable']);
  });

  it('keeps two variables that share one name as two rules', () => {
    const rules = extractTokens(base([
      { property: 'fills', id: 'VariableID:1', name: 'brand', kind: 'variable', remote: false },
      { property: 'strokes', id: 'VariableID:2', name: 'brand', kind: 'variable', remote: false },
    ]));
    expect(rules).toHaveLength(2);
    expect(new Set(rules.map((r) => r.id)).size).toBe(2);
  });

  it('collapses one variable bound twice on the same property to one rule', () => {
    const rules = extractTokens(base([
      { property: 'fills', id: 'VariableID:1', name: 'brand', kind: 'variable', remote: false },
      { property: 'fills', id: 'VariableID:1', name: 'brand', kind: 'variable', remote: false },
    ]));
    expect(rules).toHaveLength(1);
  });
});

describe('composite keys', () => {
  // Built from char codes, never written as literals. A test that spells the
  // sequence it forbids puts that sequence into a tracked source file, and
  // check:nul would then fail on the test rather than on the defect.
  const BACKSLASH_ZERO = String.fromCharCode(92) + '0';
  const CONTROL = new RegExp('[' + "\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f" + ']');

  it('uses no control character in any key these modules build', () => {
    // Read the source, not the behaviour: a control character in a key is
    // invisible in a diff, survives grep without -P, and sat past git's
    // binary-detection window every time it reached this repo.
    for (const file of ['tokens.ts', 'rawValues.ts', 'pivot.ts', 'validate.ts']) {
      const src = readFileSync(`packages/extractor/src/${file}`, 'utf8');
      expect(CONTROL.test(src), `${file} holds a raw control character`).toBe(false);
      expect(src.includes(BACKSLASH_ZERO), `${file} holds a NUL escape`).toBe(false);
    }
  });
});
