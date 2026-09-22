import { describe, expect, it } from 'vitest';
import { code, escapeCell, escapeInline, table, componentMarkdown, COMPONENT_MARKDOWN_MARKER } from '../../src/v5/markdown';
import { buildComponentV5GoldenArtifact, buildComponentV5StyledArtifact } from '../fixtures/componentV5';

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

describe('componentMarkdown layout', () => {
  it('names the scope and tables the items', () => {
    const out = componentMarkdown(buildComponentV5GoldenArtifact());
    expect(out).toContain('## Layout');
    expect(out).toContain('Default variant.');
    expect(out).toContain('| Part | Layout |');
    expect(out).toContain('| `Container/container` | horizontal, padding 10/24/10/24, gap 8 |');
  });

  it('omits the section when there is no layout', () => {
    const artifact = buildComponentV5GoldenArtifact();
    expect(componentMarkdown({ ...artifact, layout: undefined })).not.toContain('## Layout');
  });
});

describe('componentMarkdown token bindings', () => {
  it('names the token, renders conditions, and keeps artifact order', () => {
    const out = componentMarkdown(buildComponentV5GoldenArtifact());
    expect(out).toContain('## Token bindings');
    expect(out).toContain('| Part | Property | Token | When |');
    expect(out).toContain(
      '| `Container/container` | fill | md.sys.color.primary | Style: Filled; State: Enabled |',
    );
    expect(out).toContain('| `Container/container` | border-radius | md.sys.shape.corner.full |  |');
  });

  it('states a non-resolved status beside the token name', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const used = artifact.references.used.map((r) =>
      r.source_id === 'VariableID:1' ? { ...r, status: 'external' as const } : r);
    const out = componentMarkdown({
      ...artifact, references: { ...artifact.references, used },
    });
    expect(out).toContain('md.sys.color.primary (external)');
  });

  it('falls back to the source id when the reference is unknown, never inventing a name', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact, references: { ...artifact.references, used: [] },
    });
    expect(out).toContain('| `Container/container` | fill | VariableID:1 |');
  });
});

describe('componentMarkdown tokens used', () => {
  it('states completeness and one column per mode', () => {
    const out = componentMarkdown(buildComponentV5GoldenArtifact());
    expect(out).toContain('## Tokens used');
    expect(out).toContain('Foundation: collections complete, styles complete.');
    expect(out).toContain('### Material tokens');
    expect(out).toContain('Modes: Default (default).');
    expect(out).toContain('| Token | Type | Default | Code syntax |');
    expect(out).toContain('| md.sys.color.primary | color | #6750a4 | WEB `--md-sys-color-primary` |');
    expect(out).toContain('| md.sys.shape.corner.full | dimension | 999px |');
  });

  it('says plainly that the foundation was not read', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact, references: { ...artifact.references, foundation: undefined },
    });
    expect(out).toContain(
      'Token values are not included: the foundations had not been read when this was exported.',
    );
    expect(out).not.toContain('### Material tokens');
  });

  it('lists unavailable sources and a partial completeness verbatim', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const foundation = {
      ...artifact.references.foundation!,
      completeness: {
        collections: 'partial' as const,
        styles: 'complete' as const,
        unavailable_sources: ['VariableID:gone'],
      },
    };
    const out = componentMarkdown({
      ...artifact, references: { ...artifact.references, foundation },
    });
    expect(out).toContain('Foundation: collections partial, styles complete.');
    expect(out).toContain('Unavailable sources: VariableID:gone.');
  });

  it('omits typography and effect subsections when the foundation carries none', () => {
    const out = componentMarkdown(buildComponentV5GoldenArtifact());
    expect(out).not.toContain('### Typography styles');
    expect(out).not.toContain('### Effect styles');
  });

  it('tables typography styles, rendering all four StyleProperty shapes', () => {
    const out = componentMarkdown(buildComponentV5StyledArtifact());
    expect(out).toContain('### Typography styles');
    expect(out).toContain(
      '| Style | Font family | Weight | Size | Line height | Letter spacing | Paragraph indent |',
    );
    // literal, resolved (font family / weight / line height)
    expect(out).toContain('Inter');
    expect(out).toContain('| Body/Regular | Inter | 400 |');
    expect(out).toContain('24px');
    // alias, resolved (font size aliases a real Foundation token)
    expect(out).toContain('Type scale/type.scale.body (resolved: 16px)');
    // literal, unresolved (letter spacing)
    expect(out).toContain('missing: source\\_unavailable');
    // alias, unresolved (paragraph indent aliases a dangling target)
    expect(out).toContain('missing/token (unresolved: target\\_not\\_found)');
  });

  it('tables effect styles, summarizing each layer', () => {
    const out = componentMarkdown(buildComponentV5StyledArtifact());
    expect(out).toContain('### Effect styles');
    expect(out).toContain('| Style | Mode | Effects |');
    expect(out).toContain(
      '| Elevation/Card |  | drop\\_shadow, offset 0px/2px, blur 8px, #000000 alpha 0.2 |',
    );
  });

  it('never renders a bare [object Object] for a value it does not recognise', () => {
    expect(componentMarkdown(buildComponentV5GoldenArtifact())).not.toContain('[object Object]');
    expect(componentMarkdown(buildComponentV5StyledArtifact())).not.toContain('[object Object]');
  });
});
