import type { VariantAxis } from './props';
import { isModifierAxis, isStateAxisName } from './pivot';

/** A single column in the states matrix: a header label plus the axis→value
 *  overrides applied on top of the default variant to reach this column.
 *  Empty `override` for the synthesized flags "Default" column. */
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

/** Conventional lifecycle order; unrecognized states trail in axis order. */
const STATE_ORDER = [
  'default', 'enabled', 'rest', 'hover', 'focus', 'focused', 'active',
  'pressed', 'selected', 'disabled', 'error', 'danger', 'loading', 'empty',
  'readonly', 'visited',
];

const STATE_VOCAB = new Set(STATE_ORDER);

/** Rank a state-like name by conventional lifecycle order; unrecognized names
 *  sort last (stable relative to their original order via the caller). */
function stateRank(v: string): number {
  const i = STATE_ORDER.indexOf(v.trim().toLowerCase());
  return i === -1 ? STATE_ORDER.length : i;
}

function orderStates(values: string[]): string[] {
  // Stable: unrecognized values keep their relative axis order.
  return values.map((v, i) => ({ v, i })).sort((a, b) => stateRank(a.v) - stateRank(b.v) || a.i - b.i).map((x) => x.v);
}

/** An axis is state-like when named State/Status, or when ≥2 of its values sit
 *  in the state vocabulary. */
function isStateLike(axis: VariantAxis): boolean {
  const n = axis.prop.trim().toLowerCase();
  if (isStateAxisName(axis.prop) || n === 'status') return true;
  const hits = axis.values.filter((v) => STATE_VOCAB.has(v.trim().toLowerCase())).length;
  return hits >= 2;
}

/** True when a prop name itself names a state concept — used to pick out
 *  boolean state-flag axes (Hover/Disabled/…) as distinct from unrelated
 *  boolean modifiers (HasIcon, …). */
export function isStateVocabName(prop: string): boolean {
  const n = prop.trim().toLowerCase();
  return isStateAxisName(prop) || n === 'status' || STATE_VOCAB.has(n);
}

/** The axis value that represents "flag on": prefer a case-insensitive
 *  "true" match, else the last value. */
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

/** The variant props that the States matrix consumes: the enum state axis, or
 *  the boolean state-flag axes. Variants excludes exactly these. */
export function stateAxisProps(variants: VariantAxis[]): Set<string> {
  const info = detectStateMatrix(variants);
  if (!info) return new Set();
  if (info.encoding === 'enum') return new Set(info.axis ? [info.axis] : []);
  const props = new Set<string>();
  for (const col of info.columns) for (const k of Object.keys(col.override)) props.add(k);
  return props;
}
