import { describe, expect, it } from 'vitest';
import {
  categorize, pivotColorPart, flatPartTable, flatGlobalTable, fixedTable,
  isUnconditioned, isModifierAxis, isStateAxisName,
} from '../src/pivot';
import type { TokenRule } from '../src/tokens';
import type { VariantAxis } from '../src/props';

describe('categorize', () => {
  it('classifies color properties', () => {
    expect(categorize('fill')).toBe('color');
    expect(categorize('border')).toBe('color');
    expect(categorize('background')).toBe('color');
    expect(categorize('color')).toBe('color');
    expect(categorize('outline')).toBe('color');
  });

  it('classifies typography properties', () => {
    expect(categorize('typography')).toBe('typography');
    expect(categorize('font-size')).toBe('typography');
    expect(categorize('font-weight')).toBe('typography');
    expect(categorize('line-height')).toBe('typography');
    expect(categorize('letter-spacing')).toBe('typography');
  });

  it('classifies everything else as measurements', () => {
    expect(categorize('border-radius')).toBe('measurements');
    expect(categorize('padding')).toBe('measurements');
    expect(categorize('padding-x')).toBe('measurements');
    expect(categorize('gap')).toBe('measurements');
  });
});

describe('axis predicates', () => {
  it('isUnconditioned', () => {
    expect(isUnconditioned({ part: 'p', path: 'Container/p', property: 'fill', conditions: {}, token: 't' })).toBe(true);
    expect(isUnconditioned({ part: 'p', path: 'Container/p', property: 'fill', conditions: { Type: ['A'] }, token: 't' })).toBe(false);
  });

  it('isModifierAxis recognizes true/false pairs', () => {
    expect(isModifierAxis({ prop: 'Danger', values: ['false', 'true'] })).toBe(true);
    expect(isModifierAxis({ prop: 'Disabled', values: ['true', 'false'] })).toBe(true);
    expect(isModifierAxis({ prop: 'Type', values: ['Primary', 'Secondary'] })).toBe(false);
    expect(isModifierAxis({ prop: 'X', values: ['true'] })).toBe(false);
  });

  it('isStateAxisName matches State/States', () => {
    expect(isStateAxisName('State')).toBe(true);
    expect(isStateAxisName('states')).toBe(true);
    expect(isStateAxisName('Type')).toBe(false);
  });
});

describe('pivotColorPart', () => {
  // Type (columns), State (rows), Danger (modifier). Enough axes to exercise
  // the full pivot. Tests use >3 rules to clear the compact-table threshold.
  const variants: VariantAxis[] = [
    { prop: 'Type', values: ['Primary', 'Secondary', 'Tertiary'] },
    { prop: 'State', values: ['Default', 'Hover', 'Press'] },
    { prop: 'Danger', values: ['false', 'true'] },
  ];
  const defaults = { Type: 'Primary', State: 'Default', Danger: 'false' };

  it('pivots State as rows and Type as columns', () => {
    const rules: TokenRule[] = [
      { part: 'Container', path: 'Container/Container', property: 'fill', conditions: { Type: ['Primary'], State: ['Default'] }, token: 'action' },
      { part: 'Container', path: 'Container/Container', property: 'fill', conditions: { State: ['Hover'] }, token: 'hover' },
      { part: 'Container', path: 'Container/Container', property: 'fill', conditions: { Type: ['Secondary'], State: ['Default'] }, token: 'sec' },
      { part: 'Container', path: 'Container/Container', property: 'border', conditions: { Type: ['Secondary'], State: ['Default'] }, token: 'sec-border' },
    ];
    const md = pivotColorPart(rules, variants, defaults)!.join('\n');
    expect(md).toContain('| Property | State | Primary | Secondary | Tertiary |');
    expect(md).toContain('| fill | Default | `action` | `sec` | — |');
    // A rule without a Type condition fills every column.
    expect(md).toContain('| fill | Hover | `hover` | `hover` | `hover` |');
  });

  it('renders a compact flat table for parts at or below the threshold', () => {
    const rules: TokenRule[] = [
      { part: 'Focus', path: 'Container/Focus', property: 'border', conditions: { State: ['Hover'] }, token: 'a' },
      { part: 'Focus', path: 'Container/Focus', property: 'border', conditions: { State: ['Press'] }, token: 'b' },
    ];
    const md = pivotColorPart(rules, variants, defaults)!.join('\n');
    expect(md).toContain('| Property | Condition | Token |');
    expect(md).toContain('| border | State=Hover | `a` |');
    expect(md).not.toContain('| Primary |');
  });

  it('drops the State column when no rule conditions on State', () => {
    const rules: TokenRule[] = [
      { part: 'Label', path: 'Container/Label', property: 'fill', conditions: { Type: ['Primary'] }, token: 'p' },
      { part: 'Label', path: 'Container/Label', property: 'fill', conditions: { Type: ['Secondary'] }, token: 's' },
      { part: 'Label', path: 'Container/Label', property: 'fill', conditions: { Type: ['Tertiary'] }, token: 't' },
      { part: 'Label', path: 'Container/Label', property: 'border', conditions: { Type: ['Secondary'] }, token: 'b' },
    ];
    const md = pivotColorPart(rules, variants, defaults)!.join('\n');
    expect(md).toContain('| Property | Primary | Secondary | Tertiary |');
    expect(md).toContain('| fill | `p` | `s` | `t` |');
    expect(md).not.toMatch(/\| State \|/);
  });

  it('emits a single Token column when no column axis is used', () => {
    const rules: TokenRule[] = [
      { part: 'icon', path: 'Container/icon', property: 'fill', conditions: { State: ['Default'] }, token: 'd' },
      { part: 'icon', path: 'Container/icon', property: 'fill', conditions: { State: ['Hover'] }, token: 'h' },
      { part: 'icon', path: 'Container/icon', property: 'fill', conditions: { State: ['Press'] }, token: 'pr' },
      { part: 'icon', path: 'Container/icon', property: 'border', conditions: { State: ['Default'] }, token: 'bd' },
    ];
    const md = pivotColorPart(rules, variants, defaults)!.join('\n');
    expect(md).toContain('| Property | State | Token |');
    expect(md).toContain('| fill | Hover | `h` |');
  });

  it('splits boolean (modifier) axes into base + "When X = v" sub-tables', () => {
    const rules: TokenRule[] = [
      { part: 'Container', path: 'Container/Container', property: 'fill', conditions: { Type: ['Primary'], Danger: ['false'] }, token: 'action' },
      { part: 'Container', path: 'Container/Container', property: 'fill', conditions: { Type: ['Secondary'], Danger: ['false'] }, token: 'sec' },
      { part: 'Container', path: 'Container/Container', property: 'fill', conditions: { Type: ['Primary'], Danger: ['true'] }, token: 'danger' },
      { part: 'Container', path: 'Container/Container', property: 'fill', conditions: { Type: ['Secondary'], Danger: ['true'] }, token: 'sec-danger' },
    ];
    const md = pivotColorPart(rules, variants, defaults)!.join('\n');
    expect(md).toContain('| fill | `action` | `sec` | — |');
    expect(md).toContain('**When Danger = true**');
    expect(md).toMatch(/When Danger = true[\s\S]*`danger`[\s\S]*`sec-danger`/);
  });

  it('emits no double blank line before a "When" sub-table title', () => {
    const rules: TokenRule[] = [
      { part: 'Container', path: 'Container/Container', property: 'fill', conditions: { Type: ['Primary'], Danger: ['false'] }, token: 'action' },
      { part: 'Container', path: 'Container/Container', property: 'fill', conditions: { Type: ['Secondary'], Danger: ['false'] }, token: 'sec' },
      { part: 'Container', path: 'Container/Container', property: 'fill', conditions: { Type: ['Primary'], Danger: ['true'] }, token: 'danger' },
      { part: 'Container', path: 'Container/Container', property: 'fill', conditions: { Type: ['Secondary'], Danger: ['true'] }, token: 'sec-danger' },
    ];
    const out = pivotColorPart(rules, variants, defaults)!;
    expect(out.join('\n')).not.toContain('\n\n\n');
  });

  it('pulls rules on a non-pivot axis into an Exceptions table', () => {
    const variantsE: VariantAxis[] = [
      { prop: 'Type', values: ['Primary', 'Secondary', 'Tertiary'] },
      { prop: 'Size', values: ['S', 'M', 'L'] },
      { prop: 'State', values: ['Default', 'Focus'] },
    ];
    const rules: TokenRule[] = [
      { part: 'Label', path: 'Container/Label', property: 'fill', conditions: { Type: ['Primary'] }, token: 'p' },
      { part: 'Label', path: 'Container/Label', property: 'fill', conditions: { Type: ['Secondary'] }, token: 's' },
      { part: 'Label', path: 'Container/Label', property: 'fill', conditions: { Type: ['Tertiary'] }, token: 't' },
      { part: 'Label', path: 'Container/Label', property: 'fill', conditions: { Size: ['L'], Type: ['Secondary'], State: ['Focus'] }, token: 'big-focus' },
    ];
    const md = pivotColorPart(rules, variantsE, { Type: 'Primary', Size: 'S', State: 'Default' })!.join('\n');
    // Type wins the column axis (3 rules vs Size's 1); the Size rule is an exception.
    expect(md).toContain('| Property | Primary | Secondary | Tertiary |');
    expect(md).toContain('**Exceptions**');
    expect(md).toContain('| fill | Size=L, Type=Secondary, State=Focus | `big-focus` |');
  });

  // B2: sub-tables only cover the base config and single-modifier flips, so a
  // rule conditioned on TWO non-default modifier values matches none of them —
  // it must be demoted to Exceptions instead of silently vanishing.
  it('demotes rules conditioned on two non-default modifier values to Exceptions (B2)', () => {
    const variantsM: VariantAxis[] = [
      { prop: 'Type', values: ['Primary', 'Secondary', 'Tertiary'] },
      { prop: 'Selected', values: ['false', 'true'] },
      { prop: 'Disabled', values: ['false', 'true'] },
    ];
    const rules: TokenRule[] = [
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { Type: ['Primary'] }, token: 'p' },
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { Type: ['Secondary'] }, token: 's' },
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { Selected: ['true'] }, token: 'sel' },
      { part: 'bg', path: 'Container/bg', property: 'fill', conditions: { Selected: ['true'], Disabled: ['true'] }, token: 'sel-dis' },
    ];
    const md = pivotColorPart(rules, variantsM, { Type: 'Primary', Selected: 'false', Disabled: 'false' })!.join('\n');
    expect(md).toContain('**Exceptions**');
    expect(md).toContain('| fill | Selected=true, Disabled=true | `sel-dis` |');
    // Lossless: every rule's token still appears somewhere in the output.
    for (const r of rules) expect(md).toContain(`\`${r.token}\``);
  });

  it('renders every claimed token when equally-specific rules collide on a cell', () => {
    const variantsC: VariantAxis[] = [
      { prop: 'Type', values: ['A', 'B'] },
      { prop: 'State', values: ['X', 'Y'] },
    ];
    const rules: TokenRule[] = [
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { Type: ['A'] }, token: 't1' },
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { State: ['X'] }, token: 't2' },
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { Type: ['B'], State: ['X'] }, token: 't3' },
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { Type: ['B'], State: ['Y'] }, token: 't4' },
    ];
    const md = pivotColorPart(rules, variantsC, { Type: 'A', State: 'X' })!.join('\n');
    // (X, A): t1 (Type=A) and t2 (State=X) both score 1 -> both shown.
    expect(md).toContain('`t1` · `t2`');
    // (X, B): t3 (score 2) beats t2 (score 1).
    expect(md).toContain('`t3`');
  });

  it('prefers the more specific rule (more conditioned axes) at a cell', () => {
    const rules: TokenRule[] = [
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { State: ['Hover'] }, token: 'general' },
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { Type: ['Primary'], State: ['Hover'] }, token: 'specific' },
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { Type: ['Secondary'], State: ['Default'] }, token: 'sec' },
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { Type: ['Tertiary'], State: ['Press'] }, token: 'ter' },
    ];
    const md = pivotColorPart(rules, variants, defaults)!.join('\n');
    // Primary/Hover -> specific (2 axes); Secondary/Tertiary at Hover -> general (1 axis).
    expect(md).toContain('| fill | Hover | `specific` | `general` | `general` |');
  });

  it('returns null when a rule conditions on an axis missing from variants', () => {
    const rules: TokenRule[] = [
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { Ghost: ['x'] }, token: 't' },
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { Type: ['Primary'] }, token: 'a' },
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { Type: ['Secondary'] }, token: 'b' },
      { part: 'p', path: 'Container/p', property: 'fill', conditions: { Type: ['Tertiary'] }, token: 'c' },
    ];
    expect(pivotColorPart(rules, variants, defaults)).toBeNull();
  });

  it('returns an empty array when given no rules', () => {
    expect(pivotColorPart([], variants, defaults)).toEqual([]);
  });
});

describe('flat + fixed table helpers', () => {
  it('flatPartTable renders Property | Condition | Token rows', () => {
    const rules: TokenRule[] = [
      { part: 'Container', path: 'Container/Container', property: 'border-radius', conditions: {}, token: 'rounded' },
      { part: 'Container', path: 'Container/Container', property: 'padding-x', conditions: { Size: ['S'] }, token: 'pad-s' },
    ];
    const md = flatPartTable(rules).join('\n');
    expect(md).toContain('| Property | Condition | Token |');
    expect(md).toContain('| border-radius | — | `rounded` |');
    expect(md).toContain('| padding-x | Size=S | `pad-s` |');
  });

  it('flatGlobalTable adds a Part column', () => {
    const rules: TokenRule[] = [
      { part: 'Label', path: 'Container/Label', property: 'typography', conditions: { Size: ['M'] }, token: 'body-m' },
    ];
    const md = flatGlobalTable(rules).join('\n');
    expect(md).toContain('| Part | Property | Condition | Token |');
    expect(md).toContain('| Label | typography | Size=M | `body-m` |');
  });

  it('fixedTable lists part, property, token for unconditioned bindings', () => {
    const md = fixedTable([
      { part: 'icon-primary', rule: { part: 'icon-primary', path: 'Container/icon-primary', property: 'fill', conditions: {}, token: 'Navy' } },
      { part: 'icon-secondary', rule: { part: 'icon-secondary', path: 'Container/icon-secondary', property: 'fill', conditions: {}, token: 'Navy' } },
    ]).join('\n');
    expect(md).toContain('| Part | Property | Token |');
    expect(md).toContain('| icon-primary | fill | `Navy` |');
  });
});
