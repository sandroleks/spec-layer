import { describe, it, expect } from 'vitest';
import { shellMarkup } from '../src/ui/shell/shell';

describe('shellMarkup', () => {
  it('lays out rail, header, and screen inside one shell', () => {
    const html = shellMarkup('component');
    expect(html).toContain('sl-plugin-shell');
    expect(html).toContain('sl-sidebar');
    expect(html).toContain('sl-utility-header');
    expect(html).toContain('sl-screen');
  });

  /**
   * .sl-plugin-shell is a grid that places the header at `1 / -1`, the rail at
   * column 1, and the screen at column 2. All three have to be direct
   * children: any wrapper element silently breaks the whole layout.
   */
  it('keeps the three regions as direct children of the grid', () => {
    const html = shellMarkup('component');
    expect(html).toContain('<div class="sl-plugin-shell"><header');
    expect(html).not.toContain('sl-main');
  });

  it('reads header, then rail, then screen', () => {
    const html = shellMarkup('component');
    expect(html.indexOf('sl-utility-header')).toBeLessThan(html.indexOf('sl-sidebar'));
    expect(html.indexOf('sl-sidebar')).toBeLessThan(html.indexOf('sl-screen"'));
  });

  it('marks the requested view as current', () => {
    expect(shellMarkup('settings')).toContain('data-view="settings" aria-current="page"');
  });

  it('gives the screen all three of its rows', () => {
    const html = shellMarkup('component');
    expect(html).toContain('sl-page-header');
    expect(html).toContain('sl-screen-scroll');
    expect(html).toContain('sl-screen-footer');
  });
});
