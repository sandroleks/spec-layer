import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from '../src/frontmatter';
import type { SpecFrontmatter } from '../src/types';

const fm: SpecFrontmatter = {
  spec_version: '0.1',
  status: 'draft',
  component: { name: 'Button', figma_key: 'abc123', figma_file: 'FILE1', figma_node: '1:23' },
  content_hash: 'deadbeef',
  extracted_at: '2026-06-10T00:00:00.000Z',
};

describe('frontmatter', () => {
  it('round-trips frontmatter and body', () => {
    const md = serializeFrontmatter(fm, '## Definition\n\nA button.\n');
    const parsed = parseFrontmatter(md);
    expect(parsed.frontmatter).toEqual(fm);
    expect(parsed.body).toBe('## Definition\n\nA button.\n');
  });

  it('rejects a document without frontmatter', () => {
    expect(() => parseFrontmatter('no frontmatter here')).toThrow(/frontmatter/i);
  });

  it('rejects an invalid status', () => {
    const md = serializeFrontmatter({ ...fm, status: 'bogus' as never }, '');
    expect(() => parseFrontmatter(md)).toThrow(/status/i);
  });

  it('accepts a 0.1 file written before the bump', () => {
    const md = serializeFrontmatter({ ...fm, spec_version: '0.1' }, 'body');
    expect(parseFrontmatter(md).frontmatter.spec_version).toBe('0.1');
  });

  it('accepts a 0.2 file', () => {
    const md = serializeFrontmatter({ ...fm, spec_version: '0.2' }, 'body');
    expect(parseFrontmatter(md).frontmatter.spec_version).toBe('0.2');
  });

  it('rejects an unsupported spec_version', () => {
    const md = serializeFrontmatter({ ...fm, spec_version: '9.9' as never }, '');
    expect(() => parseFrontmatter(md)).toThrow(/spec_version/i);
  });

  it('parses a CRLF-encoded document successfully', () => {
    const md = serializeFrontmatter(fm, '## Definition\n\nA button.\n');
    const crlf = md.replace(/\n/g, '\r\n');
    const parsed = parseFrontmatter(crlf);
    expect(parsed.frontmatter).toEqual(fm);
  });

  it('parses every reference example without error', async () => {
    const fs = await import('node:fs');
    for (const f of [
      'button.md',
      'text-field.md',
      'dialog.md',
      'checkbox.md',
      'switch.md',
      'banner.md',
      'tabs.md',
      'tooltip.md',
      'select.md',
    ]) {
      const raw = fs.readFileSync(new URL(`../../../spec/examples/${f}`, import.meta.url), 'utf8');
      expect(() => parseFrontmatter(raw)).not.toThrow();
    }
  });
});
