import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPONENT_V5_MARKDOWN_GOLDEN_PATH, COMPONENT_V5_MARKDOWN_PROSE_GOLDEN_PATH,
  renderComponentV5MarkdownGolden, renderComponentV5MarkdownProseGolden,
  writeComponentV5MarkdownGolden, writeComponentV5MarkdownProseGolden,
} from '../fixtures/componentV5';
import { COMPONENT_MARKDOWN_MARKER } from '../../src/index';

if (process.env.UPDATE_COMPONENT_V5_GOLDEN === '1') {
  writeComponentV5MarkdownGolden();
  writeComponentV5MarkdownProseGolden();
}

// Built at runtime, not as a regex literal: a backslash-zero escape fails
// scripts/check-nul-bytes.mjs, and a unicode control escape fails the
// no-control-regex lint rule, which is only disabled for src/yaml.ts.
const HOSTILE_BYTES = new RegExp('[' + [9, 0, 8211, 8212]
  .map((point) => String.fromCharCode(point)).join('') + ']');

describe('Component Context v5 reviewed markdown golden', () => {
  it('matches the reviewed page byte for byte', () => {
    expect(renderComponentV5MarkdownGolden())
      .toBe(readFileSync(COMPONENT_V5_MARKDOWN_GOLDEN_PATH, 'utf8'));
  });

  it('carries the ownership marker and no forbidden bytes', () => {
    const out = renderComponentV5MarkdownGolden();
    expect(out.startsWith(COMPONENT_MARKDOWN_MARKER)).toBe(true);
    expect(out).not.toMatch(HOSTILE_BYTES);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});

/**
 * The second reviewed page. The golden above renders an artifact with no
 * `guidelines` at all, so the only page a human had signed off carried no
 * `## Overview`, no AI marker, no demoted heading and no `## Do and don't`:
 * the whole prose half of the renderer had never been read as a document,
 * which is how two Important defects in it survived thirteen task reviews.
 * This one carries a description and every prose section.
 */
describe('Component Context v5 reviewed markdown golden with prose', () => {
  it('matches the reviewed page byte for byte', () => {
    expect(renderComponentV5MarkdownProseGolden())
      .toBe(readFileSync(COMPONENT_V5_MARKDOWN_PROSE_GOLDEN_PATH, 'utf8'));
  });

  it('carries the ownership marker and no forbidden bytes', () => {
    const out = renderComponentV5MarkdownProseGolden();
    expect(out.startsWith(COMPONENT_MARKDOWN_MARKER)).toBe(true);
    expect(out).not.toMatch(HOSTILE_BYTES);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });

  it('keeps the whole prose half honest: one H1, marked AI prose, no escaped markup', () => {
    const out = renderComponentV5MarkdownProseGolden();
    // The renderer's own title is still the only H1, with every model-written
    // heading floored at `###` by `demote`.
    expect(out.split('\n').filter((line) => /^# /.test(line))).toEqual(['# Button']);
    // Bold lead-ins and inline code survive as Markdown, not as escaped text:
    // these rules are fragments the model wrote, not plain strings.
    expect(out).toContain("- **Don't use a button for plain navigation.**");
    expect(out).toContain('use a link (`<a>`) when it just goes somewhere');
    expect(out).not.toContain('\\*\\*');
    expect(out).not.toContain('\\<');
    expect(out).toContain('### Do\n');
    expect(out).toContain("### Don't\n");
    expect(out).not.toContain('[object Object]');
  });
});
