import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildPillNode, repaintPills } from '../src/pillNode';
import { PILL_KEY, PILL_NODE_NAME } from '../src/publishPill';
import { buildBrandHeader } from '../src/brandHeader';
import { collectGeneratedText, type ProseNodeLike } from '../src/canvasProse';
import { palette, applyThemeToKit } from '../src/frameKit';
import { installFakeFigma, uninstallFakeFigma, FakeFrame, FakeText } from './fakeFigma';

const theme = {
  headerBg: '#123456', accent: '#00ffcc', bodyText: '#222222',
  tableHeadBg: '#fafafa', cornerStyle: 'soft' as const,
  headingFont: 'Inter', bodyFont: 'Inter',
};

/** Walk a fake tree the way SectionNode.findAll would. */
function findAll(root: FakeFrame, predicate: (node: SceneNode) => boolean): SceneNode[] {
  const out: SceneNode[] = [];
  const visit = (node: unknown): void => {
    if (predicate(node as SceneNode)) out.push(node as SceneNode);
    for (const child of ((node as FakeFrame).children ?? []) as unknown[]) visit(child);
  };
  for (const child of root.children as unknown[]) visit(child);
  return out;
}

const textOf = (pill: FakeFrame): FakeText => pill.children.find((c) => c.type === 'TEXT') as FakeText;

describe('buildPillNode', () => {
  beforeEach(installFakeFigma);
  afterEach(uninstallFakeFigma);

  it('names the node, tags it and its text with the pill key, and writes the label', async () => {
    await applyThemeToKit(theme);
    const pill = buildPillNode({ kind: 'published', version: '1.5.0' }) as unknown as FakeFrame;
    expect(pill.name).toBe(PILL_NODE_NAME);
    expect(pill.getPluginData(PILL_KEY)).toBe('1');
    expect(textOf(pill).getPluginData(PILL_KEY)).toBe('1');
    expect(textOf(pill).characters).toBe('v1.5.0 · Published');
  });

  it('published is an accent tint with header ink; changed a muted tint; unpublished a dashed muted outline', async () => {
    await applyThemeToKit(theme);
    const published = buildPillNode({ kind: 'published', version: '1.0.0' }) as unknown as FakeFrame;
    expect(published.fills).toEqual([{ type: 'SOLID', color: palette.accent, opacity: 0.22 }]);
    expect(published.strokes).toEqual([{ type: 'SOLID', color: palette.accent }]);
    expect(textOf(published).fills).toEqual([{ type: 'SOLID', color: palette.onHeader }]);

    const changed = buildPillNode({ kind: 'changed', version: '1.0.0' }) as unknown as FakeFrame;
    expect(changed.fills).toEqual([{ type: 'SOLID', color: palette.onHeaderMuted, opacity: 0.18 }]);
    expect(changed.strokes).toEqual([]);

    const unpublished = buildPillNode({ kind: 'unpublished' }) as unknown as FakeFrame;
    expect(unpublished.fills).toEqual([]);
    expect(unpublished.strokes).toEqual([{ type: 'SOLID', color: palette.onHeaderMuted }]);
    expect(unpublished.dashPattern).toEqual([3, 2]);
    expect(textOf(unpublished).fills).toEqual([{ type: 'SOLID', color: palette.onHeaderMuted }]);
  });

  it('is a full-radius hugging row 24 high', async () => {
    await applyThemeToKit(theme);
    const pill = buildPillNode({ kind: 'unpublished' }) as unknown as FakeFrame;
    expect(pill.layoutMode).toBe('HORIZONTAL');
    expect(pill.cornerRadius).toBe(999);
    expect(pill.paddingLeft).toBe(10);
    expect(pill.paddingRight).toBe(10);
    expect(pill.height).toBe(24);
  });
});

describe('buildBrandHeader with a pill', () => {
  beforeEach(installFakeFigma);
  afterEach(uninstallFakeFigma);

  it('puts the pill on the eyebrow row, after the eyebrow and before the logo', async () => {
    await applyThemeToKit(theme);
    const band = await buildBrandHeader({
      eyebrow: 'Buttons', title: 'Button', logoBase64: 'AAAA', pill: { kind: 'published', version: '1.0.0' },
    }) as unknown as FakeFrame;
    const row = band.children[0] as FakeFrame;
    expect(row.layoutMode).toBe('HORIZONTAL');
    expect(row.children.map((c) => c.type)).toEqual(['TEXT', 'FRAME', 'RECTANGLE']);
    expect((row.children[1] as FakeFrame).name).toBe(PILL_NODE_NAME);
  });

  it('builds the row even without a logo, so the pill can sit right-aligned', async () => {
    await applyThemeToKit(theme);
    const band = await buildBrandHeader({ eyebrow: 'Buttons', title: 'Button', pill: { kind: 'unpublished' } }) as unknown as FakeFrame;
    const row = band.children[0] as FakeFrame;
    expect(row.children.map((c) => c.type)).toEqual(['TEXT', 'FRAME']);
  });

  it('renders exactly as before when no pill is passed', async () => {
    await applyThemeToKit(theme);
    const band = await buildBrandHeader({ eyebrow: 'Buttons', title: 'Button' }) as unknown as FakeFrame;
    expect(band.children[0].type).toBe('TEXT');
    expect(band.findAllNamed(PILL_NODE_NAME)).toEqual([]);
  });
});

describe('the pill and the hand-edit hash', () => {
  beforeEach(installFakeFigma);
  afterEach(uninstallFakeFigma);

  it('collectGeneratedText never sees the pill text, so stamping cannot read as a hand edit', async () => {
    await applyThemeToKit(theme);
    const band = await buildBrandHeader({ eyebrow: 'Buttons', title: 'Button', pill: { kind: 'unpublished' } }) as unknown as FakeFrame;
    const before = collectGeneratedText(band as unknown as ProseNodeLike);
    expect(before).toEqual(['BUTTONS', 'Button']);
    const repainted = await repaintPills({ findAll: (p) => findAll(band, p) }, { kind: 'published', version: '2.0.0' });
    expect(repainted).toBe(1);
    expect(band.textChars()).toContain('v2.0.0 · Published');
    expect(collectGeneratedText(band as unknown as ProseNodeLike)).toEqual(before);
  });

  it('repaintPills restyles every pill in place and returns the count', async () => {
    await applyThemeToKit(theme);
    const root = new FakeFrame();
    root.appendChild(await buildBrandHeader({ eyebrow: 'A', title: 'A', pill: { kind: 'unpublished' } }));
    root.appendChild(await buildBrandHeader({ eyebrow: 'B', title: 'B', pill: { kind: 'unpublished' } }));
    const count = await repaintPills({ findAll: (p) => findAll(root, p) }, { kind: 'changed', version: '1.1.0' });
    expect(count).toBe(2);
    for (const pill of root.findAllNamed(PILL_NODE_NAME)) {
      expect(textOf(pill).characters).toBe('v1.1.0 · Changed since');
      expect(pill.fills).toEqual([{ type: 'SOLID', color: palette.onHeaderMuted, opacity: 0.18 }]);
    }
  });

  it('repaintPills returns 0 on a doc rendered before pills existed', async () => {
    await applyThemeToKit(theme);
    const band = await buildBrandHeader({ eyebrow: 'A', title: 'A' });
    expect(await repaintPills({ findAll: (p) => findAll(band as unknown as FakeFrame, p) }, { kind: 'unpublished' })).toBe(0);
  });
});
