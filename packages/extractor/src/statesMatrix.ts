import type { VariantAxis } from './props';
import { isModifierAxis, isStateAxisName } from './pivot';

/** A header label plus the axis→value overrides applied to the default
 *  variant; empty `override` for the synthesized flags "Default" column. */
export interface StateColumn {
  label: string;
  override: Record<string, string>;
}

export interface StateMatrixInfo {
  encoding: 'enum' | 'flags';
  /** Ordered; the default/base column is first. */
  columns: StateColumn[];
  /** First non-state, non-modifier axis, used as the matrix's row axis. */
  rowAxis: string | null;
  /** Enum: the state-axis prop name. Flags: null. */
  axis: string | null;
}

/**
 * Conventional lifecycle order; unrecognized states trail in axis order.
 * `hover` and `focus` are listed as noun and participle, since designers name
 * them both ways. `pressed`, `selected` and the like are participle only: the
 * bare verb ("Press", "Select") names an action, not a state.
 */
const STATE_ORDER = [
  'default', 'enabled', 'rest', 'hover', 'hovered', 'focus', 'focused',
  'active', 'pressed', 'selected', 'filled', 'disabled', 'error', 'danger',
  'warning', 'success', 'loading', 'empty', 'checked', 'invalid',
  'readonly', 'visited',
];

const STATE_VOCAB = new Set(STATE_ORDER);

/** Tested one character at a time, so no whitespace run can backtrack. */
const WHITESPACE = /\s/;

/**
 * The state concept a prop/value names, trailing parenthetical stripped:
 * `active (Filled)` → `active`.
 *
 * A reverse scan, because `replace(/\s*\([^)]*\)\s*$/, '')` is quadratic.
 * The result reaches `spec.states` and `specContentHash`, so it must equal the
 * regex for every input; `redos.test.ts` pins that. Read right to left: `$`,
 * `\s*`, `\)`, `[^)]*` back to a `\(`, `\s*`. `[^)]*` may contain `(` and the
 * LEFTMOST match wins, so `a ((x)` gives `a`, not `a (`.
 */
export function stateBaseName(v: string): string {
  const lowered = v.trim().toLowerCase();
  let end = lowered.length;
  while (end > 0 && WHITESPACE.test(lowered[end - 1])) end--;
  if (end === 0 || lowered[end - 1] !== ')') return lowered.trim();

  // Walk back over the `[^)]*` run, remembering the earliest `(` in it.
  let open = -1;
  for (let i = end - 2; i >= 0; i--) {
    const ch = lowered[i];
    if (ch === ')') break;
    if (ch === '(') open = i;
  }
  if (open === -1) return lowered.trim();

  let cut = open;
  while (cut > 0 && WHITESPACE.test(lowered[cut - 1])) cut--;
  return lowered.slice(0, cut).trim();
}

/** Unrecognized names rank last; the caller keeps them stable. */
function stateRank(v: string): number {
  const i = STATE_ORDER.indexOf(stateBaseName(v));
  return i === -1 ? STATE_ORDER.length : i;
}

function orderStates(values: string[]): string[] {
  // Stable: unrecognized values keep their relative axis order.
  return values.map((v, i) => ({ v, i })).sort((a, b) => stateRank(a.v) - stateRank(b.v) || a.i - b.i).map((x) => x.v);
}

/** Named State/Status, or ≥2 values in the state vocabulary. Exported so
 *  validate.ts tests exactly what detectStateMatrix tests. */
export function isStateLike(axis: VariantAxis): boolean {
  const n = axis.prop.trim().toLowerCase();
  if (isStateAxisName(axis.prop) || n === 'status') return true;
  const hits = axis.values.filter((v) => STATE_VOCAB.has(v.trim().toLowerCase())).length;
  return hits >= 2;
}

/** Picks out boolean state-flag axes (Hover, Disabled) from unrelated
 *  boolean modifiers (HasIcon). */
export function isStateVocabName(prop: string): boolean {
  const n = prop.trim().toLowerCase();
  return isStateAxisName(prop) || n === 'status' || STATE_VOCAB.has(stateBaseName(prop));
}

/** "Flag on": a case-insensitive "true", else the last value. */
function trueValueOf(axis: VariantAxis): string {
  return axis.values.find((v) => v.toLowerCase() === 'true') ?? axis.values[axis.values.length - 1];
}

export function detectStateMatrix(variants: VariantAxis[]): StateMatrixInfo | null {
  const stateAxis = variants.find(isStateLike) ?? null;

  if (stateAxis) {
    const rowAxis =
      variants.find((v) => v.prop !== stateAxis.prop && !isModifierAxis(v) && !isStateLike(v)) ?? null;
    const columns: StateColumn[] = orderStates(stateAxis.values).map((v) => ({
      label: v,
      override: { [stateAxis.prop]: v },
    }));
    return { encoding: 'enum', columns, rowAxis: rowAxis?.prop ?? null, axis: stateAxis.prop };
  }

  // Flags path: boolean variant axes whose prop name is itself a state word.
  const flags = variants.filter((v) => isModifierAxis(v) && isStateVocabName(v.prop));
  if (flags.length === 0) return null;

  const orderedFlagProps = orderStates(flags.map((f) => f.prop));
  const orderedFlags = orderedFlagProps.map((p) => flags.find((f) => f.prop === p)!);

  const columns: StateColumn[] = [
    { label: 'Default', override: {} },
    ...orderedFlags.map((f) => ({ label: f.prop, override: { [f.prop]: trueValueOf(f) } })),
  ];
  const rowAxis = variants.find((v) => !isModifierAxis(v) && !isStateLike(v)) ?? null;
  return { encoding: 'flags', columns, rowAxis: rowAxis?.prop ?? null, axis: null };
}

/** The variant props the States matrix consumes; Variants excludes exactly these. */
export function stateAxisProps(variants: VariantAxis[]): Set<string> {
  const info = detectStateMatrix(variants);
  if (!info) return new Set();
  if (info.encoding === 'enum') return new Set(info.axis ? [info.axis] : []);
  const props = new Set<string>();
  for (const col of info.columns) for (const k of Object.keys(col.override)) props.add(k);
  return props;
}
