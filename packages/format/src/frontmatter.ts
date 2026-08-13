import YAML from 'yaml';
import type { SpecFrontmatter, SpecStatus, SpecVersion } from './types';

const STATUSES: SpecStatus[] = ['draft', 'approved', 'deprecated'];
const READABLE_VERSIONS: SpecVersion[] = ['0.1', '0.2'];

export function serializeFrontmatter(fm: SpecFrontmatter, body: string): string {
  return `---\n${YAML.stringify(fm)}---\n\n${body}`;
}

export function parseFrontmatter(md: string): { frontmatter: SpecFrontmatter; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n*/);
  if (!m) throw new Error('Missing YAML frontmatter');
  const fm = YAML.parse(m[1]) as SpecFrontmatter;
  if (!READABLE_VERSIONS.includes(fm.spec_version)) {
    throw new Error(`Unsupported spec_version: ${fm.spec_version}`);
  }
  // `status` is optional. Only reject a present-but-unrecognized value.
  if (fm.status !== undefined && !STATUSES.includes(fm.status)) throw new Error(`Invalid status: ${fm.status}`);
  if (!fm.component?.name || !fm.component?.figma_key || !fm.component?.figma_file || !fm.component?.figma_node)
    throw new Error('Missing component identity');
  if (!fm.content_hash) throw new Error('Missing content_hash');
  return { frontmatter: fm, body: md.slice(m[0].length) };
}
