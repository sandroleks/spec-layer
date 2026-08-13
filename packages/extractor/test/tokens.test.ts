import { describe, it, expect } from 'vitest';
import { extractTokens, extractGaps, formatConditions } from '../src/tokens';
import button from './fixtures/button.json';
import chip from './fixtures/chip.json';
import type { SerializedNode } from '../src/tree';

const root = button as SerializedNode;

/** Build a COMPONENT_SET fixture from variant descriptors. */
function makeSet(
  variants: {
    name: string;
    parts: { name: string; type?: string; visible?: boolean; bindings: { property: string; token: string }[] }[];
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
      { part: 'container', property: 'border-radius', conditions: {}, token: 'md.sys.shape.corner.full' },
    );
  });

  it('conditions rules on exactly the determining axes', () => {
    const tokens = extractTokens(root);
    // label fill depends only on Style — State must not appear in the conditions
    expect(tokens).toContainEqual(
      { part: 'label', property: 'fill', conditions: { Style: ['Filled'] }, token: 'md.sys.color.on-primary' },
    );
    expect(tokens).toContainEqual(
      { part: 'label', property: 'fill', conditions: { Style: ['Outlined'] }, token: 'md.sys.color.primary' },
    );
  });

  it('keeps presence-driven conditions: container fill exists only on Filled', () => {
    const tokens = extractTokens(root);
    expect(tokens).toContainEqual(
      {
        part: 'container', property: 'fill',
        conditions: { Style: ['Filled'], State: ['Enabled'] },
        token: 'md.sys.color.primary',
      },
    );
    // The only State=Hovered variant in the (sparse) fixture is Filled, so the
    // Style condition is non-restrictive and dropped.
    expect(tokens).toContainEqual(
      {
        part: 'container', property: 'fill',
        conditions: { State: ['Hovered'] },
        token: 'md.sys.color.primary-hover',
      },
    );
  });

  it('drops non-restrictive axes on a sparse grid (Outlined exists only as Enabled)', () => {
    const tokens = extractTokens(root);
    expect(tokens).toContainEqual(
      { part: 'container', property: 'border', conditions: { Style: ['Outlined'] }, token: 'md.sys.color.outline' },
    );
  });

  it('does not repeat a single-axis rule for every combination of unrelated axes', () => {
    const set = makeSet([
      { name: 'Size=S, State=Default', parts: [{ name: 'Label', type: 'TEXT', bindings: [{ property: 'typography', token: 'Action/S' }] }] },
      { name: 'Size=L, State=Default', parts: [{ name: 'Label', type: 'TEXT', bindings: [{ property: 'typography', token: 'Action/L' }] }] },
      { name: 'Size=S, State=Hover', parts: [{ name: 'Label', type: 'TEXT', bindings: [{ property: 'typography', token: 'Action/S' }] }] },
      { name: 'Size=L, State=Hover', parts: [{ name: 'Label', type: 'TEXT', bindings: [{ property: 'typography', token: 'Action/L' }] }] },
    ]);
    const tokens = extractTokens(set);
    expect(tokens).toEqual([
      { part: 'Label', property: 'typography', conditions: { Size: ['S'] }, token: 'Action/S' },
      { part: 'Label', property: 'typography', conditions: { Size: ['L'] }, token: 'Action/L' },
    ]);
  });

  it('collapses an override axis into a wildcard rule (Disabled wins across states)', () => {
    const fill = (token: string) => [{ property: 'fills', token }];
    const set = makeSet([
      { name: 'State=Default, Disabled=false', parts: [{ name: 'bg', bindings: fill('color/base') }] },
      { name: 'State=Hover, Disabled=false', parts: [{ name: 'bg', bindings: fill('color/hover') }] },
      { name: 'State=Default, Disabled=true', parts: [{ name: 'bg', bindings: fill('color/disabled') }] },
      { name: 'State=Hover, Disabled=true', parts: [{ name: 'bg', bindings: fill('color/disabled') }] },
    ]);
    const tokens = extractTokens(set);
    expect(tokens).toContainEqual(
      { part: 'bg', property: 'fill', conditions: { Disabled: ['true'] }, token: 'color/disabled' },
    );
    expect(tokens).toContainEqual(
      { part: 'bg', property: 'fill', conditions: { State: ['Default'], Disabled: ['false'] }, token: 'color/base' },
    );
    expect(tokens).toContainEqual(
      { part: 'bg', property: 'fill', conditions: { State: ['Hover'], Disabled: ['false'] }, token: 'color/hover' },
    );
  });

  it('never claims combinations that do not exist in a sparse grid', () => {
    const fill = (token: string) => [{ property: 'fills', token }];
    // A=2/B=2 does not exist (the Danger x Disabled pattern)
    const set = makeSet([
      { name: 'A=1, B=1', parts: [{ name: 'bg', bindings: fill('color/x') }] },
      { name: 'A=2, B=1', parts: [{ name: 'bg', bindings: fill('color/y') }] },
      { name: 'A=1, B=2', parts: [{ name: 'bg', bindings: fill('color/z') }] },
    ]);
    const tokens = extractTokens(set);
    // y applies to all existing A=2 variants — B is non-restrictive and dropped
    expect(tokens).toContainEqual(
      { part: 'bg', property: 'fill', conditions: { A: ['2'] }, token: 'color/y' },
    );
    expect(tokens).toContainEqual(
      { part: 'bg', property: 'fill', conditions: { B: ['2'] }, token: 'color/z' },
    );
    expect(tokens).toContainEqual(
      { part: 'bg', property: 'fill', conditions: { A: ['1'], B: ['1'] }, token: 'color/x' },
    );
    expect(tokens).toHaveLength(3);
  });

  it('conditions parts that only exist under certain axis values (Focus Rect pattern)', () => {
    const set = makeSet([
      { name: 'State=Default', parts: [] },
      { name: 'State=Hover', parts: [] },
      {
        name: 'State=Focus',
        parts: [{ name: 'Focus Rect', bindings: [{ property: 'strokes', token: 'border/focus' }] }],
      },
    ]);
    expect(extractTokens(set)).toEqual([
      { part: 'Focus Rect', property: 'border', conditions: { State: ['Focus'] }, token: 'border/focus' },
    ]);
  });

  it('conditions on a hidden-but-present part: visible only under one axis value (bug B3)', () => {
    // The common Figma pattern: the layer exists in every variant but is
    // hidden except where it matters. Skipping invisible subtrees lets
    // presence-driven conditioning still fire.
    const focusRect = (visible: boolean) => ({
      name: 'Focus Rect',
      visible,
      bindings: [{ property: 'strokes', token: 'border/focus' }],
    });
    const set = makeSet([
      { name: 'State=Default', parts: [focusRect(false)] },
      { name: 'State=Hover', parts: [focusRect(false)] },
      { name: 'State=Focus', parts: [focusRect(true)] },
    ]);
    expect(extractTokens(set)).toEqual([
      { part: 'Focus Rect', property: 'border', conditions: { State: ['Focus'] }, token: 'border/focus' },
    ]);
  });

  it('emits one rule per token when a cell binds multiple tokens to one property', () => {
    const set = makeSet([
      {
        name: 'A=One',
        parts: [{ name: 'bg', bindings: [
          { property: 'fills', token: 'color/overlay' },
          { property: 'fills', token: 'color/base' },
        ] }],
      },
      {
        name: 'A=Two',
        parts: [{ name: 'bg', bindings: [{ property: 'fills', token: 'color/overlay' }] }],
      },
    ]);
    const tokens = extractTokens(set);
    // overlay is present everywhere → unconditioned; base only on A=One
    expect(tokens).toContainEqual({ part: 'bg', property: 'fill', conditions: {}, token: 'color/overlay' });
    expect(tokens).toContainEqual({ part: 'bg', property: 'fill', conditions: { A: ['One'] }, token: 'color/base' });
  });

  it('merges sibling axis values that share a token', () => {
    const fill = (token: string) => [{ property: 'fills', token }];
    const set = makeSet([
      { name: 'Type=Primary', parts: [{ name: 'bg', bindings: fill('color/primary') }] },
      { name: 'Type=Secondary', parts: [{ name: 'bg', bindings: fill('color/muted') }] },
      { name: 'Type=Tertiary', parts: [{ name: 'bg', bindings: fill('color/muted') }] },
    ]);
    const tokens = extractTokens(set);
    expect(tokens).toContainEqual(
      { part: 'bg', property: 'fill', conditions: { Type: ['Secondary', 'Tertiary'] }, token: 'color/muted' },
    );
  });

  it('orders condition values by the declared variantOptions order', () => {
    const fill = (token: string) => [{ property: 'fills', token }];
    const set = makeSet(
      [
        { name: 'Type=Tertiary', parts: [{ name: 'bg', bindings: fill('color/muted') }] },
        { name: 'Type=Secondary', parts: [{ name: 'bg', bindings: fill('color/muted') }] },
        { name: 'Type=Primary', parts: [{ name: 'bg', bindings: fill('color/primary') }] },
      ],
      { Type: { type: 'VARIANT', defaultValue: 'Primary', variantOptions: ['Primary', 'Secondary', 'Tertiary'] } },
    );
    expect(extractTokens(set)).toContainEqual(
      { part: 'bg', property: 'fill', conditions: { Type: ['Secondary', 'Tertiary'] }, token: 'color/muted' },
    );
  });

  it('deduplicates identical (part, property, token) tuples within a variant (bug 4)', () => {
    const tokens = extractTokens(chip as SerializedNode);
    const iconFills = tokens.filter((t) => t.part === 'icon' && t.property === 'fill');
    expect(iconFills).toEqual([
      { part: 'icon', property: 'fill', conditions: {}, token: 'Text Color/Body/Primary' },
    ]);
  });

  it('collapses padding-left/right and top/bottom pairs into padding-x / padding-y', () => {
    const set = makeSet([
      {
        name: 'Size=XSmall',
        parts: [{ name: 'bg', bindings: [
          { property: 'paddingLeft', token: 'size-12' },
          { property: 'paddingRight', token: 'size-12' },
          { property: 'paddingTop', token: 'size-4' },
          { property: 'paddingBottom', token: 'size-4' },
        ] }],
      },
    ]);
    const tokens = extractTokens(set);
    expect(tokens).toContainEqual({ part: 'bg', property: 'padding-x', conditions: {}, token: 'size-12' });
    expect(tokens).toContainEqual({ part: 'bg', property: 'padding-y', conditions: {}, token: 'size-4' });
  });

  it('collapses all four equal paddings into a single padding rule', () => {
    const set = makeSet([
      {
        name: 'Size=M',
        parts: [{ name: 'bg', bindings: [
          { property: 'paddingLeft', token: 'size-8' },
          { property: 'paddingRight', token: 'size-8' },
          { property: 'paddingTop', token: 'size-8' },
          { property: 'paddingBottom', token: 'size-8' },
        ] }],
      },
    ]);
    expect(extractTokens(set)).toEqual([
      { part: 'bg', property: 'padding', conditions: {}, token: 'size-8' },
    ]);
  });

  it('suppresses typography sub-properties when a composite typography binding exists', () => {
    const set = makeSet([
      {
        name: 'Size=M',
        parts: [{ name: 'Label', type: 'TEXT', bindings: [
          { property: 'typography', token: 'Action/M' },
          { property: 'fontSize', token: 'font-size/fs-200' },
          { property: 'lineHeight', token: 'line-height/lh-400' },
        ] }],
      },
    ]);
    expect(extractTokens(set)).toEqual([
      { part: 'Label', property: 'typography', conditions: {}, token: 'Action/M' },
    ]);
  });

  it('strips Figma prop-binding suffixes from part names', () => {
    const set = makeSet([
      {
        name: 'Size=M',
        parts: [{ name: 'icon-primary#', bindings: [{ property: 'fills', token: 'color/icon' }] }],
      },
    ]);
    expect(extractTokens(set)).toEqual([
      { part: 'icon-primary', property: 'fill', conditions: {}, token: 'color/icon' },
    ]);
  });

  it('falls back to a Variant pseudo-axis when names are not Axis=Value shaped', () => {
    const fill = (token: string) => [{ property: 'fills', token }];
    const set = makeSet([
      { name: 'Plain', parts: [{ name: 'bg', bindings: fill('color/base') }] },
      { name: 'Fancy Variant', parts: [{ name: 'bg', bindings: fill('color/fancy') }] },
    ]);
    const tokens = extractTokens(set);
    expect(tokens).toContainEqual(
      { part: 'bg', property: 'fill', conditions: { Variant: ['Plain'] }, token: 'color/base' },
    );
    expect(tokens).toContainEqual(
      { part: 'bg', property: 'fill', conditions: { Variant: ['Fancy Variant'] }, token: 'color/fancy' },
    );
  });

  it('lists the default-variant rule before the others', () => {
    const tokens = extractTokens(root);
    const containerFills = tokens.filter((t) => t.part === 'container' && t.property === 'fill');
    expect(containerFills[0].token).toBe('md.sys.color.primary');
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
                { name: 'bg', bindings: [{ property: 'fills', token: fillToken(type, state, danger, disabled) }] },
                { name: 'Label', type: 'TEXT', bindings: [{ property: 'typography', token: `action/${size}` }] },
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
      part: 'bg', property: 'fill',
      conditions: { Type: ['Primary'], Disabled: ['true'] },
      token: 'bg/primary-disabled',
    });
    expect(fills).toContainEqual({
      part: 'bg', property: 'fill',
      conditions: { Type: ['Secondary', 'Tertiary'], State: ['Hover'], Danger: ['true'] },
      token: 'bg/danger-secondary-Hover',
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
      { part: 'debug-overlay', issue: 'hardcoded color (no variable or style)' },
    );
  });

  it('flags TEXT parts with no text style or typography variable', () => {
    expect(extractGaps(root)).toContainEqual(
      { part: 'label', issue: 'no text style or typography variable' },
    );
  });

  it('flags hardcoded layout values not bound to variables', () => {
    const gaps = extractGaps(root);
    expect(gaps).toContainEqual({ part: 'container', issue: 'hardcoded itemSpacing (8px)' });
    expect(gaps).toContainEqual({ part: 'container', issue: 'hardcoded padding' });
    // cornerRadius IS bound on container → must NOT be flagged
    expect(gaps).not.toContainEqual(expect.objectContaining({ issue: expect.stringContaining('cornerRadius') }));
  });
});

describe('extractGaps coverage', () => {
  const comp = (extra: Partial<SerializedNode>): SerializedNode => ({
    id: 'v0', name: 'Button', type: 'COMPONENT', visible: true, ...extra,
  });

  it('reports a hardcoded stroke color', () => {
    const gaps = extractGaps(comp({ hasUnboundStroke: true }));
    expect(gaps).toContainEqual({ part: 'Button', issue: 'hardcoded stroke color (no variable or style)' });
  });

  it('reports a hardcoded gradient or image fill', () => {
    const gaps = extractGaps(comp({ hasUnboundGradient: true }));
    expect(gaps).toContainEqual({ part: 'Button', issue: 'hardcoded gradient or image fill (no style)' });
  });

  it('reports an unbound effect', () => {
    const gaps = extractGaps(comp({ hasUnboundEffect: true }));
    expect(gaps).toContainEqual({ part: 'Button', issue: 'hardcoded shadow or blur (no effect style)' });
  });

  it('reports a hand-set opacity', () => {
    const gaps = extractGaps(comp({ opacity: 0.5 }));
    expect(gaps).toContainEqual({ part: 'Button', issue: 'hardcoded opacity (0.5)' });
  });

  it('does not report opacity when it is fully opaque', () => {
    expect(extractGaps(comp({ opacity: 1 }))).toEqual([]);
  });

  it('does not report opacity when it is bound to a variable', () => {
    const gaps = extractGaps(comp({ opacity: 0.5, bindings: [{ property: 'opacity', token: 'a/b' }] }));
    expect(gaps).toEqual([]);
  });

  it('reports both a hardcoded fill and a hardcoded stroke on the same part', () => {
    // pushGap dedupes on (part, issue), not on part alone — two distinct issues
    // on one part must not collapse into one gap.
    const gaps = extractGaps(comp({ hasUnboundPaint: true, hasUnboundStroke: true }));
    expect(gaps).toContainEqual({ part: 'Button', issue: 'hardcoded color (no variable or style)' });
    expect(gaps).toContainEqual({ part: 'Button', issue: 'hardcoded stroke color (no variable or style)' });
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
        { id: 'a', name: 'icon', type: 'FRAME', visible: true, bindings: [{ property: 'fills', token: 'tok/leading' }] },
        { id: 'b', name: 'label', type: 'TEXT', visible: true, bindings: [{ property: 'fills', token: 'tok/text' }] },
        { id: 'c', name: 'icon', type: 'FRAME', visible: true, bindings: [{ property: 'fills', token: 'tok/trailing' }] },
      ],
    }],
  };

  it('keeps two same-named siblings as distinct parts', () => {
    const byPart = extractTokens(set).map((r) => `${r.part}=${r.token}`);
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
          { id: 'a', name: 'icon', type: 'FRAME', visible: false, bindings: [{ property: 'fills', token: 'tok/hidden' }] },
          { id: 'b', name: 'label', type: 'TEXT', visible: true, bindings: [{ property: 'fills', token: 'tok/text' }] },
          { id: 'c', name: 'icon', type: 'FRAME', visible: true, bindings: [{ property: 'fills', token: 'tok/trailing' }] },
        ],
      }],
    };
    const byPart = extractTokens(set).map((r) => `${r.part}=${r.token}`);
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
          { id: 'a', name: 'icon', type: 'FRAME', visible: true, bindings: [{ property: 'fills', token: 'tok/1' }] },
          { id: 'b', name: 'icon', type: 'FRAME', visible: true, bindings: [{ property: 'fills', token: 'tok/2' }] },
          { id: 'c', name: 'icon', type: 'FRAME', visible: true, bindings: [{ property: 'fills', token: 'tok/3' }] },
        ],
      }],
    };
    const byPart = extractTokens(set).map((r) => `${r.part}=${r.token}`);
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
          bindings: [{ property: 'fills', token: 'tok/a' }] },
        { id: 'v1', name: 'Size=M, Size=S', type: 'COMPONENT', visible: true,
          bindings: [{ property: 'fills', token: 'tok/b' }] },
      ],
    };
    const rules = extractTokens(set);
    const containerFills = rules.filter((r) => r.part === 'Container' && r.property === 'fill');
    // Exactly one rule survives. Emitting BOTH would tell the reader that one
    // variant carries two different fills at once, which no variant does.
    expect(containerFills).toHaveLength(1);
  });
});
