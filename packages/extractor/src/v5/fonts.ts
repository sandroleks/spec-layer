/**
 * The fonts a library's typography styles require: each family with its used
 * weights, since a page that loads 400 and asks for 600 gets a synthesised
 * bold. Read from the typography styles only; nothing is inferred.
 *
 * No `styles` (normal/italic) field: `TypographyStyleV5` carries no slant
 * signal, because `fromFoundation.ts` reduces Figma's font-style label to a
 * numeric `font_weight` and drops the label, so a slant here would be invented.
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
