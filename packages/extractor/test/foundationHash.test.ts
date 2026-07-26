import { describe, it, expect } from 'vitest';
import { buildFoundation, type SerializedFoundation, type FoundationScope } from '../src/foundation';
import { foundationContentHash } from '../src/hash';

function dump(): SerializedFoundation {
  return {
    fileKey: 'FILE1', extractedAt: '2026-07-25T00:00:00.000Z', externals: [], textStyles: [],
    collections: [
      {
        id: 'c1', name: 'Semantic', defaultModeId: 's1',
        modes: [{ modeId: 's1', name: 'Light' }, { modeId: 's2', name: 'Dark' }],
        variables: [
          { id: 'bg', name: 'bg/brand', resolvedType: 'COLOR', description: 'Brand fill.',
            codeSyntax: {}, valuesByMode: {
              s1: { r: 0.145, g: 0.388, b: 0.921, a: 1 },
              s2: { r: 0.231, g: 0.510, b: 0.965, a: 1 },
            } },
        ],
      },
      {
        id: 'c2', name: 'Other', defaultModeId: 'o1',
        modes: [{ modeId: 'o1', name: 'Value' }],
        variables: [
          { id: 'x', name: 'x/y', resolvedType: 'FLOAT', description: '',
            codeSyntax: {}, valuesByMode: { o1: 4 } },
        ],
      },
    ],
  };
}

const SEMANTIC: FoundationScope = {
  target: 'collection', collectionId: 'c1', collectionName: 'Semantic', modeIds: ['s1', 's2'],
};
const OTHER: FoundationScope = {
  target: 'collection', collectionId: 'c2', collectionName: 'Other', modeIds: ['o1'],
};

const hashOf = (d: SerializedFoundation, scope: FoundationScope = SEMANTIC) =>
  foundationContentHash(buildFoundation(d), scope);

describe('foundationContentHash', () => {
  it('is stable across re-extraction of identical data', () => {
    expect(hashOf(dump())).toBe(hashOf(dump()));
  });

  it('ignores extractedAt', () => {
    const d = dump();
    d.extractedAt = '2030-01-01T00:00:00.000Z';
    expect(hashOf(d)).toBe(hashOf(dump()));
  });

  it('ignores collection and variable ids', () => {
    const d = dump();
    d.collections[0].id = 'renamed-id';
    d.collections[0].variables[0].id = 'other-id';
    const scope: FoundationScope = { ...SEMANTIC, collectionId: 'renamed-id' };
    expect(foundationContentHash(buildFoundation(d), scope)).toBe(hashOf(dump()));
  });

  it('ignores mode ids but not mode names', () => {
    const idsChanged = dump();
    idsChanged.collections[0].modes = [{ modeId: 'z1', name: 'Light' }, { modeId: 'z2', name: 'Dark' }];
    idsChanged.collections[0].defaultModeId = 'z1';
    idsChanged.collections[0].variables[0].valuesByMode = {
      z1: { r: 0.145, g: 0.388, b: 0.921, a: 1 },
      z2: { r: 0.231, g: 0.510, b: 0.965, a: 1 },
    };
    expect(foundationContentHash(buildFoundation(idsChanged), { ...SEMANTIC, modeIds: ['z1', 'z2'] }))
      .toBe(hashOf(dump()));

    const renamed = dump();
    renamed.collections[0].modes[1].name = 'Night';
    expect(hashOf(renamed)).not.toBe(hashOf(dump()));
  });

  it('changes when a variable is renamed', () => {
    const d = dump();
    d.collections[0].variables[0].name = 'bg/primary';
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when a value changes', () => {
    const d = dump();
    d.collections[0].variables[0].valuesByMode.s2 = { r: 1, g: 0, b: 0, a: 1 };
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when a variable is added', () => {
    const d = dump();
    d.collections[0].variables.push({
      id: 'new', name: 'bg/subtle', resolvedType: 'COLOR', description: '',
      codeSyntax: {}, valuesByMode: { s1: { r: 1, g: 1, b: 1, a: 1 }, s2: { r: 0, g: 0, b: 0, a: 1 } },
    });
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when a description changes', () => {
    const d = dump();
    d.collections[0].variables[0].description = 'Different.';
    expect(hashOf(d)).not.toBe(hashOf(dump()));
  });

  it('changes when the collection is renamed', () => {
    const d = dump();
    d.collections[0].name = 'Tokens';
    expect(foundationContentHash(buildFoundation(d), { ...SEMANTIC, collectionName: 'Tokens' }))
      .not.toBe(hashOf(dump()));
  });

  it('isolates scopes: editing collection c2 leaves c1 unchanged', () => {
    const d = dump();
    d.collections[1].variables[0].valuesByMode.o1 = 999;
    expect(hashOf(d, SEMANTIC)).toBe(hashOf(dump(), SEMANTIC));
    expect(hashOf(d, OTHER)).not.toBe(hashOf(dump(), OTHER));
  });

  it('differs between a group-scoped unit and the whole collection', () => {
    const d = dump();
    d.collections[0].variables.push({
      id: 'text', name: 'text/default', resolvedType: 'COLOR', description: '',
      codeSyntax: {}, valuesByMode: { s1: { r: 0, g: 0, b: 0, a: 1 }, s2: { r: 1, g: 1, b: 1, a: 1 } },
    });
    const whole = hashOf(d, SEMANTIC);
    const scoped = hashOf(d, { ...SEMANTIC, group: 'bg' });
    expect(scoped).not.toBe(whole);
  });

  it('returns a stable sentinel when the scope source is gone', () => {
    const gone: FoundationScope = {
      target: 'collection', collectionId: 'deleted', collectionName: 'Deleted', modeIds: [],
    };
    expect(hashOf(dump(), gone)).toBe(hashOf(dump(), gone));
    expect(hashOf(dump(), gone)).not.toBe(hashOf(dump(), SEMANTIC));
  });

  it('returns the same sentinel for a group that no longer matches anything', () => {
    const gone: FoundationScope = { ...SEMANTIC, group: 'colour' };
    const deleted: FoundationScope = {
      target: 'collection', collectionId: 'deleted', collectionName: 'Deleted', modeIds: [],
    };
    expect(hashOf(dump(), gone)).toBe(hashOf(dump(), deleted));
    expect(hashOf(dump(), gone)).not.toBe(hashOf(dump(), { ...SEMANTIC, group: 'bg' }));
  });
});

/** One text style, over-specified so every unrendered field has a value to change. */
function textDump(): SerializedFoundation {
  return {
    fileKey: 'FILE1', extractedAt: '2026-07-25T00:00:00.000Z', externals: [],
    collections: [],
    textStyles: [{
      name: 'Body/M', description: 'Default body.',
      fontFamily: 'Inter', fontStyle: 'Regular', fontSize: 16,
      lineHeight: { unit: 'PIXELS', value: 24 },
      letterSpacing: { unit: 'PERCENT', value: 0 },
      paragraphSpacing: 8, paragraphIndent: 0,
      textCase: 'ORIGINAL', textDecoration: 'NONE',
      boundVariables: { fills: 'color/text/default' },
    }],
  };
}

const TEXT: FoundationScope = { target: 'textStyles' };
const textHash = (d: SerializedFoundation) => foundationContentHash(buildFoundation(d), TEXT);

describe('foundationContentHash — text styles cover exactly what is drawn', () => {
  // A frame draws the style name, the optional description, an "Ag" specimen
  // in the style's own font, and a "family style size/lineHeight" line. A hash
  // that moved on anything else would offer an Update that produced a
  // byte-identical frame, which trains the user to ignore the badge.

  it('does not move when letter spacing changes', () => {
    const d = textDump();
    d.textStyles[0].letterSpacing = { unit: 'PERCENT', value: -4 };
    expect(textHash(d)).toBe(textHash(textDump()));
  });

  it('does not move when text case changes', () => {
    const d = textDump();
    d.textStyles[0].textCase = 'UPPER';
    expect(textHash(d)).toBe(textHash(textDump()));
  });

  it('does not move when a bound variable is rebound', () => {
    const d = textDump();
    d.textStyles[0].boundVariables = { fills: 'color/text/muted' };
    expect(textHash(d)).toBe(textHash(textDump()));
  });

  it('does not move when paragraph spacing, indent, or decoration change', () => {
    const d = textDump();
    d.textStyles[0].paragraphSpacing = 99;
    d.textStyles[0].paragraphIndent = 12;
    d.textStyles[0].textDecoration = 'UNDERLINE';
    expect(textHash(d)).toBe(textHash(textDump()));
  });

  it('moves when the family, style, size, or line height changes', () => {
    const base = textHash(textDump());

    const family = textDump();
    family.textStyles[0].fontFamily = 'Roboto';
    expect(textHash(family)).not.toBe(base);

    const style = textDump();
    style.textStyles[0].fontStyle = 'Bold';
    expect(textHash(style)).not.toBe(base);

    const size = textDump();
    size.textStyles[0].fontSize = 18;
    expect(textHash(size)).not.toBe(base);

    const lineHeight = textDump();
    lineHeight.textStyles[0].lineHeight = { unit: 'AUTO' };
    expect(textHash(lineHeight)).not.toBe(base);
  });

  it('moves when the name or description changes', () => {
    const base = textHash(textDump());

    const renamed = textDump();
    renamed.textStyles[0].name = 'Body/L';
    expect(textHash(renamed)).not.toBe(base);

    const described = textDump();
    described.textStyles[0].description = 'Something else.';
    expect(textHash(described)).not.toBe(base);
  });
});

describe('foundationContentHash — part numbering is covered', () => {
  /** A collection over the split threshold, spread across `groups`. */
  function splitDump(groups: string[]): SerializedFoundation {
    return {
      fileKey: 'FILE1', extractedAt: '2026-07-25T00:00:00.000Z', externals: [], textStyles: [],
      collections: [{
        id: 'c1', name: 'Primitives', defaultModeId: 'm1',
        modes: [{ modeId: 'm1', name: 'Value' }],
        variables: Array.from({ length: 160 }, (_, i) => ({
          id: `v${i}`, name: `${groups[i % groups.length]}/item${i}`,
          resolvedType: 'COLOR' as const, description: '', codeSyntax: {},
          valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } },
        })),
      }],
    };
  }

  it('moves when a new top-level group renumbers a surviving frame', () => {
    // "Part 2 of 3" becoming "Part 2 of 4" is a change to what the frame says,
    // so the doc must offer an Update. Before part lived in unitContent, the
    // surviving frames kept stale numbers and read "In sync" forever.
    const scope: FoundationScope = {
      target: 'collection', collectionId: 'c1', collectionName: 'Primitives',
      group: 'space', modeIds: ['m1'],
    };
    const before = splitDump(['color', 'space', 'radius']);
    const after = splitDump(['color', 'space', 'radius']);
    after.collections[0].variables.push({
      id: 'extra', name: 'shadow/sm', resolvedType: 'COLOR', description: '',
      codeSyntax: {}, valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } },
    });
    expect(foundationContentHash(buildFoundation(after), scope))
      .not.toBe(foundationContentHash(buildFoundation(before), scope));
  });

  it('moves when a group is reordered ahead of this one', () => {
    // "Part 2 of 3" becoming "Part 3 of 3" is the same class of change.
    const scope: FoundationScope = {
      target: 'collection', collectionId: 'c1', collectionName: 'Primitives',
      group: 'radius', modeIds: ['m1'],
    };
    const before = splitDump(['color', 'space', 'radius']);
    const after = splitDump(['color', 'space', 'radius']);
    // Move a radius variable to the front so radius becomes the first group.
    const radiusVar = after.collections[0].variables.find((v) => v.name.startsWith('radius/'))!;
    after.collections[0].variables = [
      radiusVar,
      ...after.collections[0].variables.filter((v) => v !== radiusVar),
    ];
    expect(foundationContentHash(buildFoundation(after), scope))
      .not.toBe(foundationContentHash(buildFoundation(before), scope));
  });
});
