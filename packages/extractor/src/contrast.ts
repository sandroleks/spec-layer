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

/**
 * The nearest painted ancestor of the anatomy part at `index`, or null if none
 * resolves to a colour.
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
): { colour: { hex: string; alpha: number }; part: string } | null {
  let target = anatomy[index].depth;
  for (let i = index - 1; i >= 0 && target > 0; i--) {
    const candidate = anatomy[i];
    if (candidate.depth >= target) continue; // still inside a deeper or sibling subtree
    // First smaller-depth entry found: this is the next ancestor up the chain.
    target = candidate.depth;
    const token = fillOf(candidate.name);
    const colour = token ? resolveTokenColor(foundation, token) : null;
    if (colour) return { colour, part: candidate.name };
    // Not painted (or unresolved) — keep climbing toward its own parent.
  }
  return null;
}

export function checkContrast(spec: IntermediateSpec, foundation: FoundationSpec): ContrastFinding[] {
  const findings: ContrastFinding[] = [];
  const seen = new Set<string>();

  const textParts = spec.anatomy.filter((p) => p.type === 'TEXT');

  for (const instance of spec.variantInstances) {
    if (isDisabled(instance.values)) continue;
    const resolved = resolveTokensForVariant(spec.tokens, instance.values);
    const fillOf = (part: string) => resolved.find((r) => r.part === part && r.property === 'fill')?.token;

    for (const textPart of textParts) {
      const fgToken = fillOf(textPart.name);
      if (!fgToken) continue;
      const fg = resolveTokenColor(foundation, fgToken);
      if (!fg) continue;

      const index = spec.anatomy.indexOf(textPart);
      const ancestor = nearestPaintedAncestor(spec.anatomy, index, fillOf, foundation);
      let bg = ancestor?.colour ?? null;
      let bgPart = ancestor?.part ?? '';

      // The default variant's own root is named "Container" and is not in the
      // anatomy list, so fall back to it when no painted ancestor was found
      // within anatomy itself.
      if (!bg) {
        const token = fillOf('Container');
        const colour = token ? resolveTokenColor(foundation, token) : null;
        if (colour) { bg = colour; bgPart = 'Container'; }
      }
      // No resolvable background at all: emit nothing rather than a finding
      // against a wrong (or invented) colour.
      if (!bg) continue;

      const background = blend(bg.hex, bg.alpha, '#ffffff');
      const foreground = blend(fg.hex, fg.alpha, background);
      const required = requiredRatio(textPart.text?.fontSize, textPart.text?.fontWeight);
      const ratio = Math.round(contrastRatio(foreground, background) * 100) / 100;
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
  return findings;
}
