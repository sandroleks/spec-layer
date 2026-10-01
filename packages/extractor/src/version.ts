/**
 * The single compatibility version for deterministic extraction.
 *
 * Bump it only when component or Foundation extraction/export can produce
 * different output for unchanged serialized source (new fields, changed
 * classification, fixed extraction bugs). Output-identical refactors and
 * renderer-only or plugin-only changes do not bump it: a doc whose stored
 * version differs is reported as rebuild-required, so a spurious bump asks
 * every user to regenerate every document.
 *
 * An opaque identifier compared for equality, never ordered, so it need not
 * look like semver.
 */
export const EXTRACTOR_VERSION = '3';
