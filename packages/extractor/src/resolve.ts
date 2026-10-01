import type { TokenRule } from './tokens';

export interface ResolvedToken {
  part: string;
  property: string;
  token: string;
}

/** The token rules that apply to one variant (`values`: axis -> selected value). */
export function resolveTokensForVariant(
  tokens: TokenRule[],
  values: Record<string, string>,
): ResolvedToken[] {
  return tokens
    .filter((rule) => matchesVariant(rule.conditions, values))
    // `token` stays the field name: the canvas view models carry no id or kind.
    .map(({ part, property, name }) => ({ part, property, token: name }));
}

/** Shared with diff.ts so the change list and the canvas agree on which
 *  variants a rule reaches. An unconditioned rule matches every variant. */
export function matchesVariant(conditions: Record<string, string[]>, values: Record<string, string>): boolean {
  for (const [axis, allowed] of Object.entries(conditions)) {
    const v = values[axis];
    if (v === undefined) return false;
    if (!allowed.includes(v)) return false;
  }
  return true;
}
