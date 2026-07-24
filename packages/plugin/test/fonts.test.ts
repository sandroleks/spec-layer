import { describe, it, expect } from 'vitest';
import { familiesWithRequiredStyles, filterFamilies } from '../src/fonts';

const entry = (family: string, style: string) => ({ fontName: { family, style } });

describe('familiesWithRequiredStyles', () => {
  it('keeps families that have Regular, Medium, and Bold', () => {
    const fonts = [
      entry('Inter', 'Regular'), entry('Inter', 'Medium'), entry('Inter', 'Bold'),
      entry('Inter', 'Italic'),
    ];
    expect(familiesWithRequiredStyles(fonts)).toEqual(['Inter']);
  });

  it('drops families missing any required style', () => {
    const fonts = [
      entry('NoBold', 'Regular'), entry('NoBold', 'Medium'),
      entry('NoMedium', 'Regular'), entry('NoMedium', 'Bold'),
      entry('OnlySemi', 'Regular'), entry('OnlySemi', 'SemiBold'), entry('OnlySemi', 'Bold'),
    ];
    expect(familiesWithRequiredStyles(fonts)).toEqual([]);
  });

  it('sorts the result and deduplicates entries', () => {
    const fonts = [
      entry('Zilla', 'Regular'), entry('Zilla', 'Medium'), entry('Zilla', 'Bold'),
      entry('Abel Pro', 'Regular'), entry('Abel Pro', 'Regular'),
      entry('Abel Pro', 'Medium'), entry('Abel Pro', 'Bold'),
    ];
    expect(familiesWithRequiredStyles(fonts)).toEqual(['Abel Pro', 'Zilla']);
  });
});

describe('filterFamilies', () => {
  const families = ['DM Sans', 'Inter', 'Lora', 'Space Grotesk'];

  it('returns everything for an empty or whitespace query', () => {
    expect(filterFamilies(families, '')).toEqual(families);
    expect(filterFamilies(families, '   ')).toEqual(families);
  });

  it('matches case-insensitive substrings', () => {
    expect(filterFamilies(families, 'gro')).toEqual(['Space Grotesk']);
    expect(filterFamilies(families, 'S')).toEqual(['DM Sans', 'Space Grotesk']);
  });

  it('returns empty for no match', () => {
    expect(filterFamilies(families, 'zzz')).toEqual([]);
  });
});
