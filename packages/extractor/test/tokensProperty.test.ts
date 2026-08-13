import { describe, it, expect } from 'vitest';
import { extractTokens, variantAxisModel } from '../src/tokens';
import { resolveTokensForVariant } from '../src/resolve';
import type { SerializedNode } from '../src/tree';

/** Deterministic PRNG so a failure is always reproducible from its trial index. */
function prng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

const AXIS_SHAPES: Record<string, string[]>[] = [
  { Style: ['Filled', 'Outline'], State: ['Default', 'Hover', 'Disabled'] },
  { Size: ['S', 'M', 'L'], Type: ['A', 'B'], On: ['true', 'false'] },
  { A: ['1', '2'], B: ['x', 'y'], C: ['p', 'q'], D: ['m', 'n'] },
  { Only: ['a', 'b', 'c', 'd'] },
];

/** A component set with a random subset of combos, each carrying a random
 *  subset of parts, each bound to a random token. `sparsity` drops whole
 *  variants; `absence` drops individual parts within a variant. */
function makeSet(
  rnd: () => number,
  axes: Record<string, string[]>,
  opts: { sparsity: number; absence: number },
): SerializedNode {
  const TOKENS = ['tok/a', 'tok/b', 'tok/c'];
  const PARTS = ['Label', 'Icon'];
  const names = Object.keys(axes);
  let combos: Record<string, string>[] = [{}];
  for (const a of names) {
    const next: Record<string, string>[] = [];
    for (const c of combos) for (const v of axes[a]) next.push({ ...c, [a]: v });
    combos = next;
  }
  // Always keep the first combo so the set is never empty.
  const kept = combos.filter((_, i) => i === 0 || rnd() > opts.sparsity);
  let uid = 0;
  return {
    id: 'root', name: 'Comp', type: 'COMPONENT_SET', visible: true, key: 'k',
    propertyDefinitions: Object.fromEntries(
      names.map((a) => [a, { type: 'VARIANT' as const, variantOptions: axes[a] }]),
    ),
    children: kept.map((combo) => ({
      id: `v${uid++}`,
      name: names.map((a) => `${a}=${combo[a]}`).join(', '),
      type: 'COMPONENT', visible: true,
      bindings: [{ property: 'fills', token: TOKENS[Math.floor(rnd() * TOKENS.length)] }],
      children: PARTS.filter(() => rnd() >= opts.absence).map((p) => ({
        id: `n${uid++}`, name: p, type: 'FRAME', visible: true,
        bindings: [{ property: 'fills', token: TOKENS[Math.floor(rnd() * TOKENS.length)] }],
      })),
    })),
  };
}

/** What this variant node ACTUALLY carries, independent of the minimizer. */
function groundTruth(variant: SerializedNode): Set<string> {
  const out = new Set<string>([`Container|fill|${variant.bindings![0].token}`]);
  for (const c of variant.children ?? []) out.add(`${c.name}|fill|${c.bindings![0].token}`);
  return out;
}

describe('extractTokens round-trip invariant', () => {
  it('resolves every variant back to exactly the bindings it carries', () => {
    const failures: string[] = [];
    for (let trial = 0; trial < 400; trial++) {
      const rnd = prng(trial + 1);
      const set = makeSet(rnd, AXIS_SHAPES[trial % AXIS_SHAPES.length], {
        sparsity: [0, 0.3, 0.6][trial % 3],
        absence: [0, 0.25, 0.5][Math.floor(trial / 3) % 3],
      });
      const rules = extractTokens(set);
      const { variants, combos } = variantAxisModel(set);
      variants.forEach((v, i) => {
        const expected = groundTruth(v);
        const actual = new Set(
          resolveTokensForVariant(rules, combos[i]).map((r) => `${r.part}|${r.property}|${r.token}`),
        );
        const fabricated = [...actual].filter((x) => !expected.has(x));
        const lost = [...expected].filter((x) => !actual.has(x));
        if (fabricated.length || lost.length) {
          failures.push(
            `trial ${trial} "${v.name}": FABRICATED=${JSON.stringify(fabricated)} LOST=${JSON.stringify(lost)}`,
          );
        }
      });
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('does not claim a part in a variant that lacks it (minimal case)', () => {
    // L-shaped presence: Label is absent only at (X=1, Y=p). Marginally, X still
    // spans {1,2} and Y still spans {p,q} across the two cells that exist.
    const leaf = (id: string) => ({
      id, name: 'Label', type: 'FRAME', visible: true,
      bindings: [{ property: 'fills', token: 'tok/a' }],
    });
    const set: SerializedNode = {
      id: 'root', name: 'C', type: 'COMPONENT_SET', visible: true, key: 'k',
      propertyDefinitions: {
        X: { type: 'VARIANT', variantOptions: ['1', '2'] },
        Y: { type: 'VARIANT', variantOptions: ['p', 'q'] },
      },
      children: [
        { id: 'v0', name: 'X=1, Y=p', type: 'COMPONENT', visible: true, children: [] },
        { id: 'v1', name: 'X=1, Y=q', type: 'COMPONENT', visible: true, children: [leaf('n1')] },
        { id: 'v2', name: 'X=2, Y=p', type: 'COMPONENT', visible: true, children: [leaf('n2')] },
      ],
    };
    const rules = extractTokens(set);
    const resolved = resolveTokensForVariant(rules, { X: '1', Y: 'p' });
    expect(resolved).toEqual([]);
  });
});
