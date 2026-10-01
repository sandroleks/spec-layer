import type { TokenRule } from './tokens';
import type { VariantAxis } from './props';

/** Which Tokens-used sub-section a property belongs to. */
export type PropertyCategory = 'color' | 'typography' | 'measurements';

const COLOR_PROPS = new Set(['fill', 'border', 'background', 'color', 'outline']);
const TYPOGRAPHY_PROPS = new Set([
  'typography', 'font-size', 'font-family', 'font-weight', 'font-style',
  'line-height', 'letter-spacing',
]);

export function categorize(property: string): PropertyCategory {
  if (COLOR_PROPS.has(property)) return 'color';
  if (TYPOGRAPHY_PROPS.has(property)) return 'typography';
  return 'measurements';
}

/** Variant axis whose values are exactly {true, false} (case-insensitive). */
export function isModifierAxis(axis: VariantAxis): boolean {
  if (axis.values.length !== 2) return false;
  const lower = axis.values.map((v) => v.toLowerCase());
  return lower.includes('true') && lower.includes('false');
}

export function isStateAxisName(prop: string): boolean {
  const n = prop.trim().toLowerCase();
  return n === 'state' || n === 'states';
}

export function ruleMatchesConfig(rule: TokenRule, config: Record<string, string>): boolean {
  for (const [axis, value] of Object.entries(config)) {
    const allowed = rule.conditions[axis];
    if (allowed && !allowed.includes(value)) return false;
  }
  return true;
}
