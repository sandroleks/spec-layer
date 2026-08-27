/**
 * The diagnostics vocabulary — spec §14.
 *
 * Anchored to stable entity ids rather than display names, so a diagnostic
 * survives a rename and joins back to the token it is about. Same two rules as
 * the v4 `validate.ts`: everything is COMPUTED, and there is nothing below
 * `info` -- a finding nobody should act on should not be emitted.
 *
 * The five codes below the spec table are ADDITIONS, permitted by §14.1's "At
 * minimum". They exist because the alternative was overloading: an earlier
 * draft reported name-derived identity as INFERRED_LIFECYCLE (which is about
 * archive state) and absent unit metadata as UNSUPPORTED_VALUE_TYPE (which is
 * about a value that cannot be represented at all). A code that means two
 * things means neither, and a consumer that learns to ignore one instance of it
 * ignores the other.
 */

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  // -- §14.1, complete --
  | 'UNRESOLVED_ALIAS' | 'UNRESOLVED_EXTERNAL_ALIAS' | 'ALIAS_CYCLE'
  | 'ALIAS_TYPE_MISMATCH' | 'MISSING_MODE_VALUE' | 'DUPLICATE_SOURCE_ID'
  | 'PATH_COLLISION' | 'UNSUPPORTED_VALUE_TYPE' | 'INCONSISTENT_VALUE_SHAPE'
  | 'STYLE_BINDING_DRIFT' | 'CONFUSABLE_NAME' | 'INFERRED_LIFECYCLE'
  | 'DEPRECATED_REFERENCE' | 'MODE_VALUES_IDENTICAL' | 'MISSING_DESCRIPTION'
  | 'GENERATED_NAME_COLLISION'
  // -- additions, per §14.1 "At minimum" --
  /** Identity was derived from a name because the source exposed no stable id.
   *  A rename will read as a delete plus an add until re-extraction. */
  | 'SYNTHETIC_IDENTITY'
  /** An alias names a target that more than one entity could satisfy. Reported
   *  rather than resolved by picking the first match. */
  | 'AMBIGUOUS_ALIAS_TARGET'
  /** A valid number whose unit the source does not state. The NUMBER is fine;
   *  what is missing is the metadata that makes it a dimension. */
  | 'UNIT_METADATA_UNAVAILABLE'
  /** Part of the source could not be read. Not derivable from the surviving
   *  payload, which is why `completeness` is also hashed. */
  | 'SOURCE_PARTIALLY_UNAVAILABLE'
  /** A colour the source states that cannot be canonicalized without inventing
   *  channels. Emitted instead of clamping or padding it into a plausible one. */
  | 'INVALID_SOURCE_COLOR';

export const DEFAULT_SEVERITY: Record<DiagnosticCode, Severity> = {
  UNRESOLVED_ALIAS: 'error',
  UNRESOLVED_EXTERNAL_ALIAS: 'error',
  ALIAS_CYCLE: 'error',
  ALIAS_TYPE_MISMATCH: 'error',
  MISSING_MODE_VALUE: 'error',
  DUPLICATE_SOURCE_ID: 'error',
  PATH_COLLISION: 'error',
  UNSUPPORTED_VALUE_TYPE: 'error',
  INCONSISTENT_VALUE_SHAPE: 'error',
  AMBIGUOUS_ALIAS_TARGET: 'error',
  INVALID_SOURCE_COLOR: 'error',
  SOURCE_PARTIALLY_UNAVAILABLE: 'error',
  // Error, not warning: §18 Level 4 requires every dimension to carry a unit,
  // so an artifact holding units-unknown numbers is genuinely not
  // code-generation ready and must not pass as though it were. The remedy is
  // re-extraction with scopes, which the message says.
  UNIT_METADATA_UNAVAILABLE: 'error',
  STYLE_BINDING_DRIFT: 'warning',
  CONFUSABLE_NAME: 'warning',
  INFERRED_LIFECYCLE: 'warning',
  DEPRECATED_REFERENCE: 'warning',
  GENERATED_NAME_COLLISION: 'warning',
  // Warning, not error: a migrated artifact with synthetic ids is still usable
  // for generation -- what it cannot do is survive a rename, which is a fact
  // about future diffs rather than about this artifact's correctness.
  SYNTHETIC_IDENTITY: 'warning',
  MODE_VALUES_IDENTICAL: 'info',
  MISSING_DESCRIPTION: 'info',
};

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  /** Stable id of the entity this is about. Never a display name. */
  entity_id: string;
  mode_id?: string;
  message: string;
  /** Structured detail, kept as data rather than folded into the message, so a
   *  consumer can act on it without parsing prose. */
  details?: Record<string, unknown>;
}

/**
 * Code-unit ordering.
 *
 * `String.prototype.localeCompare` without an explicit locale is
 * implementation- and locale-dependent -- it orders ['_','a','ä','B'] where
 * code units give ['B','_','a','ä'] -- so it cannot underwrite §16's byte
 * stability. Every sort in the v5 tree uses this comparator.
 */
export const compareCodeUnits = (a: string, b: string): number =>
  (a < b ? -1 : a > b ? 1 : 0);

/** Severity comes from the table, never from the call site: a code that means
 *  different things in different places means nothing. */
export function diagnostic(
  code: DiagnosticCode,
  fields: {
    entity_id: string; message: string;
    mode_id?: string; details?: Record<string, unknown>;
  },
): Diagnostic {
  return {
    code,
    severity: DEFAULT_SEVERITY[code],
    entity_id: fields.entity_id,
    ...(fields.mode_id !== undefined ? { mode_id: fields.mode_id } : {}),
    message: fields.message,
    ...(fields.details !== undefined ? { details: fields.details } : {}),
  };
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

/** Worst-first for a human, then fully determined by code, entity and mode so
 *  two runs over one file cannot differ. Never discovery order, which follows
 *  Figma's internal ordering -- exactly what §16 exists to eliminate. */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || compareCodeUnits(a.code, b.code)
    || compareCodeUnits(a.entity_id, b.entity_id)
    || compareCodeUnits(a.mode_id ?? '', b.mode_id ?? ''));
}

export const hasErrors = (diagnostics: Diagnostic[]): boolean =>
  diagnostics.some((d) => d.severity === 'error');

/** §14.2 strict mode promotes a SELECTION, never everything: a blanket
 *  promotion would fail a build on MODE_VALUES_IDENTICAL, which describes a
 *  legitimate design choice. */
export function promoteToErrors(
  diagnostics: Diagnostic[],
  codes: DiagnosticCode[],
): Diagnostic[] {
  const promoted = new Set(codes);
  return diagnostics.map((d) =>
    promoted.has(d.code) ? { ...d, severity: 'error' as const } : d);
}
