// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { navigation } from '../src/ui/viewModel/contracts';
import { LINKEDIN_URL, SITE_URL } from '../src/ui/proxy';
import { railBlocks, railIcon, setRailBadge, sidebarMarkup } from '../src/ui/shell/sidebar';

afterEach(() => {
  document.body.innerHTML = '';
});

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
    const html = sidebarMarkup('library');
    const current = html.match(/aria-current="page"/g) ?? [];
    expect(current).toHaveLength(1);
    expect(html).toContain('data-view="library" aria-current="page"');
  });

  it('gives every rail button an accessible name', () => {
    const html = sidebarMarkup('component');
    for (const item of navigation) {
      expect(html).toContain(`aria-label="${item.label}"`);
    }
  });

  it('names the landmark Main, since it holds more than the workflows', () => {
    const html = sidebarMarkup('component');
    expect(html).toContain('<nav class="sl-sidebar" aria-label="Main">');
    expect(html).not.toContain('Workflows');
  });

  it('draws no badge at mount; setRailBadge is the only badge path', () => {
    expect(sidebarMarkup('component')).not.toContain('sl-sidebar-badge');
  });

  it('separates the workflow groups and bottom utilities', () => {
    const html = sidebarMarkup('component');
    const separators = html.match(/sl-sidebar-separator/g) ?? [];
    expect(separators).toHaveLength(3);
  });

  it('does not expose the deferred Help action as an inert control', () => {
    expect(sidebarMarkup('component')).not.toContain('Help & feedback');
  });

  it('puts the utility links at the bottom, below the spacer', () => {
    const html = sidebarMarkup('component');
    expect(html.indexOf('sl-sidebar-spacer')).toBeLessThan(html.indexOf('Spec Layer website'));
    expect(html).toContain('Spec Layer on LinkedIn');
    expect(html).toContain(`href="${SITE_URL}"`);
    expect(html).toContain(`href="${LINKEDIN_URL}"`);
    expect(html).not.toContain('href="#"');
  });
});

describe('setRailBadge', () => {
  function mountRail(): HTMLElement {
    document.body.innerHTML = sidebarMarkup('component');
    return document.querySelector<HTMLElement>('.sl-sidebar')!;
  }
  const library = (root: HTMLElement): HTMLButtonElement =>
    root.querySelector<HTMLButtonElement>('[data-view="library"]')!;

  it('draws an attention dot, never a count', () => {
    // It used to print counts.updates, a number the UI only learns one doc at a
    // time: it climbed 1, 2, 3 as source checks landed and vanished at the start
    // of every reload. "Something needs attention" is the whole message.
    const root = mountRail();
    setRailBadge(root, 'library', true);
    const badge = library(root).querySelector('.sl-sidebar-badge');
    expect(badge?.getAttribute('aria-hidden')).toBe('true');
    expect(badge?.textContent).toBe('');
  });

  it('puts the badge state on the accessible name, since a dot has no text', () => {
    const root = mountRail();
    setRailBadge(root, 'library', true);
    expect(library(root).getAttribute('aria-label')).toBe('Library, updates available');
    // Only the badged view is renamed; the others keep their plain label.
    expect(root.querySelector('[data-view="component"]')?.getAttribute('aria-label'))
      .toBe('Create component docs');

    setRailBadge(root, 'library', false);
    expect(library(root).getAttribute('aria-label')).toBe('Library');
    expect(library(root).querySelector('.sl-sidebar-badge')).toBeNull();
  });

  it('keeps the same dot across repaints of the same state', () => {
    const root = mountRail();
    setRailBadge(root, 'library', true);
    const first = library(root).querySelector('.sl-sidebar-badge');
    setRailBadge(root, 'library', true);
    expect(library(root).querySelectorAll('.sl-sidebar-badge')).toHaveLength(1);
    expect(library(root).querySelector('.sl-sidebar-badge')).toBe(first);
  });
});
