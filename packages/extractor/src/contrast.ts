/**
 * WCAG 2.1 contrast maths. Pure and dependency-free so it runs identically in
 * the plugin sandbox and under vitest.
 */

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`;

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 contrast ratio. Symmetric; always >= 1. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Composite `fg` at `alpha` over an opaque `bg`. WCAG is defined on the colour
 * a user actually sees, and semi-transparent text is common in disabled and
 * muted styles, so ignoring alpha would report ratios nobody experiences.
 */
export function blend(fg: string, alpha: number, bg: string): string {
  if (alpha >= 1) return fg;
  if (alpha <= 0) return bg;
  const [fr, fg_, fb] = rgb(fg);
  const [br, bg_, bb] = rgb(bg);
  return toHex(
    fr * alpha + br * (1 - alpha),
    fg_ * alpha + bg_ * (1 - alpha),
    fb * alpha + bb * (1 - alpha),
  );
}

/**
 * The AA threshold for this text. "Large" is >= 24px, or >= 18.66px at weight
 * 700 or above (WCAG 2.1 SC 1.4.3). An unknown size is treated as normal text,
 * which is the stricter and therefore safer assumption.
 */
export function requiredRatio(fontSize: number | undefined, fontWeight: number | undefined): 3 | 4.5 {
  if (fontSize === undefined) return 4.5;
  if (fontSize >= 24) return 3;
  if (fontSize >= 18.66 && (fontWeight ?? 400) >= 700) return 3;
  return 4.5;
}

// ---------------------------------------------------------------------------
// Token resolution and finding emission.
//
// This half of the file has real dependencies (FoundationSpec, IntermediateSpec,
// resolveTokensForVariant), unlike the pure maths above, but they are imported
// type-only where possible so contrast.ts stays a thin consumer rather than
// growing its own graph.
// ---------------------------------------------------------------------------

import type { FoundationSpec, FoundationValue } from './foundation';
import type { IntermediateSpec } from './extract';
import type { SerializedNode } from './tree';
import type { VariantAxisModel } from './tokens';
import { cleanPartName, walkParts } from './naming';
import { resolveTokensForVariant } from './resolve';

export interface ContrastFinding {
  part: string;          // the TEXT part
  variant: string;       // the variant instance name it was measured in
  foreground: string;    // resolved hex, alpha already composited
  background: string;    // resolved hex of the nearest painted ancestor
  backgroundPart: string;
  ratio: number;         // rounded to 2dp
  required: 3 | 4.5;
}

/**
 * What a contrast run actually managed to do, not only what it found wrong.
 *
 * An empty `findings` list on its own is unreadable: it means "checked and
 * clean" and "could not check anything" at the same time, and those two lead a
 * design team to opposite conclusions. The overwhelmingly common cause of the
 * second is a text colour that is hardcoded rather than variable-bound, which
 * the same extraction already reports as a gap — so claiming a WCAG AA pass
 * there contradicts our own output. `evaluated` and `skipped` let the renderer
 * distinguish the two and make the claim falsifiable by naming a count.
 */
export interface ContrastReport {
  /** Distinct text/background colour pairs actually measured (passing or not). */
  evaluated: number;
  /** Anatomy text parts that no variant could be measured in. */
  skipped: number;
  findings: ContrastFinding[];
}

/**
 * A report from a run that never happened: no foundation, nothing measured.
 *
 * A factory rather than a shared constant, so no two specs can ever end up
 * pointing at one `findings` array.
 */
export const emptyContrastReport = (): ContrastReport => ({ evaluated: 0, skipped: 0, findings: [] });

/** The WCAG-relevant metrics of one TEXT node. */
export interface TextMetrics { fontSize?: number; fontWeight?: number }

/**
 * Per-variant text metrics: variant node id -> part name -> that variant's own
 * metrics for the part.
 *
 * Anatomy carries metrics too, but only ever the DEFAULT variant's: extractAnatomy
 * walks `defaultVariant(root).children` and nothing else. Picking the AA threshold
 * from those while measuring every variant is wrong in both directions on any
 * component with a size axis. A default of Size=L (24px, threshold 3:1) drops a
 * genuine failure in Size=S, and a default of Size=S (threshold 4.5:1) emits a
 * finding whose own `variant` field names a 24px variant that is compliant at 3:1.
 * The serialized `text` field is present on every TEXT node in every variant, so
 * the right fix is to carry all of them and pick per variant.
 */
export type VariantTextMetrics = Map<string, Map<string, TextMetrics>>;

/**
 * Collect each variant's own text metrics, keyed the same way token rules are.
 *
 * Uses walkParts with the same root naming extractTokens uses ('Container' for a
 * variant inside a set), because the lookup key here has to be the part name the
 * anatomy list and the token rules already agree on. Hidden subtrees are pruned
 * for the same reason token extraction prunes them: a hidden part is not on
 * screen, so it is not what this variant renders.
 */
export function collectTextMetrics(root: SerializedNode, model: VariantAxisModel): VariantTextMetrics {
  const isInSet = root.type === 'COMPONENT_SET';
  const out: VariantTextMetrics = new Map();
  for (const variant of model.variants) {
    const byPart = new Map<string, TextMetrics>();
    walkParts(variant, isInSet ? 'Container' : cleanPartName(variant.name), (n, part) => {
      if (n.type === 'TEXT' && n.text) byPart.set(part, n.text);
    }, true);
    out.set(variant.id, byPart);
  }
  return out;
}

/** Follow an alias chain to the concrete colour it stands for. */
function concrete(v: FoundationValue): { hex: string; alpha: number } | null {
  if (v.kind === 'color') return { hex: v.hex, alpha: v.alpha };
  if (v.kind === 'alias' && v.resolved) return concrete(v.resolved);
  return null;
}

/**
 * Look a token name up in the foundation and return its colour in the owning
 * collection's DEFAULT mode. Per-mode checking (light against dark) is a
 * deliberate follow-up: text and background can live in different collections
 * with different mode sets, so pairing modes correctly needs its own design.
 */
export function resolveTokenColor(
  foundation: FoundationSpec,
  token: string,
): { hex: string; alpha: number } | null {
  for (const collection of foundation.collections) {
    for (const variable of collection.variables) {
      if (variable.name !== token) continue;
      const value = variable.valuesByMode[collection.defaultModeId];
      return value ? concrete(value) : null;
    }
  }
  return null;
}

/** WCAG exempts inactive controls, and every design system deliberately mutes
 *  disabled text, so checking those produces noise rather than findings. */
function isDisabled(values: Record<string, string>): boolean {
  return Object.values(values).some((v) => v.trim().toLowerCase() === 'disabled')
    || Object.entries(values).some(([k, v]) =>
      k.trim().toLowerCase() === 'disabled' && v.trim().toLowerCase() === 'true');
}

/** The outcome of looking for the painted surface behind a text part. */
type AncestorFill =
  | { kind: 'found'; colour: { hex: string; alpha: number }; part: string }
  /** An ancestor's name is not unique in the anatomy, so its fill is unknowable. */
  | { kind: 'ambiguous' }
  | { kind: 'none' };

/**
 * The nearest painted ancestor of the anatomy part at `index`, or `none` if
 * nothing above it resolves to a colour.
 *
 * Anatomy (see anatomy.ts) is a bounded, pre-order depth-first walk: a node is
 * pushed, then its children, then the next sibling. That ordering does NOT mean
 * "the closest earlier entry with a strictly smaller depth is an ancestor" —
 * it only guarantees that for the FIRST such entry. Once you walk past the true
 * parent (say, because it carries no fill), continuing to accept any earlier
 * entry with depth < textPart.depth can land on an uncle: an earlier sibling of
 * the parent (or of a higher ancestor), whose subtree sits beside the text
 * part in the tree, not behind it. That earlier sibling can easily be painted
 * while the actual parent is transparent, which would report a real colour
 * that nobody sees behind this text.
 *
 * The fix is to climb the ancestor chain one level at a time rather than
 * scanning for "any smaller depth". Because addParts increments depth by
 * exactly 1 per nesting level and never skips a level (instance boundaries
 * stop the walk entirely, so they cannot introduce a gap), the ancestor chain
 * of a part at depth d is a contiguous run of depths d-1, d-2, ..., 0, and
 * everything between one ancestor and the point where we're searching for it
 * has depth >= that ancestor's depth. So the FIRST entry encountered scanning
 * backward whose depth is less than the current target is always the next
 * ancestor up — never a sibling of one. If that ancestor has no resolvable
 * fill, drop the target to its own depth and keep climbing.
 */
function nearestPaintedAncestor(
  anatomy: IntermediateSpec['anatomy'],
  index: number,
  fillOf: (part: string) => string | undefined,
  foundation: FoundationSpec,
  isAmbiguous: (part: string) => boolean,
): AncestorFill {
  let target = anatomy[index].depth;
  for (let i = index - 1; i >= 0 && target > 0; i--) {
    const candidate = anatomy[i];
    if (candidate.depth >= target) continue; // still inside a deeper or sibling subtree
    // First smaller-depth entry found: this is the next ancestor up the chain.
    target = candidate.depth;
    // Part names are unique only among SIBLINGS (see naming.ts), so a name that
    // repeats in another subtree makes `fillOf` a coin toss: it returns whichever
    // rule for that name sorts first, which may belong to the other subtree
    // entirely. That is unknowable rather than merely unpainted, and it stops the
    // climb: we cannot tell whether this ancestor is painted, so we also cannot
    // justify skipping past it to its parent.
    if (isAmbiguous(candidate.name)) return { kind: 'ambiguous' };
    const token = fillOf(candidate.name);
    const colour = token ? resolveTokenColor(foundation, token) : null;
    if (colour) return { kind: 'found', colour, part: candidate.name };
    // Not painted (or unresolved) — keep climbing toward its own parent.
  }
  return { kind: 'none' };
}

/**
 * Measure every text part against its background, in every non-disabled variant.
 *
 * `metrics` carries per-variant text metrics (see collectTextMetrics). It is
 * optional so the pure-unit tests can drive this with a hand-built spec; when it
 * is absent, or has no entry for this part in this variant, the threshold falls
 * back to the anatomy part's own (default-variant) metrics. Production always
 * passes it: extract() builds it from the same axis model it builds everything
 * else from.
 */
export function checkContrast(
  spec: IntermediateSpec,
  foundation: FoundationSpec,
  metrics?: VariantTextMetrics,
): ContrastReport {
  const findings: ContrastFinding[] = [];
  const seen = new Set<string>();
  // Counted per distinct colour pair, matching how findings are deduped, so
  // "checked N pairs, found M" always has M <= N and both mean the same thing.
  const evaluatedPairs = new Set<string>();
  // Tracked per part, not per part-and-variant: a part measured in one variant
  // and unmeasurable in another is not a gap the reader can act on, and a
  // per-variant tally would report ten skips for one unbound colour.
  const evaluatedParts = new Set<string>();
  const skippedParts = new Set<string>();

  // Part identity is sibling-scoped (naming.ts numbers duplicates within one
  // parent's children only), so the same cleaned name can appear in two
  // different subtrees — `header > label` and `footer > label` are two parts
  // with one name. Every lookup here is by that flat name, so those two are
  // indistinguishable and the first matching token wins, which can either hide
  // a real failure or blame the wrong part for another's colour. Path-qualified
  // identity is the real fix and a much larger change; until then, an ambiguous
  // name is skipped and counted, so the section reports a gap instead of a
  // confident wrong answer.
  const nameCounts = new Map<string, number>();
  for (const p of spec.anatomy) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  const isAmbiguous = (name: string) => (nameCounts.get(name) ?? 0) > 1;

  const textParts = spec.anatomy.filter((p) => p.type === 'TEXT');

  for (const instance of spec.variantInstances) {
    if (isDisabled(instance.values)) continue;
    const resolved = resolveTokensForVariant(spec.tokens, instance.values);
    const fillOf = (part: string) => resolved.find((r) => r.part === part && r.property === 'fill')?.token;
    const variantMetrics = metrics?.get(instance.nodeId);

    for (const textPart of textParts) {
      if (isAmbiguous(textPart.name)) { skippedParts.add(textPart.name); continue; }

      // No fill rule for this part, or a rule naming a token this file cannot
      // resolve: the colour is hardcoded, comes from a library collection this
      // dump does not carry, or is bound to something that is not a colour.
      // Either way it is unchecked, never checked-and-passing.
      const fgToken = fillOf(textPart.name);
      if (!fgToken) { skippedParts.add(textPart.name); continue; }
      const fg = resolveTokenColor(foundation, fgToken);
      if (!fg) { skippedParts.add(textPart.name); continue; }

      const index = spec.anatomy.indexOf(textPart);
      const ancestor = nearestPaintedAncestor(spec.anatomy, index, fillOf, foundation, isAmbiguous);
      if (ancestor.kind === 'ambiguous') { skippedParts.add(textPart.name); continue; }
      let bg = ancestor.kind === 'found' ? ancestor.colour : null;
      let bgPart = ancestor.kind === 'found' ? ancestor.part : '';

      // The default variant's own root is named "Container" and is not in the
      // anatomy list, so fall back to it when no painted ancestor was found
      // within anatomy itself.
      if (!bg) {
        const token = fillOf('Container');
        const colour = token ? resolveTokenColor(foundation, token) : null;
        if (colour) { bg = colour; bgPart = 'Container'; }
      }
      // No resolvable background at all: report nothing rather than a finding
      // against a wrong (or invented) colour.
      if (!bg) { skippedParts.add(textPart.name); continue; }

      // A translucent background is only meaningful over whatever sits behind
      // the component, and a component spec does not know that: it could be a
      // white page or a dark surface, and assuming white lightens the computed
      // background enough to push a real failure above threshold. Skip instead
      // of guessing, and let the section say so.
      if (bg.alpha < 1) { skippedParts.add(textPart.name); continue; }

      const background = bg.hex;
      const foreground = blend(fg.hex, fg.alpha, background);
      const variantText = variantMetrics?.get(textPart.name) ?? textPart.text;
      const required = requiredRatio(variantText?.fontSize, variantText?.fontWeight);
      const ratio = Math.round(contrastRatio(foreground, background) * 100) / 100;

      evaluatedParts.add(textPart.name);
      evaluatedPairs.add(`${textPart.name}\0${foreground}\0${background}`);
      if (ratio >= required) continue;

      // One finding per (part, colour pair): the same failure repeated across
      // ten variants is one problem, not ten.
      const key = `${textPart.name}\0${foreground}\0${background}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        part: textPart.name, variant: instance.name,
        foreground, background, backgroundPart: bgPart, ratio, required,
      });
    }
  }
  // A part measured in at least one variant is not a skip, whatever happened in
  // the others (a hidden part in one variant is the normal case here).
  for (const part of evaluatedParts) skippedParts.delete(part);
  // Counted over anatomy entries, not over names: a colliding name is TWO parts
  // a reader can see on the frame, and reporting it as one skip would understate
  // the gap exactly where the gap is caused by them being indistinguishable.
  const skipped = textParts.filter((p) => skippedParts.has(p.name)).length;
  return { evaluated: evaluatedPairs.size, skipped, findings };
}
