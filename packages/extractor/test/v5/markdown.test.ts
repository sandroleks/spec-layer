import { describe, expect, it } from 'vitest';
import { code, escapeCell, escapeInline, table, componentMarkdown, COMPONENT_MARKDOWN_MARKER } from '../../src/v5/markdown';
import { buildComponentV5GoldenArtifact, buildComponentV5StyledArtifact } from '../fixtures/componentV5';

// The exact sentence `tokensUsedSection` (`markdown.ts`) renders when
// `references.foundation` is absent, pinned here as its own constant per
// Task 12's brief rather than repeated as an inline literal below.
const NOT_READ_SENTENCE =
  'Token values are not included: the foundations had not been read when this was exported.';

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
    // Built at runtime, not as a regex literal: a backslash-zero escape fails
    // scripts/check-nul-bytes.mjs, and a unicode control escape fails the
    // no-control-regex lint rule, which is only disabled for src/yaml.ts.
    expect(out).not.toMatch(new RegExp('[' + String.fromCharCode(9) + String.fromCharCode(0) + ']'));
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

  // The description is live designer-authored free text pushed as its own
  // BLOCK directly under the H1, so it is the one prose slot where a leading
  // block-opening construct would not read as the text the designer typed.
  // `escapeInline` neutralises inline markup only: it does not touch `#`,
  // backticks, `~`, `-`, `+`, `=` or a leading ordered-list marker.
  const withDescription = (description: string): string => {
    const artifact = buildComponentV5GoldenArtifact();
    return componentMarkdown({
      ...artifact, component: { ...artifact.component, description },
    } as typeof artifact);
  };

  it('neutralises a leading code fence, so the description cannot swallow the page', () => {
    const out = withDescription('```ts\nconst label = "Save";');
    expect(out).toContain('# Button\n\n\\```ts const label = "Save";');
    // Not one fence delimiter anywhere: an unclosed fence here would turn
    // every table and heading below into sample text.
    expect(out.split('\n').filter((line) => /^(`{3,}|~{3,})/.test(line))).toEqual([]);
  });

  it('neutralises a leading ##, so a description cannot forge a section heading', () => {
    const out = withDescription('## Usage\n\nUse it for the primary action.');
    expect(out).toContain('# Button\n\n\\## Usage');
    expect(out).not.toMatch(/^## Usage$/m);
  });

  it('neutralises a leading #, so the title stays the only H1', () => {
    const out = withDescription('# Button styles');
    expect(out).toContain('# Button\n\n\\# Button styles');
    expect(out.split('\n').filter((line) => /^# /.test(line))).toEqual(['# Button']);
  });

  it('neutralises every other leading block opener a description can carry', () => {
    const cases: Array<[string, string]> = [
      ['- One, then two', '\\- One, then two'],
      ['+ One', '\\+ One'],
      ['~~~\nsample', '\\~~~ sample'],
      ['=== not an underline', '\\=== not an underline'],
      ['2026. A good year for buttons', '2026\\. A good year for buttons'],
      ['1) First of two', '1\\) First of two'],
    ];
    for (const [description, lead] of cases) {
      expect(withDescription(description)).toContain(`# Button\n\n${lead}\n`);
    }
  });

  it('leaves one or two leading backticks alone, since neither can open a block', () => {
    // Escaping them would turn a description that legitimately opens with an
    // inline code span into literal backticks, which is a worse page.
    expect(withDescription('`Container` is the root frame.'))
      .toContain('# Button\n\n`Container` is the root frame.');
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

  it('tables effect styles, separating layers with a semicolon', () => {
    const out = componentMarkdown(buildComponentV5StyledArtifact());
    expect(out).toContain('### Effect styles');
    expect(out).toContain('| Style | Mode | Effects |');
    // Two layers on one style: `; ` marks the boundary between them, distinct
    // from the `, ` between a single layer's own fields, so a reader (or an
    // agent) cannot mistake "blur 8px" and "blur 4px" for the same layer.
    expect(out).toContain(
      '| Elevation/Card |  | drop\\_shadow, offset 0px/2px, blur 8px, #000000 alpha 0.2; '
      + 'layer\\_blur, blur 4px (hidden) |',
    );
  });

  it('marks a hidden effect layer, leaving a visible one unmarked', () => {
    const out = componentMarkdown(buildComponentV5StyledArtifact());
    // The visible drop shadow layer carries no marker at all.
    expect(out).toContain('#000000 alpha 0.2;');
    expect(out).not.toContain('#000000 alpha 0.2 (hidden)');
    // The hidden blur layer is marked, so an agent cannot implement a shadow
    // the designer turned off.
    expect(out).toContain('layer\\_blur, blur 4px (hidden)');
  });

  it('never renders a bare [object Object] for a value it does not recognise', () => {
    expect(componentMarkdown(buildComponentV5GoldenArtifact())).not.toContain('[object Object]');
    expect(componentMarkdown(buildComponentV5StyledArtifact())).not.toContain('[object Object]');
  });
});

describe('componentMarkdown effects', () => {
  it('omits the section when there is no inline effect', () => {
    const out = componentMarkdown(buildComponentV5GoldenArtifact());
    expect(out).not.toContain('## Effects');
  });

  it('tables inline effect layers by their real fields, separating layers with a semicolon', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      effects_inline: [
        {
          path: 'Container/container',
          layers: [
            {
              type: 'drop-shadow', visible: true, blendMode: 'NORMAL',
              color: { hex: '#000000', alpha: 0.2 }, offset: { x: 0, y: 2 }, radius: 8,
              bindings: {
                radius: {
                  source_id: 'VariableID:9', name: 'md.sys.elevation.blur',
                  kind: 'variable', remote: false,
                },
              },
            },
            { type: 'layer-blur', blurType: 'normal', visible: false, radius: 4 },
          ],
        },
      ],
    } as typeof artifact);
    expect(out).toContain('## Effects');
    expect(out).toContain('| Part | Effects |');
    expect(out).toContain(
      '| `Container/container` | drop-shadow, offset 0/2, radius 8, #000000 alpha 0.2, '
      + 'radius bound to md.sys.elevation.blur; layer-blur, radius 4 (hidden) |',
    );
  });

  it('renders every other concrete effect shape by its own fields, never [object Object]', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      effects_inline: [
        {
          path: 'Container/backdrop',
          layers: [
            {
              type: 'background-blur', blurType: 'progressive', visible: true,
              radius: 12, startRadius: 0, startOffset: { x: 0, y: 0 }, endOffset: { x: 0, y: 100 },
            },
            {
              type: 'noise', noiseType: 'monotone', visible: true, blendMode: 'NORMAL',
              color: { hex: '#ffffff', alpha: 1 }, noiseSize: 1, density: 0.5,
            },
            { type: 'texture', visible: true, noiseSize: 1, radius: 2, clipToShape: true },
            {
              type: 'glass', visible: true, radius: 4, lightIntensity: 1, lightAngle: 45,
              refraction: 1.1, depth: 2, dispersion: 0.1,
            },
            { type: 'unknown', figma_type: 'FUTURE_EFFECT' },
          ],
        },
      ],
    } as typeof artifact);
    expect(out).toContain(
      'background-blur (progressive), radius 12, start radius 0, start offset 0/0, end offset 0/100',
    );
    expect(out).toContain('noise (monotone), #ffffff alpha 1, size 1, density 0.5');
    expect(out).toContain('texture, size 1, radius 2, clip true');
    expect(out).toContain(
      'glass, radius 4, light intensity 1, light angle 45, refraction 1.1, depth 2, dispersion 0.1',
    );
    expect(out).toContain('unknown (FUTURE\\_EFFECT)');
    expect(out).not.toContain('[object Object]');
  });
});

describe('componentMarkdown unbound and issues', () => {
  it('tables unbound values and leaves an absent value blank', () => {
    const out = componentMarkdown(buildComponentV5GoldenArtifact());
    expect(out).toContain('## Unbound values');
    expect(out).toContain('| Part | Property | Issue | Value |');
    expect(out).toContain('| `Container/container` | gap | hardcoded-value | 8 |');
    expect(out).toContain('| `Container/label` | typography | missing-token-binding |  |');
  });

  it('omits the section when there is no unbound value', () => {
    const artifact = buildComponentV5GoldenArtifact();
    expect(componentMarkdown({ ...artifact, unbound: undefined })).not.toContain('## Unbound values');
  });

  it('renders no Issues section when every validation row is an unbound value', () => {
    expect(componentMarkdown(buildComponentV5GoldenArtifact())).not.toContain('## Issues');
  });

  it('renders non-unbound validation rows under Issues', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      validation: [{
        id: 'orphan-part', severity: 'error', path: 'Container/x',
        property: 'fill', message: 'fill points at a deleted variable.',
      }],
    } as typeof artifact);
    expect(out).toContain('## Issues');
    expect(out).toContain('- error: fill points at a deleted variable. (`Container/x`, fill)');
  });

  it('renders a diagnostic-derived validation row exactly once, never doubled by the raw diagnostic', () => {
    // HUMAN RULING (superseding the original brief): `## Issues` reads
    // `validation` alone. `buildComponentArtifactV5` (`componentContext.ts:767`)
    // already folds every `artifact.diagnostics` entry into `validation` via
    // `componentDiagnosticRows`, which adds `path`/`property` the raw
    // diagnostic itself does not carry -- so the `validation` copy is
    // strictly more informative, and also iterating `artifact.diagnostics`
    // would render the same underlying finding twice.
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      validation: [{
        id: 'unresolved-reference', severity: 'error', path: 'Container/x',
        property: 'fill', message: 'fill points at a deleted variable.',
      }],
      diagnostics: [{
        code: 'UNRESOLVED_REFERENCE', severity: 'error', entity_id: 'Container/x',
        message: 'fill points at a deleted variable.',
      }],
    } as typeof artifact);
    expect(out.split('fill points at a deleted variable.').length - 1).toBe(1);
  });

  it('never renders a bare diagnostic that has no corresponding validation row', () => {
    // Pins the ruling deliberately: `artifact.diagnostics` is never read by
    // `## Issues` (`componentContext.ts:767` already folds every diagnostic
    // into `validation`, so a diagnostic with no validation counterpart is
    // not a real production shape, but the renderer must not read it anyway).
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      diagnostics: [{
        code: 'INCONSISTENT_REFERENCE', severity: 'warning', entity_id: 'Container/y',
        message: 'a lone diagnostic with no validation row.',
      }],
    } as typeof artifact);
    expect(out).not.toContain('a lone diagnostic with no validation row.');
    expect(out).not.toContain('## Issues');
  });

  it('renders a validation row with no path or property as a bare bullet', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      validation: [{ id: 'artifact-level', severity: 'warning', message: 'something is off.' }],
    } as typeof artifact);
    expect(out).toContain('- warning: something is off.\n');
  });

  it('never renders a bare [object Object] anywhere in unbound or issues', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      validation: [{
        id: 'orphan-part', severity: 'error', path: 'Container/x',
        property: 'fill', message: 'fill points at a deleted variable.',
      }],
    } as typeof artifact);
    expect(out).not.toContain('[object Object]');
  });
});

/** A backslash inside a code span is a LITERAL character, never an escape, so
 * one there is a character no artifact ever said: a page rendering `` `\<a>` ``
 * tells a coding agent to write a tag the design system does not contain.
 * `\|` is the one deliberate exception, produced by `codeCell` so a hostile
 * path cannot widen a GFM table row; Task 12 verified against
 * `mdast-util-gfm-table` that the row splitter honours it and that it still
 * renders as a literal `|`.
 *
 * Pairs backticks naively, so it is for WELL-FORMED input only. Text carrying
 * stray backticks of its own (the hostile sweep's `NASTY`) makes any
 * line-local pairing ambiguous, here and in a real CommonMark parser alike,
 * and this would then read escaped prose BETWEEN two unrelated backticks as a
 * span. That case is covered by the sweep's table and heading assertions
 * instead. */
function assertNoStrayBackslashInCodeSpans(markdown: string): void {
  for (const span of markdown.match(/`[^`\n]+`/g) ?? []) {
    expect(span.replace(/\\\|/g, '')).not.toContain('\\');
  }
}

describe('componentMarkdown prose', () => {
  const AI_MARKER = '*Written by AI from the extracted facts, not read from Figma.*';
  const markerRegex = new RegExp(AI_MARKER.replace(/[*.]/g, '\\$&'), 'g');

  // The seven headings the renderer produces from `guidelines`, per the
  // plan's section mapping: `## Overview`, `## Variants`, `## Do and don't`,
  // `## Accessibility`, `## Interactions`, `## Content considerations`,
  // `## Design considerations`. `anatomy_summary` is deliberately left out of
  // this fixture -- it extends the existing `## Anatomy` heading rather than
  // opening one of its own, and is covered by its own test below, so this
  // count stays a clean 7.
  const GUIDELINES = {
    origin: 'generated',
    definition: 'A button triggers an action.',
    variants_summary: 'Filled leads. Outlined is secondary.',
    accessibility: '## Keyboard\n\nEnter activates.',
    interactions: 'Hover darkens the fill.',
    content_considerations: 'Use a verb.',
    design_considerations: 'Keep one filled button per view.',
    dos: ['Use for the primary action.'],
    donts: ['Do not use for navigation.'],
  };

  it('reads the snake_case artifact keys and marks every prose section', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({ ...artifact, guidelines: GUIDELINES } as typeof artifact);
    for (const heading of ['## Overview', '## Variants', "## Do and don't",
      '## Accessibility', '## Interactions', '## Content considerations',
      '## Design considerations']) {
      expect(out).toContain(heading);
    }
    expect(out).toContain('A button triggers an action.');
    expect(out).toContain('- Use for the primary action.');
    expect(out).toContain('- Do not use for navigation.');
    expect(out.match(markerRegex)).toHaveLength(7);
    expect(out).not.toContain('[object Object]');
    assertNoStrayBackslashInCodeSpans(out);
  });

  // A Do/Don't rule is a Markdown FRAGMENT, exactly like every other prose
  // field: the prose prompt asks for a bold lead-in on each one and its own
  // exemplars carry inline code spans. Escaping them printed literal `\*\*`
  // and, worse, put a backslash inside a code span.
  it('embeds each rule as the markdown fragment it is, under its own label', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: {
        origin: 'generated',
        dos: ['**Use one primary action per view.** Its weight tells people where to go next.'],
        donts: ["**Don't use a button for navigation.** Use a link (`<a>`) when it goes somewhere."],
      },
    } as typeof artifact);
    expect(out).toContain('- **Use one primary action per view.**');
    expect(out).not.toContain('\\*\\*');
    expect(out).toContain('Use a link (`<a>`) when it goes somewhere.');
    assertNoStrayBackslashInCodeSpans(out);
    // Two labelled lists: without the subheadings CommonMark reads a bare `-`
    // list, a blank line and a second bare `-` list as ONE loose list, so
    // nothing in the page says which rules are prohibitions.
    expect(out).toContain(`## Do and don't\n\n${AI_MARKER}\n\n### Do\n\n- **Use one`);
    expect(out).toContain("### Don't\n\n- **Don't use a button");
    // The section still carries exactly one AI marker, on the `##` heading.
    expect(out.match(markerRegex)).toHaveLength(1);
  });

  it('floors a heading inside a rule at level 3, like every other prose blob', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: { origin: 'generated', dos: ['# Shouting\n\nA rule with a heading in it.'] },
    } as typeof artifact);
    expect(out).toContain('- ### Shouting');
    expect(out).not.toMatch(/^# Shouting$/m);
    expect(out.split('\n').filter((line) => /^# /.test(line))).toEqual(['# Button']);
    // A rule that arrives with a line break stays inside its own bullet.
    expect(out).toContain('\n  A rule with a heading in it.');
  });

  it('labels only the list that has rules, when one of the two is empty', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: { origin: 'generated', donts: ['**Never** ship it disabled with no reason.'] },
    } as typeof artifact);
    expect(out).toContain("### Don't\n\n- **Never** ship it disabled with no reason.");
    expect(out).not.toContain('### Do\n');
  });

  it('places Overview before Properties and the rest after the fact sections', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({ ...artifact, guidelines: GUIDELINES } as typeof artifact);
    expect(out.indexOf('## Overview')).toBeLessThan(out.indexOf('## Properties'));
    // `## Unbound values` is the golden artifact's last fact section (it never
    // trips `## Issues`, per the existing tests above).
    expect(out.indexOf('## Unbound values')).toBeLessThan(out.indexOf('## Variants'));
    expect(out.indexOf('## Variants')).toBeLessThan(out.indexOf("## Do and don't"));
  });

  it('extends the existing Anatomy section with the summary paragraph and its own marker', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: {
        origin: 'generated',
        anatomy_summary: 'A container wrapping a label and an optional icon.',
      },
    } as typeof artifact);
    // One `## Anatomy` heading: Task 5's bullets are extended, never duplicated.
    expect(out.match(/^## Anatomy$/m)).toHaveLength(1);
    expect(out).toContain(
      '## Anatomy\n\n' + AI_MARKER + '\n\nA container wrapping a label and an optional icon.',
    );
    expect(out.match(markerRegex)).toHaveLength(1);
  });

  it('renders nothing for the camelCase input names, so the 2026-09-19 mistake cannot return', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: {
        origin: 'generated', variantsSummary: 'x', anatomySummary: 'y',
        contentConsiderations: 'z', designConsiderations: 'w', anatomyParts: [{ name: 'a', role: 'b' }],
      },
    } as typeof artifact);
    expect(out).not.toContain('## Variants');
    expect(out).not.toContain('## Content considerations');
    expect(out).not.toContain('## Design considerations');
    expect(out).not.toContain('## Origin');
    expect(out).not.toContain(AI_MARKER);
  });

  it('demotes a heading inside a prose blob so a model cannot open a top-level section', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: { origin: 'generated', accessibility: '# Keyboard\n\nEnter activates.' },
    } as typeof artifact);
    expect(out).toContain('### Keyboard');
    expect(out).not.toMatch(/^# Keyboard$/m);
  });

  it('renders no prose section at all for the golden artifact, which carries no guidelines', () => {
    const artifact = buildComponentV5GoldenArtifact();
    expect(artifact.guidelines).toBeUndefined();
    const out = componentMarkdown(artifact);
    for (const heading of ['## Overview', '## Variants', "## Do and don't",
      '## Accessibility', '## Interactions', '## Content considerations',
      '## Design considerations']) {
      expect(out).not.toContain(heading);
    }
    expect(out).not.toContain(AI_MARKER);
  });
});

describe('componentMarkdown prose heading demotion', () => {
  it('neutralises a setext H1 (an underline of "="), leaving no bare heading line', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: { origin: 'generated', accessibility: 'Keyboard\n========\n\nEnter activates.' },
    } as typeof artifact);
    expect(out).toContain('### Keyboard');
    expect(out).not.toMatch(/^# Keyboard$/m);
    expect(out.split('\n')).not.toContain('========');
  });

  it('neutralises a setext H2 (an underline of "-"), dropping the underline itself', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: { origin: 'generated', accessibility: 'Keyboard\n--------\n\nEnter activates.' },
    } as typeof artifact);
    expect(out).toContain('### Keyboard');
    expect(out.split('\n')).not.toContain('--------');
  });

  it('leaves a thematic break (a "-" line after a blank line) alone, not a setext heading', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: {
        origin: 'generated',
        accessibility: 'Some intro text.\n\n---\n\nMore text after the break.',
      },
    } as typeof artifact);
    expect(out.split('\n')).toContain('---');
    expect(out).not.toContain('### Some intro text.');
    expect(out).not.toContain('### ---');
  });

  it('demotes an ATX heading indented up to three spaces, per CommonMark', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: { origin: 'generated', accessibility: '  # Keyboard\n\nEnter activates.' },
    } as typeof artifact);
    expect(out).toContain('### Keyboard');
    expect(out).not.toMatch(/^ {0,3}# Keyboard$/m);
  });

  it('leaves a "#" line untouched inside a fenced code block, and keeps the fence intact', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const blob = 'Use it like this:\n\n```\n# comment inside the sample\necho hi\n```\n\nDone.';
    const out = componentMarkdown({
      ...artifact,
      guidelines: { origin: 'generated', accessibility: blob },
    } as typeof artifact);
    expect(out).toContain('# comment inside the sample');
    expect(out).not.toContain('### comment inside the sample');
    expect(out).toContain('```\n# comment inside the sample\necho hi\n```');
  });

  it('still demotes a plain ATX heading (the existing case)', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: { origin: 'generated', accessibility: '# Keyboard\n\nEnter activates.' },
    } as typeof artifact);
    expect(out).toContain('### Keyboard');
    expect(out).not.toMatch(/^# Keyboard$/m);
  });

  it('holds the whole invariant across a full document: the component title is the only single-# line', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      guidelines: {
        origin: 'generated',
        definition: 'A button triggers an action.',
        accessibility: 'Keyboard\n========\n\nEnter activates.',
        interactions: '  # Hover\n\nHover darkens the fill.',
        design_considerations: 'Naming\n------\n\nKeep one filled button per view.',
        content_considerations: '## Content note\n\nUse a verb.',
      },
    } as typeof artifact);
    const singleHashLines = out.split('\n').filter((line) => /^# /.test(line));
    expect(singleHashLines).toEqual(['# Button']);
  });
});

// Task 12: the hostile-input and minimal-artifact sweep. Every prior task
// tested its own section with well-formed data; this attacks the whole
// renderer at once and proves it degrades honestly rather than corrupting
// the document. Only `markdown.ts`'s `escapeHeading` (used solely for the H1
// title) changed as a result -- everything else here is coverage, not a
// defect fix, per the brief's instruction to fix the renderer, never the
// test, and only when the sweep finds a real gap.
describe('componentMarkdown hostile input', () => {
  // One string carrying every character this sweep is required to try: a
  // pipe, a backtick, a raw newline, a literal `<b>` tag, a leading `#`, an
  // asterisk, an underscore-shaped emphasis marker (`*e*` doubles as the
  // underscore case, since `_e_` and `*e*` exercise the same character
  // class in `escapeInline`) and a square bracket.
  const NASTY = '# a|b`c\nd <b> *e* [f]';

  // Built at runtime, not as a regex literal: a backslash-zero escape fails
  // scripts/check-nul-bytes.mjs, and a unicode control escape fails the
  // no-control-regex lint rule, which is only disabled for src/yaml.ts.
  const HOSTILE_BYTES = new RegExp('[' + [9, 0, 8211, 8212].map((code) =>
    String.fromCharCode(code)).join('') + ']');

  /** A GFM table row splitter counts columns on UNESCAPED `|` characters
   * only -- a `\|` never opens a new column, in a plain cell or inside a
   * matched pair of backticks alike (verified against the reference
   * `mdast-util-gfm-table` implementation) -- so counting columns must skip
   * every backslash-escaped character exactly as that splitter does, not
   * just split on a bare `|`. */
  function countColumns(row: string): number {
    let columns = 1;
    for (let i = 0; i < row.length; i += 1) {
      if (row[i] === '\\') { i += 1; continue; }
      if (row[i] === '|') columns += 1;
    }
    return columns;
  }

  /** Every GFM table this renderer can produce is `| cells |` immediately
   * followed by a `|---|` separator of the same column count, and every data
   * row under it holds that same column count -- a row with a different
   * count means an unescaped `|` widened it, or an unescaped raw newline
   * split a cell across two lines. */
  function assertWellFormedTables(markdown: string): void {
    const lines = markdown.split('\n');
    for (let i = 0; i < lines.length - 1; i += 1) {
      const header = lines[i];
      const separator = lines[i + 1];
      if (!/^\|.*\|$/.test(header)) continue;
      if (!/^\|[-:\s|]+\|$/.test(separator) || !separator.includes('---')) continue;
      const columns = countColumns(header);
      expect(countColumns(separator)).toBe(columns);
      let j = i + 2;
      while (j < lines.length && lines[j].startsWith('|')) {
        expect(countColumns(lines[j])).toBe(columns);
        j += 1;
      }
    }
  }

  it('neutralises pipes, backticks, newlines, tags and leading hashes in every slot', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      component: { name: NASTY, description: NASTY, related: [NASTY] },
      anatomy: [{ part: NASTY, path: NASTY, type: 'FRAME' }],
    } as typeof artifact);
    // The hostile name and the hostile DESCRIPTION must not open a section of
    // their own: the only `#` or `##` lines in the body are the renderer's own
    // headings plus the single `# ` title line, whose text is escaped. The
    // description is the one that makes this assertion bite -- it is pushed as
    // its own block, so `escapeInline` alone would leave its leading `#`
    // opening a second H1 here.
    const body = out.slice(out.indexOf('\n---\n') + 5);
    const headings = body.split('\n').filter((l) => /^#{1,2} /.test(l));
    expect(headings.filter((l) => l.startsWith('# '))).toHaveLength(1);
    expect(headings[0]).toBe('# \\# a\\|b`c d \\<b\\> \\*e\\* \\[f\\]');
    expect(out).not.toMatch(HOSTILE_BYTES);
    assertWellFormedTables(out);
    expect(out).not.toContain('[object Object]');
  });

  it('carries the hostile string through Related and an anatomy child bullet unbroken', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      component: { name: 'Button', related: [NASTY] },
      anatomy: [{
        part: 'root', path: 'Root', type: 'FRAME',
        children: [{ part: NASTY, path: NASTY, type: 'TEXT', shown_by: NASTY }],
      }],
    } as typeof artifact);
    // `Related:` is prose, not a heading or a table cell: it goes through
    // `escapeInline` alone, which never touches `#` or `|` (only `escapeHeading`,
    // used solely for the H1 title, does).
    expect(out).toContain('Related: # a|b`c d \\<b\\> \\*e\\* \\[f\\]');
    assertWellFormedTables(out);
    expect(out).not.toMatch(HOSTILE_BYTES);
    expect(out).not.toContain('[object Object]');
    // Still exactly one single-`#` line: the title.
    expect(out.split('\n').filter((l) => /^# /.test(l))).toEqual(['# Button']);
  });

  it('neutralises the hostile string in property names, options and states', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      api: {
        variants: { [NASTY]: { options: [NASTY], default: NASTY } },
        booleans: { [NASTY]: { default: true } },
        slots: { [NASTY]: { type: 'text', default: NASTY } },
        states: [NASTY],
      },
    } as typeof artifact);
    expect(out).toContain('## Properties');
    assertWellFormedTables(out);
    expect(out).not.toMatch(HOSTILE_BYTES);
    expect(out).not.toContain('[object Object]');
  });

  it('neutralises the hostile string in binding paths, properties and layout items', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      references: {
        ...artifact.references,
        used: [{
          source_id: 'VariableID:1', name: NASTY, kind: 'variable' as const,
          remote: false, status: 'resolved' as const,
        }],
        bindings: [{
          path: NASTY, property: NASTY, source_id: 'VariableID:1', kind: 'variable' as const,
          when: { [NASTY]: [NASTY] },
        }],
      },
      layout: { scope: 'default_variant', items: [{ path: NASTY, summary: NASTY }] },
    } as typeof artifact);
    expect(out).toContain('## Token bindings');
    expect(out).toContain('## Layout');
    assertWellFormedTables(out);
    expect(out).not.toMatch(HOSTILE_BYTES);
    expect(out).not.toContain('[object Object]');
  });

  // CodeQL alert 70 on `codeCell`: escaping the cell separator without first
  // accounting for the escape character. It was a real defect. A path holding
  // a backslash directly before a pipe has no encoding inside a code span in
  // a GFM table row, because `\|` is the only escape the row splitter honours
  // there. Wrapping it in backticks and escaping only the pipe destroyed the
  // code span and silently dropped the rest of the cell, so such a value now
  // renders as plain escaped text instead, keeping its own characters.
  it('keeps a backslash-before-pipe path intact by dropping the code span', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const path = 'Container\\|label';
    const out = componentMarkdown({
      ...artifact,
      references: {
        ...artifact.references,
        used: [{
          source_id: 'VariableID:1', name: 'md.sys.color.primary',
          kind: 'variable' as const, remote: false, status: 'resolved' as const,
        }],
        bindings: [{
          path, property: 'fill', source_id: 'VariableID:1', kind: 'variable' as const,
        }],
      },
    } as typeof artifact);
    // The exact characters survive, and the cell is not truncated at the
    // backslash the way the unescaped code span truncated it.
    expect(out).toContain('| Container\\\\\\|label | fill | md.sys.color.primary |');
    expect(out).not.toContain('`Container\\\\|label`');
    assertWellFormedTables(out);
    expect(out).not.toContain('[object Object]');
  });

  it('still wraps a pipe-bearing path with no backslash in a code span', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      layout: { scope: 'default_variant', items: [{ path: 'a|b', summary: 'x' }] },
    } as typeof artifact);
    expect(out).toContain('| `a\\|b` | x |');
    assertWellFormedTables(out);
  });

  it('renders a minimal artifact carrying only required fields', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      component: { name: 'Bare' }, api: undefined, anatomy: [], layout: undefined,
      effects_inline: undefined, unbound: undefined, validation: undefined,
      guidelines: undefined, diagnostics: [],
      references: { used: [], bindings: [], foundation: undefined },
    } as typeof artifact);
    expect(out).toContain('# Bare');
    expect(out).toContain(NOT_READ_SENTENCE);
    for (const heading of ['## Properties', '## Anatomy', '## Layout',
      '## Token bindings', '## Unbound values', '## Issues']) {
      expect(out).not.toContain(heading);
    }
    expect(out).not.toContain('[object Object]');
    expect(out).not.toMatch(HOSTILE_BYTES);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });

  // Carried forward from Task 5's review as an explicit gap: no test proved
  // the guard around `code('')`, which returns a bare `` `` `` pair -- not a
  // valid CommonMark code span. `anatomyBullets` only calls `code(path)`
  // behind `if (path)`, and only calls `code(shownBy)` behind `if (shownBy)`,
  // and `str()` turns an absent field into `undefined` rather than `''`, so
  // neither guard should ever see an empty string reach `code()`. These two
  // tests drive exactly that through the public `componentMarkdown` entry
  // point rather than calling `code('')` directly, so a regression in either
  // guard -- not just in `code` itself -- would be caught.
  it('never emits a bare double-backtick for an anatomy node with no path', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      anatomy: [{ part: 'root', type: 'FRAME' }],
    } as typeof artifact);
    expect(out).toContain('- root: frame');
    expect(out).not.toContain('``');
    expect(out).not.toContain('[object Object]');
  });

  it('never emits a bare double-backtick for an anatomy node with no shown_by', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      anatomy: [{ part: 'root', path: 'Root', type: 'FRAME' }],
    } as typeof artifact);
    expect(out).toContain('- root: `Root`, frame');
    expect(out).not.toContain('``');
    expect(out).not.toContain('[object Object]');
  });

  it('holds every byte-hygiene invariant across a fully hostile document', () => {
    const artifact = buildComponentV5GoldenArtifact();
    const out = componentMarkdown({
      ...artifact,
      component: { name: NASTY, related: [NASTY] },
      anatomy: [{ part: NASTY, path: NASTY, type: 'FRAME', shown_by: NASTY }],
      api: {
        variants: { [NASTY]: { options: [NASTY], default: NASTY } },
        states: [NASTY],
      },
      layout: { scope: 'default_variant', items: [{ path: NASTY, summary: NASTY }] },
      unbound: [{ path: NASTY, property: NASTY, issue: NASTY, value: NASTY }],
      validation: [{ id: 'orphan-part', severity: 'error', path: NASTY, property: NASTY, message: NASTY }],
    } as typeof artifact);
    expect(out).not.toMatch(HOSTILE_BYTES);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
    assertWellFormedTables(out);
    expect(out).not.toContain('[object Object]');
  });
});
