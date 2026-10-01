/**
 * The diagnostics vocabulary (spec §14). Anchored to stable entity ids, never
 * display names, so a diagnostic survives a rename. Everything is COMPUTED, and
 * nothing sits below `info`. The additions after the spec table (§14.1 "At
 * minimum") exist so no code is overloaded: a code that means two things means
 * neither.
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
  /** Identity derived from a name (no stable id); a rename reads as delete plus add. */
  | 'SYNTHETIC_IDENTITY'
  /** More than one entity could satisfy an alias; never resolved by first match. */
  | 'AMBIGUOUS_ALIAS_TARGET'
  /** The number is retained but its unit is unknown; `units` overrides in the
   *  CLI are the remedy. */
  | 'UNIT_METADATA_UNAVAILABLE'
  /** Part of the source could not be read; why `completeness` is hashed. */
  | 'SOURCE_PARTIALLY_UNAVAILABLE'
  /** A metadata field the source API does not expose; no value depends on it. */
  | 'METADATA_UNAVAILABLE'
  /** Scoped to one collection or to text styles; completeness records it. */
  | 'EXPORT_SCOPED'
  /** A stated colour that cannot be canonicalized without inventing channels. */
  | 'INVALID_SOURCE_COLOR'
  /**
   * A NON-ALIAS reference naming no entity here: a `collection_id`,
   * `default_mode_id`, `lifecycle.replacement_id`, binding `token_id`, or the
   * mode a cross-collection alias hop resolves through. Not `UNRESOLVED_ALIAS`,
   * which §14.1 reserves for alias targets; covers the four non-alias classes of
   * §18 Level 2.
   */
  | 'UNRESOLVED_REFERENCE';

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
  // As UNRESOLVED_ALIAS: §18 Level 2 does not distinguish reference classes.
  UNRESOLVED_REFERENCE: 'error',
  SOURCE_PARTIALLY_UNAVAILABLE: 'error',
  STYLE_BINDING_DRIFT: 'warning',
  CONFUSABLE_NAME: 'warning',
  INFERRED_LIFECYCLE: 'warning',
  DEPRECATED_REFERENCE: 'warning',
  GENERATED_NAME_COLLISION: 'warning',
  // Usable for generation; only future diffs suffer.
  SYNTHETIC_IDENTITY: 'warning',
  // The number is usable; Level 4 readiness is the consumer's judgment.
  UNIT_METADATA_UNAVAILABLE: 'warning',
  MODE_VALUES_IDENTICAL: 'info',
  MISSING_DESCRIPTION: 'info',
  // Nothing for a consumer to decide, and nothing this export could capture.
  METADATA_UNAVAILABLE: 'info',
  // A fact about the request, not a defect.
  EXPORT_SCOPED: 'info',
};

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  /** Stable id of the entity this is about. Never a display name. */
  entity_id: string;
  mode_id?: string;
  message: string;
  /** Structured, so a consumer never parses the message. */
  details?: Record<string, unknown>;
}

/**
 * Code-unit ordering, used by every v5 sort. `localeCompare` is locale-
 * dependent (['_','a','ä','B'] versus ['B','_','a','ä']) and cannot underwrite
 * §16's byte stability.
 */
export const compareCodeUnits = (a: string, b: string): number =>
  (a < b ? -1 : a > b ? 1 : 0);

/** Severity comes from the table, never from the call site. */
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

/** Worst-first, then a total order so two runs cannot differ. Never discovery
 *  order, which follows Figma's internal ordering (§16). */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || compareCodeUnits(a.code, b.code)
    || compareCodeUnits(a.entity_id, b.entity_id)
    || compareCodeUnits(a.mode_id ?? '', b.mode_id ?? '')
    // Tie-breakers that make the order TOTAL: two findings can differ only in
    // what they say, and a stable sort would keep Figma's iteration order.
    || compareCodeUnits(a.message, b.message)
    || compareCodeUnits(JSON.stringify(a.details ?? null), JSON.stringify(b.details ?? null)));
}
