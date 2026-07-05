import type { VariantAxis } from './props';
import type { TokenRule } from './tokens';
import { isModifierAxis, isStateAxisName } from './pivot';
import { resolveTokensForVariant, type ResolvedToken } from './resolve';

export interface StateMatrixInfo {
  axis: string;
  states: string[];
  rowAxis: string | null;
}

/** Conventional lifecycle order; unrecognized states trail in axis order. */
const STATE_ORDER = [
  'default', 'enabled', 'rest', 'hover', 'focus', 'focused', 'active',
  'pressed', 'selected', 'disabled', 'error', 'danger', 'loading', 'empty',
  'readonly', 'visited',
];

const STATE_VOCAB = new Set(STATE_ORDER);

function orderStates(values: string[]): string[] {
  const rank = (v: string): number => {
    const i = STATE_ORDER.indexOf(v.trim().toLowerCase());
    return i === -1 ? STATE_ORDER.length : i;
  };
  // Stable: unrecognized values keep their relative axis order.
  return values.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i).map((x) => x.v);
}

/** An axis is state-like when named State/Status, or when ≥2 of its values sit
 *  in the state vocabulary. */
function isStateLike(axis: VariantAxis): boolean {
  const n = axis.prop.trim().toLowerCase();
  if (isStateAxisName(axis.prop) || n === 'status') return true;
  const hits = axis.values.filter((v) => STATE_VOCAB.has(v.trim().toLowerCase())).length;
  return hits >= 2;
}

export function detectStateMatrix(variants: VariantAxis[]): StateMatrixInfo | null {
  const stateAxis = variants.find(isStateLike) ?? null;
  if (!stateAxis) return null;
  const rowAxis =
    variants.find((v) => v.prop !== stateAxis.prop && !isModifierAxis(v) && !isStateLike(v)) ?? null;
  return {
    axis: stateAxis.prop,
    states: orderStates(stateAxis.values),
    rowAxis: rowAxis?.prop ?? null,
  };
}

export interface StateDelta { state: string; changes: ResolvedToken[] }

/**
 * For each non-default state, the tokens that differ from the default state's
 * resolution — the deterministic answer to "what defines Hover".
 */
export function stateTokenDeltas(
  tokens: TokenRule[],
  defaults: Record<string, string>,
  info: StateMatrixInfo,
): StateDelta[] {
  const key = (t: ResolvedToken): string => `${t.part}\0${t.property}\0${t.token}`;
  const base = new Set(resolveTokensForVariant(tokens, defaults).map(key));
  const defaultState = defaults[info.axis];

  const out: StateDelta[] = [];
  for (const state of info.states) {
    if (state === defaultState) continue;
    const resolved = resolveTokensForVariant(tokens, { ...defaults, [info.axis]: state });
    const changes = resolved.filter((t) => !base.has(key(t)));
    if (changes.length) out.push({ state, changes });
  }
  return out;
}
