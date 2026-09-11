/**
 * The fonts a library's typography styles require.
 *
 * A family name alone is not enough to render a design system: a page that
 * loads a family at 400 and asks for 600 gets a synthesised bold that matches
 * nothing in the file. Every value here is read from the artifact's
 * typography styles; nothing is inferred, and a family no style references
 * does not appear.
 *
 * `TypographyStyleV5` (`v5/entities.ts`) carries no italic signal: Figma's
 * text style exposes a human font-style label ("SemiBold", "Regular
 * Italic", ...), but the direct v5 exporter (`fromFoundation.ts`) reduces
 * that label to a numeric `font_weight` and drops the label itself — no
 * `font_style` or comparable field survives into the artifact. A style's
 * `text_case` and `text_decoration` are the only other style-level strings,
 * and neither encodes slant. So `FontRequirement` carries no `styles` field:
 * a "normal" or "italic" value here would be invented, not read.
 */
import { compareCodeUnits } from './diagnostics';
import type { FoundationArtifactV5 } from './canonical';

export interface FontRequirement {
  family: string;
  weights: number[];
  used_by: string[];
}

export function fontRequirements(artifact: FoundationArtifactV5): FontRequirement[] {
  const byFamily = new Map<string, { weights: Set<number>; used: Set<string> }>();
  for (const style of artifact.styles.typography) {
    const family = style.properties.font_family.resolved;
    if (family === null || family.type !== 'font_family') continue;
    const bucket = byFamily.get(family.value)
      ?? { weights: new Set<number>(), used: new Set<string>() };
    const weight = style.properties.font_weight.resolved;
    if (weight !== null && weight.type === 'number') bucket.weights.add(weight.value);
    bucket.used.add(style.name);
    byFamily.set(family.value, bucket);
  }
  return [...byFamily.entries()]
    .sort((a, b) => compareCodeUnits(a[0], b[0]))
    .map(([family, bucket]) => ({
      family,
      weights: [...bucket.weights].sort((a, b) => a - b),
      used_by: [...bucket.used].sort(compareCodeUnits),
    }));
}
