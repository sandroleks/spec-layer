import { describe, it, expect } from 'vitest';
import { specContentHash, extract } from '../src/index';
import type { SerializedNode } from '../src/index';

// Minimal serialized COMPONENT: a frame with one text child, no variables.
const NODE: SerializedNode = {
  id: '1:1', name: 'Button', type: 'COMPONENT',
  children: [{ id: '1:2', name: 'Label', type: 'TEXT', characters: 'Click' }],
} as unknown as SerializedNode;

describe('specContentHash', () => {
  it('is stable and ignores rawValues + deep anatomy', () => {
    const spec = extract(NODE, { figmaFile: 'FILEKEY' });
    const h1 = specContentHash(spec);

    // rawValues is presentation-only → must not affect the hash.
    const withRaw = { ...spec, rawValues: [{ part: 'Label', property: 'color', value: '#fff' }] };
    expect(specContentHash(withRaw as typeof spec)).toBe(h1);

    // A deep (depth>0) anatomy part is canvas-only → must not affect the hash.
    const withDeep = {
      ...spec,
      anatomy: [...spec.anatomy, { id: '1:3', name: 'Icon', type: 'FRAME', nested: false, depth: 1 }],
    };
    expect(specContentHash(withDeep as typeof spec)).toBe(h1);

    // It is a 64-char hex SHA-256.
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores contrast findings, which depend on the foundation not the component', () => {
    const spec = extract(NODE, { figmaFile: 'FILEKEY' });
    const withFindings = {
      ...spec,
      contrast: {
        evaluated: 1,
        skipped: 2,
        findings: [{
          part: 'Label', variant: 'Style=Filled', foreground: '#bbbbbb', background: '#ffffff',
          backgroundPart: 'Container', ratio: 1.9, required: 4.5 as const,
        }],
      },
    };
    expect(specContentHash(withFindings as typeof spec)).toBe(specContentHash(spec));
  });
});
