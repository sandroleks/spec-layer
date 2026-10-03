import { sha256 } from 'js-sha256';
import type { IntermediateSpec, VariantInstance } from './extract';
import type { ComponentProp, VariantAxis } from './props';
import { tokensFor, type GapIssue } from './tokens';
import {
  unitContent, type FoundationSpec, type FoundationScope, type FoundationUnitContent,
} from './foundation';
import { anatomyFor } from './anatomy';
import { canonicalJson } from './v5/canonical';
import type { SerializedTrigger, SerializedTransitionEffect } from './tree';

/** SHA-256 over canonical JSON (keys sorted by code unit at every depth). */
export const contentHash = (value: unknown): string => sha256(canonicalJson(value));

/**
 * "Would hash the same": key order and undefined-valued keys are ignored, as
 * contentHash ignores them. The Library diff uses this, so "changed" means
 * "moved the hash".
 */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export interface SpecHashOptions {
  /** Mirrors the doc's `includeHidden` config. Off or absent hashes what every
   *  existing baseline was computed over; on, the revealed depth-0 parts enter
   *  because the canvas then draws them (rendered implies hashed). */
  includeHidden?: boolean;
}

/**
 * The object specContentHash hashes, stored by the Library as the drift
 * baseline: the diff input IS the hash input, so a change list cannot disagree
 * with the badge. The legacy `token` key and the depth-0 anatomy reduction are
 * contract: every committed baseline was hashed over this shape.
 */
export interface SpecHashProjection {
  name: string;
  figmaKey: string;
  figmaFile: string;
  figmaNode: string;
  description: string;
  anatomyComponentId: string;
  anatomy: { id: string; name: string; type: string; nested: boolean }[];
  props: ComponentProp[];
  variants: VariantAxis[];
  variantInstances: VariantInstance[];
  states: string[];
  tokens: { part: string; property: string; conditions: Record<string, string[]>; token: string }[];
  related: string[];
  gaps: { part: string; property: string; issue: GapIssue; value?: number | string }[];
  layout: { part: string; summary: string }[];
  /** Present only when the spec has transitions, so existing baselines match. */
  transitions?: {
    from: Record<string, string>; to: Record<string, string>; trigger: SerializedTrigger;
    triggerPart: string; transition: SerializedTransitionEffect;
  }[];
}

/**
 * The drift baseline projection. `description` enters because the Overview
 * and header subtitle render it; its arrival is part of the EXTRACTOR_VERSION
 * '3' rebuild, so a doc stamped '2' reads rebuild-required.
 */
export function specHashProjection(spec: IntermediateSpec, options: SpecHashOptions = {}): SpecHashProjection {
  const {
    // Excluded: rawValues and nodeEffects alter no rendered output, and
    // figmaFileName and documentationLinks are drawn nowhere (they feed the
    // YAML brief and v5). Hashed implies rendered, so none may read as drift.
    rawValues: _rawValues,
    nodeEffects: _nodeEffects,
    figmaFileName: _figmaFileName,
    documentationLinks: _documentationLinks,
    // Excluded: transitionIssues are reported by validate(); no canvas draws them.
    transitionIssues: _transitionIssues,
    name, figmaKey, figmaFile, figmaNode, description, anatomyComponentId,
    props, variants, variantInstances, states, related,
    // Hashed through the reductions below.
    anatomy, tokens, gaps, layout, transitions,
    ...unrouted
  } = spec;
  // A field added to IntermediateSpec lands in `unrouted` and fails to compile
  // until it is routed: excluded with a reason, or hashed, never by accident.
  const _everyFieldRouted: Record<string, never> = unrouted;
  void _everyFieldRouted;
  return {
    name, figmaKey, figmaFile, figmaNode, description, anatomyComponentId,
    props, variants, variantInstances, states, related,
    anatomy: anatomyFor(anatomy, { includeHidden: options.includeHidden === true })
      .filter((p) => p.depth === 0)
      .map(({ id, name, type, nested }) => ({ id, name, type, nested })),
    // `path` and the identity fields (`id`, `kind`, `remote`, `collectionId`)
    // re-identify data already hashed under `part`, so they stay out or every
    // committed doc drifts. The OLD key `token` carries the NEW field `name`
    // for the same reason. Filtered by the doc's flag as anatomy is, so the
    // rendered table and the baseline share one list; `shownBy` stays out
    // because a rule's presence already carries it.
    tokens: tokensFor(tokens, { includeHidden: options.includeHidden === true })
      .map(({ part, property, conditions, name: token }) => ({ part, property, conditions, token })),
    // `path` stays out as in `tokens`; `property` and `value` are real content.
    // No canvas renders a gap, but gaps move with rawValues (same hardcoded-
    // value detection), which IS rendered yet excluded above. Gaps are what
    // makes a hardcoded-value change register as drift: do not remove them
    // without covering that case some other way.
    gaps: gaps.map(({ part, property, issue, value }) =>
      ({ part, property, issue, ...(value !== undefined ? { value } : {}) })),
    // `values` repeats the numbers in `summary`'s sentence and `path` the node
    // `part` names, so both stay out. Naming the kept fields excludes any
    // field added to LayoutSummary by default.
    layout: layout.map(({ part, summary }) => ({ part, summary })),
    // Ids and the path re-identify what from, to and triggerPart already
    // carry (as `tokens` drops them). Key only when non-empty: an absent key
    // is what keeps every existing document's hash byte-identical.
    ...((transitions ?? []).length > 0
      ? { transitions: (transitions ?? []).map(({ from, to, trigger, triggerPart, transition }) =>
          ({ from, to, trigger, triggerPart, transition })) }
      : {}),
  };
}

/** A component doc's drift baseline hash, over specHashProjection. */
export function specContentHash(spec: IntermediateSpec, options: SpecHashOptions = {}): string {
  return contentHash(specHashProjection(spec, options));
}

/**
 * The drift baseline for one foundation output unit. Hashes the WHOLE
 * unitContent() result, not a field list: every FoundationUnitContent field is
 * rendered, and nothing may sit there unless a frame draws it. Add fields to
 * FoundationUnitContent, not here. A scope whose source is gone hashes a
 * stable sentinel, so a stale link stays comparable.
 */
export function foundationContentHash(spec: FoundationSpec, scope: FoundationScope): string {
  return foundationUnitContentHash(unitContent(spec, scope));
}

/**
 * foundationContentHash for a caller that already holds the unit's content
 * (null for a scope that no longer resolves), so it is not derived twice.
 */
export function foundationUnitContentHash(content: FoundationUnitContent | null): string {
  return content ? contentHash(content) : contentHash({ foundationUnit: null });
}
