import { describe, it, expect } from 'vitest';
import { slugify, componentSlugs } from '../src/componentSlugs';

describe('slugify', () => {
  it('lowercases and joins on single dashes', () => {
    expect(slugify('Button Primary')).toBe('button-primary');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('  Card / Header  ')).toBe('card-header');
  });

  it('falls back to "component" when nothing survives', () => {
    expect(slugify('///')).toBe('component');
  });
});

describe('componentSlugs', () => {
  it('numbers collisions from the second occurrence', () => {
    expect(componentSlugs(['Button', 'button', 'BUTTON']))
      .toEqual(['button', 'button-2', 'button-3']);
  });

  it('does not let a numbered slug collide with a real one', () => {
    expect(componentSlugs(['Button', 'Button', 'Button 2']))
      .toEqual(['button', 'button-2', 'button-2-2']);
  });

  it('names a component the same way whatever else is in the list', () => {
    expect(componentSlugs(['Alpha', 'Beta'])[0]).toBe(componentSlugs(['Alpha'])[0]);
  });
});
