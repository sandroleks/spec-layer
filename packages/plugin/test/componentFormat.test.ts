import { describe, expect, it } from 'vitest';
import {
  COMPONENT_FORMATS,
  COMPONENT_FORMAT_NAME,
  DEFAULT_COMPONENT_FORMAT,
  isComponentFormat,
  storedComponentFormat,
} from '../src/componentFormat';

describe('component format', () => {
  it("uses the CLI's own two values, YAML first, with Markdown the default", () => {
    expect(COMPONENT_FORMATS).toEqual(['yaml', 'md']);
    expect(DEFAULT_COMPONENT_FORMAT).toBe('md');
  });

  it('accepts exactly the two values', () => {
    expect(isComponentFormat('yaml')).toBe(true);
    expect(isComponentFormat('md')).toBe(true);
    for (const value of ['markdown', 'YAML', 'MD', ' md', '', null, undefined, 1, {}, ['md']]) {
      expect(isComponentFormat(value)).toBe(false);
    }
  });

  it('reads a missing or unrecognised stored value as Markdown, never as a guess', () => {
    expect(storedComponentFormat(undefined)).toBe('md');
    expect(storedComponentFormat(null)).toBe('md');
    expect(storedComponentFormat('yaml')).toBe('yaml');
    expect(storedComponentFormat('md')).toBe('md');
    expect(storedComponentFormat('markdown')).toBe('md');
    expect(storedComponentFormat(true)).toBe('md');
  });

  it('names each format the way the plugin says it, never as md', () => {
    expect(COMPONENT_FORMAT_NAME).toEqual({ yaml: 'YAML', md: 'Markdown' });
  });
});
