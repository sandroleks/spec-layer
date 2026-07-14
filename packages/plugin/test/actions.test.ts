import { describe, expect, it } from 'vitest';
import { specMarkdownFilename, proseNeedsRegen, canGenerate, createState, type UiState } from '../src/ui/actions';
import type { IntermediateSpec, ProseKey } from '@spec-layer/extractor';

describe('proseNeedsRegen', () => {
  const withDraft = (keys: ProseKey[]): UiState => ({
    generatedProse: { definition: 'd', accessibility: '', dos: [], donts: [] },
    generatedProseKeys: new Set(keys),
  } as unknown as UiState);

  it('regenerates when the cached draft misses a requested key', () => {
    expect(proseNeedsRegen(withDraft(['definition']), new Set(['definition', 'interactions']))).toBe(true);
  });
  it('reuses when the cached draft covers the request', () => {
    expect(proseNeedsRegen(withDraft(['definition', 'interactions']), new Set(['interactions']))).toBe(false);
  });
  it('regenerates when there is no draft yet', () => {
    expect(proseNeedsRegen({ generatedProse: null, generatedProseKeys: null } as unknown as UiState, new Set(['definition']))).toBe(true);
  });
});

function specStub(name = 'Button'): IntermediateSpec {
  return {
    name,
    figmaKey: 'component-key',
    figmaFile: 'file-key',
    figmaNode: '12:34',
    anatomy: [], anatomyComponentId: '',
    props: [],
    variants: [],
    variantInstances: [
      { nodeId: '12:35', name: 'Primary', values: { Type: 'Primary' } },
    ],
    states: [],
    tokens: [],
    related: [],
    gaps: [],
    layout: [],
    rawValues: [],
  };
}

describe('canGenerate', () => {
  it('false when AI is off', () => {
    const s = createState();
    s.aiEnabled = false; s.figmaUserId = 'u1';
    expect(canGenerate(s)).toBe(false);
  });
  it('true for a free user with only a figma id (no key of any kind)', () => {
    const s = createState();
    s.aiEnabled = true; s.figmaUserId = 'u1'; s.licenseKey = null;
    expect(canGenerate(s)).toBe(true);
  });
  it('true with a license key and no figma id', () => {
    const s = createState();
    s.aiEnabled = true; s.licenseKey = 'LK'; s.figmaUserId = null;
    expect(canGenerate(s)).toBe(true);
  });
  it('false with AI on but no identity at all', () => {
    const s = createState();
    s.aiEnabled = true; s.licenseKey = null; s.figmaUserId = null;
    expect(canGenerate(s)).toBe(false);
  });
});

describe('specMarkdownFilename', () => {
  it('kebab-cases the spec name and appends .spec.md', () => {
    expect(specMarkdownFilename(specStub('Text Field'))).toBe('text-field.spec.md');
  });

  it('handles figma hierarchy names with slashes', () => {
    expect(specMarkdownFilename(specStub('Icon/Arrow Up'))).toBe('icon-arrow-up.spec.md');
  });

  it('strips trailing hyphen from slash-only names', () => {
    expect(specMarkdownFilename(specStub('Icon/'))).toBe('icon.spec.md');
  });

  it('falls back to "component" when the name reduces to only hyphens', () => {
    expect(specMarkdownFilename(specStub('---'))).toBe('component.spec.md');
  });

  it('uses the fallback name when the spec name is empty', () => {
    expect(specMarkdownFilename(specStub(''), 'My Node')).toBe('my-node.spec.md');
  });
});
