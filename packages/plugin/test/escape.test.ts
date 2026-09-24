import { describe, expect, it } from 'vitest';
import { esc } from '../src/ui/escape';

describe('esc', () => {
  it('escapes the four characters that can end text or a double-quoted attribute', () => {
    expect(esc('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it('leaves a single quote alone, since every attribute in this UI is double-quoted', () => {
    expect(esc("it's")).toBe("it's");
  });

  it('is idempotent on already-escaped text only by escaping the ampersand again', () => {
    expect(esc('&amp;')).toBe('&amp;amp;');
  });

  it('never yields markup from a hostile name', () => {
    expect(esc('<img src=x onerror=alert(1)>')).not.toContain('<');
  });
});
