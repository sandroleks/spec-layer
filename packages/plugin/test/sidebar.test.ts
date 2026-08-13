import { describe, it, expect } from 'vitest';
import { navigation } from '../src/ui/viewModel/contracts';
import { LINKEDIN_URL, SITE_URL } from '../src/ui/proxy';
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

  it('renders an attention dot, never a count', () => {
    // It used to print counts.updates, a number the UI only learns one doc at a
    // time: it climbed 1, 2, 3 as source checks landed and vanished at the start
    // of every reload. "Something needs attention" is the whole message.
    expect(sidebarMarkup('component', {})).not.toContain('sl-sidebar-badge');
    const badged = sidebarMarkup('component', { library: true });
    expect(badged).toContain('<span class="sl-sidebar-badge" aria-hidden="true"></span>');
    expect(badged).not.toMatch(/sl-sidebar-badge[^>]*>\s*\d/);
  });

  it('puts the badge state on the accessible name, since a dot has no text', () => {
    const badged = sidebarMarkup('component', { library: true });
    expect(badged).toContain('aria-label="Library, updates available"');
    // Only the badged view is renamed; the others keep their plain label.
    expect(badged).toContain('aria-label="Generate component docs"');
    expect(sidebarMarkup('component', {})).toContain('aria-label="Library"');
  });

  it('separates the workflow groups and bottom utilities', () => {
    const html = sidebarMarkup('component', {});
    const separators = html.match(/sl-sidebar-separator/g) ?? [];
    expect(separators).toHaveLength(3);
  });

  it('does not expose the deferred Help action as an inert control', () => {
    expect(sidebarMarkup('component', {})).not.toContain('Help & feedback');
  });

  it('puts the utility links at the bottom, below the spacer', () => {
    const html = sidebarMarkup('component', {});
    expect(html.indexOf('sl-sidebar-spacer')).toBeLessThan(html.indexOf('Spec Layer website'));
    expect(html).toContain('Spec Layer on LinkedIn');
    expect(html).toContain(`href="${SITE_URL}"`);
    expect(html).toContain(`href="${LINKEDIN_URL}"`);
    expect(html).not.toContain('href="#"');
  });
});
