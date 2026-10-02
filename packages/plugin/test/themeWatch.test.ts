// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { watchFigmaTheme, type ThemeMode } from '../src/ui/theme';

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

afterEach(() => { document.documentElement.className = ''; });

describe('watchFigmaTheme', () => {
  it('reports each change of Figma\'s theme class, once per change', async () => {
    document.documentElement.className = 'figma-light';
    const seen: ThemeMode[] = [];
    const stop = watchFigmaTheme((mode) => seen.push(mode));
    document.documentElement.className = 'figma-dark';
    await flush();
    document.documentElement.className = 'figma-dark other';
    await flush();
    document.documentElement.className = 'figma-light';
    await flush();
    expect(seen).toEqual(['dark', 'light']);
    stop();
    document.documentElement.className = 'figma-dark';
    await flush();
    expect(seen).toEqual(['dark', 'light']);
  });
});
