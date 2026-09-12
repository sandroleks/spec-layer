import { describe, it, expect } from 'vitest';
import { dtcgExportFiles, foundationDtcg, usageUnits, type LibraryBundleV1, type SerializedFoundation } from '@spec-layer/extractor';
import { renderSnapshotSkill, buildSkillFiles, skillZipFilename, type SnapshotInventory } from '../src/ui/skillZip';
import { buildPublishBundle, type PublishBundleV1, type PublishSources } from '../src/ui/publish';
import type { PublishComponentSource } from '../src/messages';

const FULL: SnapshotInventory = {
  fileName: 'Acme DS',
  pluginVersion: '5.1.0',
  generatedAt: '2026-09-11T10:00:00.000Z',
  components: [
    { name: 'Button', path: 'components/button.yaml' },
    { name: 'Card', path: 'components/card.yaml' },
  ],
  tokens: { files: ['tokens/resolver.json', 'tokens/semantic.light.json'] },
  fonts: [{ family: 'Inter', weights: [400, 700], used_by: ['Body'] }],
};

describe('renderSnapshotSkill', () => {
  it('opens with frontmatter naming the skill', () => {
    const md = renderSnapshotSkill(FULL);
    expect(md.startsWith('---\nname: spec-layer\n')).toBe(true);
    expect(md).toContain('description:');
  });

  it('names the source file, the plugin version, and when it was generated', () => {
    const md = renderSnapshotSkill(FULL);
    expect(md).toContain('Acme DS');
    expect(md).toContain('5.1.0');
    expect(md).toContain('2026-09-11');
  });

  it('lists every component with its path', () => {
    const md = renderSnapshotSkill(FULL);
    expect(md).toContain('components/button.yaml');
    expect(md).toContain('components/card.yaml');
  });

  it('says it is a snapshot and names what supersedes it', () => {
    const md = renderSnapshotSkill(FULL);
    expect(md).toContain('does not update');
    expect(md).toContain('spec-layer');
  });

  it('says what it cannot see, so it is not read as the CLI guide', () => {
    expect(renderSnapshotSkill(FULL)).toContain('cannot see');
  });

  it('uses no em dash anywhere', () => {
    expect(renderSnapshotSkill(FULL)).not.toContain('—');
  });

  it('describes no tokens when the foundation was not read', () => {
    const md = renderSnapshotSkill({ ...FULL, tokens: null, fonts: [] });
    expect(md).not.toContain('tokens/resolver.json');
    expect(md).toContain('foundation was not read');
  });

  it('describes no components when there are none', () => {
    const md = renderSnapshotSkill({ ...FULL, components: [] });
    expect(md).not.toContain('components/');
    expect(md).toContain('No component documentation');
  });

  it('names no file when fileName is null', () => {
    const md = renderSnapshotSkill({ ...FULL, fileName: null });
    expect(md).toContain(
      'This folder holds a design system extracted from a Figma file on 2026-09-11 by plugin version 5.1.0. ',
    );
    expect(md).not.toContain('Acme DS');
    expect(md).not.toContain('—');
  });

  it('omits the plugin version clause when pluginVersion is null, with no doubled space', () => {
    const md = renderSnapshotSkill({ ...FULL, pluginVersion: null });
    expect(md).toContain(
      'This folder holds a design system extracted from the Figma file "Acme DS" on 2026-09-11. ',
    );
    expect(md).not.toContain('plugin version');
    expect(md).not.toContain('  ');
    expect(md).not.toContain('—');
  });

  it('renders a coherent document for the most degenerate snapshot', () => {
    const md = renderSnapshotSkill({
      ...FULL,
      fileName: null,
      pluginVersion: null,
      components: [],
      tokens: null,
      fonts: [],
    });
    expect(md).toContain(
      'This folder holds a design system extracted from a Figma file on 2026-09-11. ',
    );
    expect(md).not.toContain('Acme DS');
    expect(md).not.toContain('plugin version');
    expect(md).toContain('No component documentation was included in this download.');
    expect(md).toContain('foundation was not read');
    expect(md).not.toContain('components/');
    expect(md).not.toContain('tokens/resolver.json');
    expect(md).not.toContain('  ');
    expect(md).not.toContain('—');
  });
});

/** A bundle with no foundation: the components half alone, which is the shape
 *  a file with no Foundation read produces. */
const COMPONENTS_ONLY = {
  schema: 'spec-layer-library-bundle',
  version: '1.0.0',
  fileName: 'Acme DS',
  pluginVersion: '5.1.0',
  extractorVersion: '2',
  foundation: null,
  components: [
    { name: 'Button', ai: 'name: Button\n', artifact: {} },
    { name: 'button', ai: 'name: button\n', artifact: {} },
  ],
} as unknown as PublishBundleV1;

describe('buildSkillFiles', () => {
  it('roots everything at spec-layer/ so it unzips into .claude/skills/', () => {
    const files = buildSkillFiles(COMPONENTS_ONLY, '2026-09-11T10:00:00.000Z');
    for (const path of Object.keys(files)) expect(path.startsWith('spec-layer/')).toBe(true);
  });

  it('writes one brief per component, deduping names the way pull does', () => {
    const files = buildSkillFiles(COMPONENTS_ONLY, '2026-09-11T10:00:00.000Z');
    expect(files['spec-layer/components/button.yaml']).toBe('name: Button\n');
    expect(files['spec-layer/components/button-2.yaml']).toBe('name: button\n');
  });

  it('omits tokens and fonts entirely when there is no foundation', () => {
    const files = buildSkillFiles(COMPONENTS_ONLY, '2026-09-11T10:00:00.000Z');
    const paths = Object.keys(files);
    expect(paths.some((p) => p.startsWith('spec-layer/tokens/'))).toBe(false);
    expect(paths).not.toContain('spec-layer/fonts.json');
  });

  it('always writes a SKILL.md that names every other file it carries', () => {
    const files = buildSkillFiles(COMPONENTS_ONLY, '2026-09-11T10:00:00.000Z');
    const md = files['spec-layer/SKILL.md'];
    expect(md).toBeDefined();
    for (const path of Object.keys(files)) {
      if (path === 'spec-layer/SKILL.md') continue;
      expect(md).toContain(path.replace('spec-layer/', ''));
    }
  });
});

describe('skillZipFilename', () => {
  it('names the zip after the Figma file', () => {
    expect(skillZipFilename('Acme DS')).toBe('spec-layer-acme-ds-skill.zip');
  });

  it('falls back when the name slugs to nothing', () => {
    expect(skillZipFilename('///')).toBe('spec-layer-skill.zip');
    expect(skillZipFilename(null)).toBe('spec-layer-skill.zip');
  });
});

// ---------------------------------------------------------------------------
// buildSkillFiles with a real foundation — exercises the actual
// foundationDtcg + usageUnits + dtcgExportFiles pipeline (the same one
// packages/cli/src/files.ts calls during `spec-layer pull`), rather than a
// hand-typed FoundationArtifactV5 fixture. Building the bundle through
// buildPublishBundle keeps this test honest about what a real publish
// produces, and lets us assert the tokens/ output is byte-identical to
// calling the CLI's own pipeline functions directly on the same artifact.
// ---------------------------------------------------------------------------
describe('buildSkillFiles with a foundation', () => {
  /** Same minimal COMPONENT node shape publish.test.ts uses. */
  function componentNode(id: string, name: string, key: string) {
    return {
      id, name, type: 'COMPONENT', visible: true, key,
      children: [], bindings: [],
    } as never;
  }

  function componentSource(
    docId: string, name: string, id: string, key: string,
  ): PublishComponentSource {
    return { docId, name, node: componentNode(id, name, key), prose: null };
  }

  /** Same SerializedFoundation fixture as publish.test.ts's FOUNDATION: no
   *  typography styles, so fontRequirements comes back empty. */
  const FOUNDATION_NO_FONTS: SerializedFoundation = {
    fileKey: 'F1',
    fileName: 'Company DS',
    extractedAt: '2026-08-14T00:00:00.000Z',
    externals: [],
    textStyles: [],
    effectStyles: [],
    collections: [{
      id: 'C1', name: 'Color', defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Light' }],
      variables: [
        {
          id: 'V1', name: 'color/bg/brand', resolvedType: 'COLOR', description: '',
          codeSyntax: {}, scopes: ['FRAME_FILL'],
          valuesByMode: { m1: { r: 0.1401, g: 0.3901, b: 0.9201, a: 0.125 } },
        },
        {
          id: 'V:gap', name: 'space/gap', resolvedType: 'FLOAT', description: '',
          codeSyntax: {}, scopes: ['GAP'], valuesByMode: { m1: 8 },
        },
      ],
    }],
  };

  /** Same collections, plus one unbound literal typography style, so
   *  fontRequirements resolves a real family/weight pair. */
  const FOUNDATION_WITH_FONTS: SerializedFoundation = {
    ...FOUNDATION_NO_FONTS,
    textStyles: [{
      id: 'S:heading-lg',
      name: 'heading/lg', description: '', fontFamily: 'Inter', fontStyle: 'Regular',
      fontSize: 32, lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 }, paragraphSpacing: 0,
      paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE',
      boundVariables: {},
      source: { remote: false, publishStatus: 'CURRENT' },
    }],
  };

  const GENERATED_AT = '2026-09-11T10:00:00.000Z';

  function sourcesWithFoundation(foundation: SerializedFoundation): PublishSources {
    return {
      foundation,
      groupDescriptions: {},
      components: [
        componentSource('doc1', 'Button', 'N1', 'K1'),
        componentSource('doc2', 'button', 'N2', 'K2'),
      ],
      fileKey: 'F1',
      fileName: 'Acme DS',
    };
  }

  it('writes tokens/ files and omits fonts.json when there are no typography styles', () => {
    const bundle = buildPublishBundle(sourcesWithFoundation(FOUNDATION_NO_FONTS), GENERATED_AT);
    const files = buildSkillFiles(bundle, GENERATED_AT);
    const paths = Object.keys(files);
    expect(paths.some((p) => p.startsWith('spec-layer/tokens/'))).toBe(true);
    expect(paths).not.toContain('spec-layer/fonts.json');

    const md = files['spec-layer/SKILL.md'];
    for (const path of paths) {
      if (path === 'spec-layer/SKILL.md') continue;
      expect(md).toContain(path.replace('spec-layer/', ''));
    }
  });

  it('writes fonts.json, whose content is echoed in the SKILL.md Fonts section, only when a style resolves a family', () => {
    const bundle = buildPublishBundle(sourcesWithFoundation(FOUNDATION_WITH_FONTS), GENERATED_AT);
    const files = buildSkillFiles(bundle, GENERATED_AT);
    expect(files['spec-layer/fonts.json']).toBeDefined();
    const fonts = JSON.parse(files['spec-layer/fonts.json']) as Array<{ family: string; weights: number[] }>;
    expect(fonts.some((f) => f.family === 'Inter')).toBe(true);
    // renderSnapshotSkill's Fonts section inlines the family/weight data
    // directly rather than citing the fonts.json path (unlike Components and
    // Token files, which do list paths), so the honest check here is that the
    // same family the file carries also appears in the guide's prose.
    expect(files['spec-layer/SKILL.md']).toContain('Inter');
  });

  it('produces tokens/ files byte-identical to calling the CLI pull pipeline directly', () => {
    const bundle = buildPublishBundle(sourcesWithFoundation(FOUNDATION_NO_FONTS), GENERATED_AT);
    const files = buildSkillFiles(bundle, GENERATED_AT);
    const artifact = bundle.foundation!.artifact;
    // Mirrors packages/cli/src/files.ts's own call, verbatim: foundationDtcg
    // with the usageUnits third argument, then dtcgExportFiles on the result.
    const expected = dtcgExportFiles(
      foundationDtcg(artifact, {}, usageUnits(bundle as unknown as LibraryBundleV1)),
    );
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    for (const [name, text] of Object.entries(expected)) {
      expect(files[`spec-layer/tokens/${name}`]).toBe(text);
    }
  });
});
