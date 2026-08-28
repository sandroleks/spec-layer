/**
 * The canonical value model — spec §9.
 *
 * One discriminated shape for every value in the artifact. v4's `valueOf`
 * emitted FOUR shapes for one `values` field -- an `{alias, resolved}` object,
 * a bare string, a bare number and a `{hex, alpha}` object -- so every consumer
 * needed a four-way type branch to read a single field. Here the branch is on
 * one key, `kind`, and it is always present.
 *
 * The rule this file exists to enforce: a value that is not known is
 * represented as a value that is not known. Never a plausible default. A
 * substituted black is indistinguishable from a measured one downstream, which
 * is how a generator ships something confidently wrong.
 */

export type TokenType =
  | 'color' | 'dimension' | 'number' | 'string' | 'boolean'
  | 'duration' | 'cubic_bezier' | 'font_family';

/** §9.5. `unitless` is deliberately absent: a unitless quantity is
 *  `type: number`, not a dimension with a null unit. */
export type Unit = 'px' | 'rem' | 'em' | '%' | 'deg' | 'ms' | 's';

/** Runtime mirrors of the two unions above. Types are erased at compile time,
 *  so without these the published JSON Schema and this module can drift with
 *  nothing to catch it. Kept adjacent to their types so a new member is one
 *  edit, and asserted equal in the schema test. */
export const SUPPORTED_UNITS: readonly Unit[] =
  ['px', 'rem', 'em', '%', 'deg', 'ms', 's'] as const;
export const SUPPORTED_TOKEN_TYPES: readonly TokenType[] =
  ['color', 'dimension', 'number', 'string', 'boolean',
   'duration', 'cubic_bezier', 'font_family'] as const;
export const SUPPORTED_VALUE_KINDS = ['literal', 'alias', 'missing'] as const;
/** Duration's unit set is a SUBSET of `Unit`, spelled out inline in both
 *  `DurationValue` below and `$defs.duration_value` in the published schema --
 *  and it was the one vocabulary with no runtime mirror, so the schema's copy
 *  had nothing it could be asserted against. Mirrored here for exactly the
 *  reason the two arrays above are. */
export const SUPPORTED_DURATION_UNITS: readonly ('ms' | 's')[] = ['ms', 's'] as const;

export interface ColorValue {
  type: 'color';
  color_space: 'srgb';
  /** Lowercase, six digits, leading `#`. §9.6. */
  hex: string;
  /** 0..1, present even when opaque, so "opaque" and "alpha not stated" are
   *  never the same output. §9.6. */
  alpha: number;
  /** Source channels 0..1, emitted ONLY when the 8-bit hex above loses
   *  precision Figma actually had. Emitting them on every colour would triple
   *  a ramp's size for nothing. */
  channels?: [number, number, number];
}

export interface DimensionValue { type: 'dimension'; number: number; unit: Unit }
export interface NumberValue { type: 'number'; value: number }
export interface StringValue { type: 'string'; value: string }
export interface BooleanValue { type: 'boolean'; value: boolean }
export interface DurationValue { type: 'duration'; number: number; unit: 'ms' | 's' }
export interface CubicBezierValue { type: 'cubic_bezier'; value: [number, number, number, number] }
export interface FontFamilyValue { type: 'font_family'; value: string }

export type TypedValue =
  | ColorValue | DimensionValue | NumberValue | StringValue
  | BooleanValue | DurationValue | CubicBezierValue | FontFamilyValue;

/**
 * One hop of a resolution, identifying BOTH the token and the mode it was read
 * under.
 *
 * A Figma `VARIABLE_ALIAS` points at a variable id and carries no mode: which
 * mode of the target collection applies is resolved from the consuming context,
 * falling back to that collection's default. That makes the mode a decision the
 * extractor makes, and a chain of bare token ids leaves the decision unstated --
 * so a validator, a differ, or a second extractor would each have to re-derive
 * it from mode NAMES or defaults, which is the name-matching this artifact
 * exists to eliminate (§10).
 *
 * Deliberately NOT mirrored as a `target_mode_id` on AliasReference: the
 * reference describes what the source file states, the chain describes what
 * resolution did, and duplicating the first hop's mode across both would give
 * one fact two owners.
 */
export interface ResolutionStep { token_id: string; mode_id: string }

/** §9.2 — authoritative for lineage. `resolved` is a portability snapshot, so
 *  changing an alias target without changing the resolved value still shows up
 *  in a semantic diff (§10). */
export interface AliasReference {
  target_id: string | null;
  target_collection_id: string | null;
  /** Segmented, never joined: a segment can contain the separator, and a joined
   *  string makes "one node or two" unanswerable. */
  target_path: string[];
  external: boolean;
  /** Named only when the target lives in a library this export could not read. */
  source_library_name?: string;
}

export type UnresolvedReason =
  | 'source_library_unavailable' | 'target_not_found' | 'cycle'
  | 'type_mismatch' | 'depth_exceeded' | 'ambiguous_target'
  /**
   * The alias's TARGET was found, but the mode the hop would have to resolve
   * through could not be identified — the target collection declares no
   * usable `default_mode_id` (see §7: "The default mode MUST reference a
   * declared mode ID").
   *
   * A `ResolutionStep` requires BOTH a token id and a mode id, so there is no
   * way to state this hop truthfully. The alternatives were to put some other
   * id in the `mode_id` slot (a fabricated mode) or to claim `status:
   * 'resolved'` with an empty chain (a resolution with no stated hops). Both
   * assert something the source does not support, so the resolution is
   * reported unresolved instead — the value is still recoverable from the
   * target token itself, which is where it actually lives.
   */
  | 'target_mode_unresolvable' | 'target_mode_value_missing';

export type AliasResolution =
  | { status: 'resolved'; value: TypedValue; chain: ResolutionStep[] }
  | { status: 'unresolved'; reason: UnresolvedReason; value: null; chain: ResolutionStep[] };

export type MissingReason =
  | 'no_value_for_mode' | 'unsupported_value_type'
  | 'invalid_source_value' | 'source_unavailable';

export type CanonicalValue =
  | { kind: 'literal'; value: TypedValue }
  | { kind: 'alias'; reference: AliasReference; resolved: AliasResolution }
  | { kind: 'missing'; reason: MissingReason };

export const isLiteral = (v: CanonicalValue): v is Extract<CanonicalValue, { kind: 'literal' }> =>
  v.kind === 'literal';
export const isAlias = (v: CanonicalValue): v is Extract<CanonicalValue, { kind: 'alias' }> =>
  v.kind === 'alias';
export const isMissing = (v: CanonicalValue): v is Extract<CanonicalValue, { kind: 'missing' }> =>
  v.kind === 'missing';

/**
 * The typed value a consumer would use, or null.
 *
 * Null for BOTH a missing value and an unresolved alias, deliberately: to a
 * generator they are the same fact -- there is no value here -- and the reason
 * they differ is carried by the record and the diagnostics, where it belongs. A
 * helper that papered over that with a default would defeat the model.
 */
export function resolvedValueOf(v: CanonicalValue): TypedValue | null {
  if (v.kind === 'literal') return v.value;
  if (v.kind === 'alias') return v.resolved.status === 'resolved' ? v.resolved.value : null;
  return null;
}
