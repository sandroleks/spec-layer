import { describe, expect, it } from 'vitest';
import {
  COMPONENT_FORMATS,
  COMPONENT_FORMAT_NAME,
  DEFAULT_COMPONENT_FORMAT,
  isComponentFormat,
  storedComponentFormat,
} from '../src/componentFormat';

describe('component format', () => {
  it("uses the CLI's own two values, with YAML first and the default", () => {
    expect(COMPONENT_FORMATS).toEqual(['yaml', 'md']);
    expect(DEFAULT_COMPONENT_FORMAT).toBe('yaml');
  });

  it('accepts exactly the two values', () => {
    expect(isComponentFormat('yaml')).toBe(true);
    expect(isComponentFormat('md')).toBe(true);
    for (const value of ['markdown', 'YAML', 'MD', ' md', '', null, undefined, 1, {}, ['md']]) {
      expect(isComponentFormat(value)).toBe(false);
    }
  });

  it('reads a missing or unrecognised stored value as YAML, never as a guess', () => {
    expect(storedComponentFormat(undefined)).toBe('yaml');
    expect(storedComponentFormat(null)).toBe('yaml');
    expect(storedComponentFormat('yaml')).toBe('yaml');
    expect(storedComponentFormat('md')).toBe('md');
    expect(storedComponentFormat('markdown')).toBe('yaml');
    expect(storedComponentFormat(true)).toBe('yaml');
  });

  it('names each format the way the plugin says it, never as md', () => {
    expect(COMPONENT_FORMAT_NAME).toEqual({ yaml: 'YAML', md: 'Markdown' });
  });
});
