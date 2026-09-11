import { describe, expect, it } from 'vitest';
import { fontRequirements } from '../../src/v5/fonts';
import { OK_ARTIFACT } from './fixtures';
import type { FoundationArtifactV5 } from '../../src/v5/canonical';
import type { TypographyStyleV5 } from '../../src/v5/entities';
import type { TypedValue } from '../../src/v5/value';

/**
 * Builds a minimal valid Foundation artifact whose only typography styles are
 * the ones given, each a literal (unbound) font_family/font_weight pair. This
 * mirrors the pattern `artifactWithTypographyAlias` in `fixtures.ts` uses:
 * clone the one valid fixture artifact and push real `TypographyStyleV5`
 * entries onto its `styles.typography` array, rather than inventing a second
 * artifact shape.
 */
function foundationWithStyles(
  styles: Array<{ name: string; family: string; weight: number }>,
): FoundationArtifactV5 {
  const artifact = structuredClone(OK_ARTIFACT);
  const literalProperty = (resolved: TypedValue) => ({
    source: { kind: 'literal' as const }, resolved,
  });
  artifact.styles.typography = styles.map((style, i): TypographyStyleV5 => ({
    id: `TypographyStyleId:${i}`,
    name: style.name,
    path: style.name.split('/'),
    description: '',
    properties: {
      font_family: literalProperty({ type: 'font_family', value: style.family }),
      font_weight: literalProperty({ type: 'number', value: style.weight }),
      font_size: literalProperty({ type: 'dimension', number: 16, unit: 'px' }),
      line_height: literalProperty({ type: 'dimension', number: 24, unit: 'px' }),
      letter_spacing: literalProperty({ type: 'dimension', number: 0, unit: '%' }),
      paragraph_spacing: literalProperty({ type: 'dimension', number: 0, unit: 'px' }),
      paragraph_indent: literalProperty({ type: 'dimension', number: 0, unit: 'px' }),
      text_case: 'original',
      text_decoration: 'none',
    },
  }));
  return artifact;
}

describe('fontRequirements', () => {
  it('lists each family with the weights its styles reference', () => {
    const artifact = foundationWithStyles([
      { name: 'Button/L : 14px SemiBold', family: 'Open Sans', weight: 600 },
      { name: 'Paragraph/M : 16px Regular', family: 'Open Sans', weight: 400 },
      { name: 'Link/S : 12px Medium', family: 'Open Sans', weight: 500 },
    ]);

    expect(fontRequirements(artifact)).toEqual([{
      family: 'Open Sans',
      weights: [400, 500, 600],
      used_by: ['Button/L : 14px SemiBold', 'Link/S : 12px Medium', 'Paragraph/M : 16px Regular'],
    }]);
  });

  it('returns an empty array when the artifact has no typography styles', () => {
    expect(fontRequirements(foundationWithStyles([]))).toEqual([]);
  });

  it('keeps one entry per family, weights deduped and sorted numerically ascending', () => {
    const artifact = foundationWithStyles([
      { name: 'Heading/XL', family: 'Open Sans', weight: 700 },
      { name: 'Heading/L', family: 'Open Sans', weight: 400 },
      { name: 'Heading/M', family: 'Open Sans', weight: 400 },
      { name: 'Mono/Code', family: 'Roboto Mono', weight: 400 },
    ]);

    expect(fontRequirements(artifact)).toEqual([
      {
        family: 'Open Sans',
        weights: [400, 700],
        used_by: ['Heading/L', 'Heading/M', 'Heading/XL'],
      },
      {
        family: 'Roboto Mono',
        weights: [400],
        used_by: ['Mono/Code'],
      },
    ]);
  });

  it('omits a family no style references, and never fabricates a weight for one with none', () => {
    const artifact = structuredClone(OK_ARTIFACT);
    const literalProperty = (resolved: TypedValue) => ({
      source: { kind: 'literal' as const }, resolved,
    });
    const style: TypographyStyleV5 = {
      id: 'TypographyStyleId:0',
      name: 'Body/Unresolved',
      path: ['Body', 'Unresolved'],
      description: '',
      properties: {
        font_family: literalProperty({ type: 'font_family', value: 'Open Sans' }),
        // No unambiguous numeric weight for this style's Figma font-style label.
        font_weight: { source: { kind: 'literal' }, resolved: null },
        font_size: literalProperty({ type: 'dimension', number: 16, unit: 'px' }),
        line_height: literalProperty({ type: 'dimension', number: 24, unit: 'px' }),
        letter_spacing: literalProperty({ type: 'dimension', number: 0, unit: '%' }),
        paragraph_spacing: literalProperty({ type: 'dimension', number: 0, unit: 'px' }),
        paragraph_indent: literalProperty({ type: 'dimension', number: 0, unit: 'px' }),
        text_case: 'original',
        text_decoration: 'none',
      },
    };
    artifact.styles.typography = [style];

    expect(fontRequirements(artifact)).toEqual([{
      family: 'Open Sans',
      weights: [],
      used_by: ['Body/Unresolved'],
    }]);
  });
});
