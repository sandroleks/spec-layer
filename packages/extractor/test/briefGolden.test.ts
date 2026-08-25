/**
 * Two regression guards on the component brief, plus one boundary scan.
 *
 * The field-by-field tests live in brief.test.ts. What they cannot catch is a
 * whole document reading badly: a wrong block order, a duplicated section, a
 * key that should have been omitted. All of those compile and pass every field
 * test, and all of them are obvious to a human reading the payload once. So one
 * reviewed payload is frozen here as a golden file and diffed from then on.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { componentBrief, extract } from '../src/index';
import type { SerializedNode } from '../src/tree';
import button from './fixtures/button.json';
import chip from './fixtures/chip.json';
import { GOLDEN_PATH, renderButtonBrief } from './fixtures/buttonBrief';

const root = button as SerializedNode;
const AT = '2026-08-18T00:00:00.000Z';

describe('component brief size', () => {
  // The repo's button.json has 3 variants and a handful of token rules, so it
  // renders in about a hundred lines whether bindings are condition-based or
  // expanded per variant. An absolute line threshold on a fixture this small
  // would pass forever and guard nothing. The property that actually matters is
  // that output tracks distinct RULES rather than the variant matrix, and that
  // holds at any fixture size.
  it('emits one binding per distinct rule, never one per variant', () => {
    const spec = extract(root, { figmaFile: 'FILE1' });
    const brief = componentBrief(spec, { generatedAt: AT }) as unknown as {
      tokens: { bindings: unknown[] };
    };
    expect(brief.tokens.bindings.length).toBeLessThanOrEqual(spec.tokens.length);
    // v1's shape was one entry per variant, each repeating every binding. If
    // anyone reintroduces that, this fails even on a 3-variant fixture.
    expect(brief.tokens.bindings.length)
      .toBeLessThan(spec.variantInstances.length * spec.tokens.length);
  });

  it('lists each token once however many bindings reference it', () => {
    const spec = extract(root, { figmaFile: 'FILE1' });
    const brief = componentBrief(spec, { generatedAt: AT }) as unknown as {
      tokens: { bindings: { token: string }[]; used: Array<{ token: string }> };
    };
    const referenced = new Set(brief.tokens.bindings.map((b) => b.token));
    // `used` is a list now, not a map keyed by name -- see brief.ts's tokensOf.
    expect(brief.tokens.used.map((u) => u.token).sort()).toEqual([...referenced].sort());
  });

  it('has no base or by_variant block', () => {
    const brief = componentBrief(extract(root, { figmaFile: 'FILE1' }),
      { generatedAt: AT }) as unknown as { tokens: object };
    expect('base' in brief.tokens).toBe(false);
    expect('by_variant' in brief.tokens).toBe(false);
  });
});

describe('component brief golden file', () => {
  it('matches the reviewed payload byte for byte', () => {
    // This test only ever ASSERTS. The fixture is written by
    // fixtures/buttonBrief.ts, run deliberately by a human, never by a test
    // run: a test that writes its own expectation cannot fail the first time
    // it runs, which is exactly when it should.
    //
    // The inputs and the rendering come from that same module, so the fixture
    // and this assertion cannot drift apart.
    expect(existsSync(GOLDEN_PATH)).toBe(true);
    expect(renderButtonBrief()).toBe(readFileSync(GOLDEN_PATH, 'utf8'));
  });
});

describe('generated-content boundary', () => {
  it('confines generated prose to the guidelines block', () => {
    const brief = componentBrief(extract(root, { figmaFile: 'FILE1' }), {
      generatedAt: AT,
      prose: {
        definition: 'GENERATED_MARKER_A', accessibility: '', interactions: '',
        variantsSummary: '', anatomySummary: '', designConsiderations: '',
        contentConsiderations: '', dos: ['GENERATED_MARKER_B'], donts: [],
      },
    }) as Record<string, unknown>;
    // The boundary is structural, not a per-field annotation: generation is
    // confined to prose, so one marked block is the whole boundary. This
    // asserts it stays that way.
    for (const [key, value] of Object.entries(brief)) {
      if (key === 'guidelines') continue;
      expect(JSON.stringify(value)).not.toContain('GENERATED_MARKER');
    }
    expect(JSON.stringify(brief.guidelines)).toContain('GENERATED_MARKER_A');
    expect(JSON.stringify(brief.guidelines)).toContain('GENERATED_MARKER_B');
  });
});

describe('phase A output stability', () => {
  // Frozen here rather than in a golden file because the point is not the whole
  // document (button-brief.yaml already covers that) but that these exact token
  // names still reach these exact keys after `TokenRef.token` becomes
  // `TokenRef.name` and minimization starts keying on (kind, id).
  it('emits the same token names and binding rows for chip.json', () => {
    const brief = componentBrief(extract(chip as SerializedNode, { figmaFile: 'FILE1' }),
      { generatedAt: AT }) as unknown as {
        tokens: {
          used: Array<{ token: string }>;
          bindings: Array<{ path: string; property: string; token: string }>;
        };
      };
    // `used` is a list now, not a map keyed by name -- see brief.ts's tokensOf.
    const used = brief.tokens.used.map((u) => u.token);
    expect(used.sort()).toEqual(['Text Color/Body/Primary', 'font-size/fs-100']);
    // The literal rows, frozen. chip.json binds one text colour on three nodes
    // and one font size on one, and every one of those has to survive the
    // rename and the ref-keyed minimization landing on the same path and
    // property it does today. `icon` and `icon (2)` are sibling-disambiguated
    // names, which is exactly the pair a name-keyed grouping used to merge.
    expect(brief.tokens.bindings.map((b) => `${b.path} ${b.property} ${b.token}`).sort())
      .toEqual([
        'Container/Contents/Label fill Text Color/Body/Primary',
        'Container/Contents/Label font-size font-size/fs-100',
        'Container/Contents/icon (2) fill Text Color/Body/Primary',
        'Container/Contents/icon fill Text Color/Body/Primary',
      ]);
  });
});
