import { describe, it, expect } from 'vitest';
import { navigation } from '../src/ui/viewModel/contracts';
import { railBlocks, railIcon, sidebarMarkup } from '../src/ui/shell/sidebar';

describe('railBlocks', () => {
  it('splits the flat navigation into its three visual groups', () => {
    const blocks = railBlocks(navigation);
    expect(blocks.map((b) => b.group)).toEqual(['create', 'library', 'settings']);
    expect(blocks[0].items.map((i) => i.id)).toEqual(['component', 'foundations']);
    expect(blocks[1].items.map((i) => i.id)).toEqual(['library']);
    expect(blocks[2].items.map((i) => i.id)).toEqual(['settings', 'license']);
  });

  it('keeps every item, so nothing can be dropped by regrouping', () => {
    const kept = railBlocks(navigation).flatMap((b) => b.items);
    expect(kept).toHaveLength(navigation.length);
  });

  it('returns nothing for an empty list', () => {
    expect(railBlocks([])).toEqual([]);
  });
});

describe('railIcon', () => {
  it('gives Library a folder, not a database', () => {
    expect(railIcon('library')).toBe('folder');
  });

  it('maps every workflow to an icon', () => {
    for (const item of navigation) {
      expect(railIcon(item.id)).toBeTruthy();
    }
  });
});

describe('sidebarMarkup', () => {
  it('marks only the active item as current', () => {
    const html = sidebarMarkup('library', {});
    const current = html.match(/aria-current="page"/g) ?? [];
    expect(current).toHaveLength(1);
    expect(html).toContain('data-view="library" aria-current="page"');
  });

  it('gives every rail button an accessible name', () => {
    const html = sidebarMarkup('component', {});
    for (const item of navigation) {
      expect(html).toContain(`aria-label="${item.label}"`);
    }
  });

  it('renders a badge only when there is a count', () => {
    expect(sidebarMarkup('component', {})).not.toContain('sl-sidebar-badge');
    expect(sidebarMarkup('component', { library: 3 })).toContain('>3<');
  });

  it('separates the workflow groups and bottom utilities', () => {
    const html = sidebarMarkup('component', {});
    const separators = html.match(/sl-sidebar-separator/g) ?? [];
    expect(separators).toHaveLength(3);
  });

  it('keeps Help & feedback in the bottom utility group', () => {
    expect(sidebarMarkup('component', {})).toContain('aria-label="Help & feedback"');
  });

  it('puts the utility links at the bottom, below the spacer', () => {
    const html = sidebarMarkup('component', {});
    expect(html.indexOf('sl-sidebar-spacer')).toBeLessThan(html.indexOf('Spec Layer website'));
    expect(html).toContain('Spec Layer on LinkedIn');
  });
});
