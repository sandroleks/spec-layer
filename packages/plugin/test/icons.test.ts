import { describe, it, expect } from 'vitest';
import { ICON_PATHS, icon } from '../src/ui/shell/icons';

describe('ICON_PATHS', () => {
  it('covers every icon the shell renders', () => {
    for (const name of [
      'fileDescription', 'layoutGrid', 'folder', 'settings', 'key',
      'search', 'sun', 'moon', 'world', 'brandLinkedin',
    ] as const) {
      expect(ICON_PATHS[name]).toBeTruthy();
    }
  });

  it('stores inner markup only, so the wrapper stays under our control', () => {
    for (const markup of Object.values(ICON_PATHS)) {
      expect(markup).not.toContain('<svg');
    }
  });
});

describe('icon', () => {
  it('wraps the markup in a sized, decorative svg', () => {
    const svg = icon('search', 16);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('width="16"');
    expect(svg).toContain('height="16"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain(ICON_PATHS.search);
  });

  it('defaults to 17px, the rail and header size', () => {
    expect(icon('folder')).toContain('width="17"');
  });

  it('strokes with currentColor so tokens drive the color', () => {
    expect(icon('key')).toContain('stroke="currentColor"');
  });
});
