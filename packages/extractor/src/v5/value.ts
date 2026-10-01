/**
 * The canonical value model (spec §9): one discriminated shape for every value
 * in the artifact, branched on `kind`, which is always present.
 *
 * A value that is not known is represented as not known, never as a plausible
 * default: a substituted black is indistinguishable from a measured one
 * downstream.
 */

export type TokenType =
  | 'color' | 'dimension' | 'number' | 'string' | 'boolean'
  | 'duration' | 'cubic_bezier' | 'font_family';

/** §9.5. No `unitless`: a unitless quantity is `type: number`, not a dimension
 *  with a null unit. */
export type Unit = 'px' | 'rem' | 'em' | '%' | 'deg' | 'ms' | 's';

/** Runtime mirrors of the two unions above, asserted equal to the published
 *  JSON Schema in the schema test so the two cannot drift unnoticed. */
export const SUPPORTED_UNITS: readonly Unit[] =
  ['px', 'rem', 'em', '%', 'deg', 'ms', 's'] as const;
export const SUPPORTED_TOKEN_TYPES: readonly TokenType[] =
  ['color', 'dimension', 'number', 'string', 'boolean',
   'duration', 'cubic_bezier', 'font_family'] as const;
export const SUPPORTED_VALUE_KINDS = ['literal', 'alias', 'missing'] as const;
/** Duration's units, a subset of `Unit` spelled out in `DurationValue` and the
 *  schema's `$defs.duration_value`; mirrored for the same parity check. */
export const SUPPORTED_DURATION_UNITS: readonly ('ms' | 's')[] = ['ms', 's'] as const;

/** Runtime mirrors of `UnresolvedReason` and `MissingReason` for the schema
 *  parity test. `satisfies`, not a `readonly X[]` annotation, keeps each literal
 *  tuple type so the `Exclude<...>` checks below see which members are present. */
export const SUPPORTED_UNRESOLVED_REASONS = [
  'source_library_unavailable', 'target_not_found', 'cycle', 'type_mismatch',
  'depth_exceeded', 'ambiguous_target', 'target_mode_unresolvable',
  'target_mode_value_missing',
] as const satisfies readonly UnresolvedReason[];
export const SUPPORTED_MISSING_REASONS = [
  'no_value_for_mode', 'unsupported_value_type', 'invalid_source_value', 'source_unavailable',
] as const satisfies readonly MissingReason[];

/**
 * Compile-time exhaustiveness: `satisfies` only proves a subset, so a union
 * member missing from its array makes `Exclude<Union, ArrayMember>` non-never
 * and the literal `true` a type error naming that member.
 */
type _UnresolvedReasonsExhaustive =
  Exclude<UnresolvedReason, (typeof SUPPORTED_UNRESOLVED_REASONS)[number]> extends never
    ? true
    : ['UnresolvedReason member(s) missing from SUPPORTED_UNRESOLVED_REASONS:',
       Exclude<UnresolvedReason, (typeof SUPPORTED_UNRESOLVED_REASONS)[number]>];
const _unresolvedReasonsExhaustive: _UnresolvedReasonsExhaustive = true;

type _MissingReasonsExhaustive =
  Exclude<MissingReason, (typeof SUPPORTED_MISSING_REASONS)[number]> extends never
    ? true
    : ['MissingReason member(s) missing from SUPPORTED_MISSING_REASONS:',
       Exclude<MissingReason, (typeof SUPPORTED_MISSING_REASONS)[number]>];
const _missingReasonsExhaustive: _MissingReasonsExhaustive = true;

export interface ColorValue {
  type: 'color';
  color_space: 'srgb';
  /** Lowercase, six digits, leading `#`. §9.6. */
  hex: string;
  /** 0..1, present even when opaque, so "opaque" and "alpha not stated" are
   *  never the same output. §9.6. */
  alpha: number;
  /** Source channels 0..1, only when the 8-bit hex loses precision Figma had;
   *  on every colour they would triple a ramp's size. */
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
 * One hop of a resolution: the token and the mode it was read under. A Figma
 * `VARIABLE_ALIAS` carries no mode, so the mode is the extractor's decision
 * (consuming context, else the target collection's default); stating it spares
 * every consumer re-deriving it from mode names (§10). Not mirrored as a
 * `target_mode_id` on AliasReference: the reference is what the source states,
 * the chain is what resolution did.
 */
export interface ResolutionStep { token_id: string; mode_id: string }

/** §9.2: authoritative for lineage. `resolved` is a portability snapshot, so a
 *  retarget that keeps the resolved value still shows in a semantic diff (§10). */
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
   * The target was found but the hop's mode cannot be identified: the target
   * collection has no usable `default_mode_id` (§7). A `ResolutionStep` needs a
   * mode id, and a fabricated mode or a resolved empty chain would both assert
   * what the source does not, so it is unresolved; the value stays recoverable
   * from the target token.
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

export const isAlias = (v: CanonicalValue): v is Extract<CanonicalValue, { kind: 'alias' }> =>
  v.kind === 'alias';

/**
 * The typed value a consumer would use, or null for both a missing value and an
 * unresolved alias: to a generator both mean "no value", and why is carried by
 * the record and the diagnostics.
 */
export function resolvedValueOf(v: CanonicalValue): TypedValue | null {
  if (v.kind === 'literal') return v.value;
  if (v.kind === 'alias') return v.resolved.status === 'resolved' ? v.resolved.value : null;
  return null;
}
