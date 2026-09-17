/**
 * version.ts — the single compatibility version for deterministic extraction.
 *
 * Replaces the old `SPEC_VERSION` from `@spec-layer/format`, which had to mean
 * two things at once: the public Markdown contract AND "the extractor's output
 * changed, rebuild your docs". With Markdown retired there is only one contract
 * left, so there is only one version.
 *
 * Bump this when component extraction or Foundation extraction/export can
 * produce different output for unchanged serialized source data — new fields,
 * changed classification, fixed extraction bugs. Refactors proven
 * output-identical do NOT need a bump.
 *
 * Do NOT bump it for renderer-only or plugin-only changes. A doc whose stored
 * version differs from this one is reported as rebuild-required, so a spurious
 * bump asks every user to regenerate every document for nothing.
 *
 * The value is an opaque identifier compared for equality. It is never ordered
 * with string comparison, so it does not need to look like semver.
 */
// '3' (2026-09-17, Docs 2.0 Plan 1): description and documentationLinks
// enter the canvas hash, canonical key order is by code unit rather than
// locale, and the radius gap check honours every per-corner binding.
export const EXTRACTOR_VERSION = '3';
