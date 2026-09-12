import { describe, it, expect } from 'vitest';
import { renderSnapshotSkill, type SnapshotInventory } from '../src/ui/skillZip';

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
});
