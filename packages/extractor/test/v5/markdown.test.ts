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
