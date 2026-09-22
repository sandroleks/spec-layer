import { describe, expect, it } from 'vitest';
import { code, escapeCell, escapeInline, table, componentMarkdown, COMPONENT_MARKDOWN_MARKER } from '../../src/v5/markdown';
import { buildComponentV5GoldenArtifact } from '../fixtures/componentV5';

describe('markdown primitives', () => {
  it('collapses newlines and escapes inline markup', () => {
    expect(escapeInline('a\nb')).toBe('a b');
    expect(escapeInline('*bold* _it_ <b> [x]')).toBe('\\*bold\\* \\_it\\_ \\<b\\> \\[x\\]');
    expect(escapeInline('>q')).toBe('\\>q');
  });

  it('escapes pipes in cells', () => {
    expect(escapeCell('a|b')).toBe('a\\|b');
    expect(escapeCell('a\nb')).toBe('a b');
  });

  it('widens the fence when the text holds a backtick', () => {
    expect(code('plain')).toBe('`plain`');
    expect(code('has`tick')).toBe('`` has`tick ``');
    expect(code('has``two')).toBe('``` has``two ```');
  });

  it('renders a table with a separator row', () => {
    expect(table(['A', 'B'], [['1', '2'], ['3', '']])).toBe(
      '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 |  |\n',
    );
  });
});

describe('componentMarkdown front matter', () => {
  it('opens with the markdown marker and names the profile', () => {
    const out = componentMarkdown(buildComponentV5GoldenArtifact());
    expect(out.startsWith(COMPONENT_MARKDOWN_MARKER)).toBe(true);
    expect(out).toContain('profile: markdown');
    expect(out).toContain('# Button');
    expect(out).toContain('Related: Icon');
  });

  it('ends with exactly one newline and holds no tab or NUL', () => {
    const out = componentMarkdown(buildComponentV5GoldenArtifact());
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
    expect(out).not.toMatch(/[\t\0]/);
  });

  it('is deterministic and does not mutate the artifact', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const before = JSON.stringify(artifact);
    expect(componentMarkdown(artifact)).toBe(componentMarkdown(artifact));
    expect(JSON.stringify(artifact)).toBe(before);
  });

  it('renders a figma description as the lead paragraph', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact, component: { ...artifact.component, description: 'Triggers an action.' },
    } as typeof artifact);
    expect(out).toContain('# Button\n\nTriggers an action.');
  });

  it('renders no lead paragraph for an empty description', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact, component: { ...artifact.component, description: '' },
    } as typeof artifact);
    expect(out).toContain('# Button\n\nRelated: Icon');
  });
});

describe('componentMarkdown properties', () => {
  it('renders one row per axis, boolean and slot, with blank cells for absent facts', () => {
    const out = componentMarkdown(buildComponentV5GoldenArtifact());
    expect(out).toContain('## Properties');
    expect(out).toContain('| Property | Type | Options | Default |');
    expect(out).toContain('| Style | Variant | Filled, Outlined | Filled |');
    expect(out).toContain('| Show icon | Boolean |  | false |');
    expect(out).toContain('| Label | Text |  | Button |');
    expect(out).toContain('States: Enabled, Hovered, Disabled');
  });

  it('omits the section entirely when there is no api', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({ ...artifact, api: undefined });
    expect(out).not.toContain('## Properties');
    expect(out).not.toContain('States:');
  });
});

describe('componentMarkdown anatomy', () => {
  it('renders one bullet per part, lowercasing the node type', () => {
    const out = componentMarkdown(buildComponentV5GoldenArtifact());
    expect(out).toContain('## Anatomy');
    expect(out).toContain('- container: `Container/container`, frame');
    expect(out).toContain('- label: `Container/label`, text');
    expect(out).toContain('- icon: `Container/icon`, instance of Icon');
  });

  it('indents children and states the boolean that shows a part', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      anatomy: [{
        part: 'root', path: 'Root', type: 'FRAME',
        children: [{ part: 'kid', path: 'Root/kid', type: 'TEXT', shown_by: 'Show icon' }],
      }],
    } as typeof artifact);
    expect(out).toContain('- root: `Root`, frame\n  - kid: `Root/kid`, text, shown when `Show icon` is true');
  });

  it('omits the section when anatomy is empty', () => {
    const artifact = buildComponentV5GoldenArtifact();
    expect(componentMarkdown({ ...artifact, anatomy: [] })).not.toContain('## Anatomy');
  });
});
