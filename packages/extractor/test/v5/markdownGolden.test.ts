import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_V5_MARKDOWN_GOLDEN_PATH, renderComponentV5MarkdownGolden,
  writeComponentV5MarkdownGolden,
} from '../fixtures/componentV5';
import { COMPONENT_MARKDOWN_MARKER } from '../../src/index';

if (process.env.UPDATE_COMPONENT_V5_GOLDEN === '1') writeComponentV5MarkdownGolden();

describe('Component Context v5 reviewed markdown golden', () => {
  it('matches the reviewed page byte for byte', () => {
    expect(renderComponentV5MarkdownGolden())
      .toBe(readFileSync(COMPONENT_V5_MARKDOWN_GOLDEN_PATH, 'utf8'));
  });

  it('carries the ownership marker and no forbidden bytes', () => {
    const out = renderComponentV5MarkdownGolden();
    expect(out.startsWith(COMPONENT_MARKDOWN_MARKER)).toBe(true);
    // Built at runtime, not as a regex literal: a backslash-zero escape fails
    // scripts/check-nul-bytes.mjs, and a unicode control escape fails the
    // no-control-regex lint rule, which is only disabled for src/yaml.ts.
    expect(out).not.toMatch(new RegExp('['
      + String.fromCharCode(9) + String.fromCharCode(0)
      + String.fromCharCode(0x2014) + String.fromCharCode(0x2013)
      + ']'));
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});
