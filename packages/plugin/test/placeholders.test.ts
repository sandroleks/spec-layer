import { describe, it, expect } from 'vitest';
import { placeholderShapeFor, PLACEHOLDER_TAG, type PlaceholderShape } from '../src/ui/placeholders';
import { ALL_SECTIONS, AI_ONLY_SECTIONS, type SectionId } from '../src/ui/docModel';

/** Every user-visible string a shape carries. */
function strings(shape: PlaceholderShape): string[] {
  switch (shape.kind) {
    case 'paragraph': case 'bullets': return [shape.text];
    case 'twoColumns': return [shape.left.heading, shape.left.text, shape.right.heading, shape.right.text];
    case 'guidelinePair': return [shape.do.rule, shape.do.reason, shape.dont.rule, shape.dont.reason];
    case 'keyboardRow': return [shape.key, shape.action];
  }
}

describe('placeholderShapeFor', () => {
  it('has a shape for Overview and every AI-only section, and none for the rest', () => {
    const withShape = ALL_SECTIONS.map((s) => s.id).filter((id) => placeholderShapeFor(id) !== null);
    expect(withShape.sort()).toEqual(['definition', ...AI_ONLY_SECTIONS].sort());
  });

  it('writes each shape into the slots its filled section uses', () => {
    expect(placeholderShapeFor('definition')).toMatchObject({ kind: 'paragraph', slot: 'definition' });
    expect(placeholderShapeFor('pointer')).toMatchObject({ kind: 'bullets', slot: 'pointer' });
    expect(placeholderShapeFor('accessibility')).toMatchObject({ kind: 'bullets', slot: 'semantics' });
    expect(placeholderShapeFor('contentConsiderations')).toMatchObject({ kind: 'bullets', slot: 'content' });
    expect(placeholderShapeFor('whenToUse')).toMatchObject({
      kind: 'twoColumns', left: { slot: 'whenToUse' }, right: { slot: 'whenNotToUse' },
    });
    expect(placeholderShapeFor('dosDonts')?.kind).toBe('guidelinePair');
    expect(placeholderShapeFor('keyboard')?.kind).toBe('keyboardRow');
  });

  it('never uses an em dash, and every string is non-empty sentence case', () => {
    const all = [PLACEHOLDER_TAG, ...ALL_SECTIONS.flatMap((s) => {
      const shape = placeholderShapeFor(s.id as SectionId);
      return shape ? strings(shape) : [];
    })];
    for (const s of all) {
      expect(s).not.toContain('\u2014');
      expect(s.trim()).not.toBe('');
      expect(s[0]).toBe(s[0].toUpperCase());
    }
  });

  it('reads Placeholder on the tag', () => {
    expect(PLACEHOLDER_TAG).toBe('Placeholder');
  });
});
