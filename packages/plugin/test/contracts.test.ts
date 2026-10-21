import { describe, it, expect } from 'vitest';
import { assertNever, isPluginView, navigation } from '../src/ui/viewModel/contracts';

describe('assertNever', () => {
  it('names the unhandled value and its context', () => {
    expect(() => assertNever('surprise' as never, 'LicenseState'))
      .toThrow('Unhandled LicenseState: surprise');
  });
});

describe('navigation', () => {
  it('lists the six workflows in rail order', () => {
    expect(navigation.map((item) => item.id)).toEqual([
      'component', 'foundations', 'library', 'writing', 'settings', 'license',
    ]);
  });

  it('groups them so the rail can draw its two separators', () => {
    expect(navigation.map((item) => item.group)).toEqual([
      'create', 'create', 'library', 'library', 'settings', 'settings',
    ]);
  });

  it('gives every item an accessible label', () => {
    for (const item of navigation) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});

describe('isPluginView', () => {
  it('accepts exactly the six rail destinations', () => {
    for (const id of ['component', 'foundations', 'library', 'writing', 'settings', 'license']) {
      expect(isPluginView(id)).toBe(true);
    }
    expect(isPluginView('publish')).toBe(false);
    expect(isPluginView('')).toBe(false);
  });
});
