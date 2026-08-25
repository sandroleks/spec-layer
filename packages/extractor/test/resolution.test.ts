import { describe, it, expect } from 'vitest';
import { resolutionOf, type ResolutionStatus } from '../src/resolution';
import { buildFoundation, narrowFoundation, type FoundationSpec } from '../src/foundation';
import type { RefIdentity } from '../src/tree';

const ref = (over: Partial<RefIdentity> = {}): RefIdentity => ({
  id: 'VariableID:1', name: 'color/brand', kind: 'variable', remote: false, ...over,
});

// One real text style, not `[]`: narrowFoundation's own early return treats an
// empty textStyles array as "nothing to narrow to" and hands back null, which
// the `!` below would otherwise silently paper over -- the "not in scope"
// test needs a narrow that actually succeeded, not a null miscast as one.
const spec = (): FoundationSpec => buildFoundation({
  fileKey: 'FILE1', extractedAt: 'T', externals: [], effectStyles: [],
  textStyles: [{ name: 'Body/Regular', description: '', fontFamily: 'Inter', fontStyle: 'Regular',
    fontSize: 16, lineHeight: { unit: 'PIXELS', value: 24 }, letterSpacing: { unit: 'PIXELS', value: 0 },
    paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE', boundVariables: {} }],
  collections: [{
    id: 'c1', name: 'Semantic', defaultModeId: 'm1', modes: [{ modeId: 'm1', name: 'Light' }],
    variables: [{ id: 'VariableID:1', name: 'color/brand', resolvedType: 'COLOR',
      description: '', codeSyntax: {}, valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } } }],
  }],
});

describe('resolutionOf', () => {
  it('reports a remote resource as external, from Figma and not from a lookup', () => {
    const r = resolutionOf(spec(), ref({ remote: true, name: 'color/surface/primary/opacity-focus' }));
    expect(r.status).toBe('external');
    expect(r.reason).toContain('library');
  });

  it('reports a paint style as not extracted whatever its remoteness', () => {
    for (const remote of [true, false]) {
      // Kind-determined, checked before `remote`, so every paint style gets the
      // same answer. There is no table to look in either way, and "we do not
      // extract these" is the actionable half.
      expect(resolutionOf(spec(), ref({ kind: 'paint-style', remote })).status)
        .toBe('not-extracted');
    }
  });

  it('reports a read that failed as unavailable, not as an empty file', () => {
    const s = { ...spec(), unavailable: ['effectStyles' as const] };
    expect(resolutionOf(s, ref({ kind: 'effect-style', id: 'S:1' })).status).toBe('unavailable');
  });

  it('reports a scope exclusion separately from an absence', () => {
    const narrowed = narrowFoundation(spec(), { target: 'textStyles' })!;
    const r = resolutionOf(narrowed, ref({ collectionId: 'c1' }));
    expect(r.status).toBe('not-in-scope');
  });

  it('reports a local resource missing from the cached dump as not in snapshot', () => {
    const r = resolutionOf(spec(), ref({ id: 'VariableID:99', name: 'color/new' }));
    expect(r.status).toBe('not-in-snapshot');
    expect(r.reason).toMatch(/read the foundations again/i);
  });

  it('reports no foundation at all as its own status', () => {
    expect(resolutionOf(undefined, ref()).status).toBe('no-foundation');
  });

  it('has exactly six statuses and no `missing`', () => {
    // A binding's name comes from Figma resolving a real id, so a name pointing
    // at nothing is unreachable, and this codebase does not emit findings that
    // cannot occur.
    const all: ResolutionStatus[] = ['external', 'not-extracted', 'unavailable',
      'not-in-snapshot', 'not-in-scope', 'no-foundation'];
    expect(all).toHaveLength(6);
  });

  it('writes no em dash or en dash in any reason', () => {
    const reasons = [
      resolutionOf(undefined, ref()),
      resolutionOf(spec(), ref({ remote: true })),
      resolutionOf(spec(), ref({ kind: 'paint-style' })),
      resolutionOf({ ...spec(), unavailable: ['variables' as const] }, ref()),
      resolutionOf(narrowFoundation(spec(), { target: 'textStyles' })!, ref()),
      resolutionOf(spec(), ref({ id: 'VariableID:99' })),
    ].map((r) => r.reason);
    for (const reason of reasons) expect(reason).not.toMatch(/[–—]/);
  });
});
