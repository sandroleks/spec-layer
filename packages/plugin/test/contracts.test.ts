import { describe, it, expect } from 'vitest';
import { assertNever, navigation } from '../src/ui/viewModel/contracts';

describe('assertNever', () => {
  it('names the unhandled value and its context', () => {
    expect(() => assertNever('surprise' as never, 'LibraryStatus'))
      .toThrow('Unhandled LibraryStatus: surprise');
  });
});

describe('navigation', () => {
  it('lists the five workflows in rail order', () => {
    expect(navigation.map((item) => item.id)).toEqual([
      'component', 'foundations', 'library', 'settings', 'license',
    ]);
  });

  it('groups them so the rail can draw its two separators', () => {
    expect(navigation.map((item) => item.group)).toEqual([
      'create', 'create', 'library', 'settings', 'settings',
    ]);
  });

  it('gives every item an accessible label', () => {
    for (const item of navigation) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});
