import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveTokenColor,
  resolveTokenNumber,
  resolveTokenTypography,
  resetTokenResolveCaches,
} from '../src/tokenResolve';

// ---------------------------------------------------------------------------
// A minimal stand-in for the slice of the Figma API this module touches.
// Everything here is best-effort by design: the module treats a missing or
// throwing API as "no swatch / no suffix" rather than an error, so the mock
// needs to be able to misbehave on demand.
// ---------------------------------------------------------------------------

interface FakeVar {
  id: string;
  name: string;
  variableCollectionId: string;
  valuesByMode: Record<string, unknown>;
}

interface FakeStyle {
  name: string;
  fontName: unknown;
  fontSize: unknown;
}

const DEFAULT_MODE = 'mode-1';
const COLLECTION = 'collection-1';

function alias(id: string) {
  return { type: 'VARIABLE_ALIAS', id };
}

function colorVar(name: string, value: unknown, id = name): FakeVar {
  return { id, name, variableCollectionId: COLLECTION, valuesByMode: { [DEFAULT_MODE]: value } };
}

interface MockOptions {
  color?: FakeVar[];
  float?: FakeVar[];
  styles?: FakeStyle[];
  /** Variables reachable only by id (alias targets), in addition to the above. */
  byId?: FakeVar[];
  /** Make getLocalVariablesAsync throw, simulating an unavailable API. */
  throwOnList?: boolean;
  /** Return a collection with no defaultModeId. */
  collectionWithoutMode?: boolean;
  /** Make getLocalTextStylesAsync throw. */
  throwOnStyles?: boolean;
}

function installFigma(opts: MockOptions = {}) {
  const { color = [], float = [], styles = [], byId = [] } = opts;
  const all = [...color, ...float, ...byId];

  const getLocalVariablesAsync = vi.fn(async (type: string) => {
    if (opts.throwOnList) throw new Error('variables API unavailable');
    return type === 'COLOR' ? color : float;
  });

  const getLocalTextStylesAsync = vi.fn(async () => {
    if (opts.throwOnStyles) throw new Error('styles API unavailable');
    return styles;
  });

  const getVariableCollectionByIdAsync = vi.fn(async () =>
    opts.collectionWithoutMode ? { defaultModeId: undefined } : { defaultModeId: DEFAULT_MODE },
  );

  const getVariableByIdAsync = vi.fn(async (id: string) => all.find((v) => v.id === id) ?? null);

  (globalThis as Record<string, unknown>).figma = {
    variables: { getLocalVariablesAsync, getVariableCollectionByIdAsync, getVariableByIdAsync },
    getLocalTextStylesAsync,
  };

  return { getLocalVariablesAsync, getLocalTextStylesAsync, getVariableByIdAsync };
}

beforeEach(() => {
  resetTokenResolveCaches();
  delete (globalThis as Record<string, unknown>).figma;
});

// ---------------------------------------------------------------------------
// resolveTokenColor
// ---------------------------------------------------------------------------

describe('resolveTokenColor', () => {
  it('resolves a token to its default-mode colour, dropping alpha', () => {
    installFigma({ color: [colorVar('color/bg/brand', { r: 0.1, g: 0.2, b: 0.3, a: 0.5 })] });
    return expect(resolveTokenColor('color/bg/brand')).resolves.toEqual({ r: 0.1, g: 0.2, b: 0.3 });
  });

  it('returns null for a token that is not a known variable', () => {
    installFigma({ color: [colorVar('color/bg/brand', { r: 1, g: 1, b: 1, a: 1 })] });
    return expect(resolveTokenColor('color/bg/nope')).resolves.toBeNull();
  });

  it('leaves a duplicated name unresolved rather than guessing a collection', async () => {
    // The module documents this: a spec token carries no collection context, so
    // picking either of two same-named variables would be wrong half the time.
    installFigma({
      color: [
        colorVar('brand', { r: 1, g: 0, b: 0, a: 1 }, 'light-brand'),
        colorVar('brand', { r: 0, g: 0, b: 1, a: 1 }, 'dark-brand'),
        colorVar('accent', { r: 0, g: 1, b: 0, a: 1 }),
      ],
    });
    await expect(resolveTokenColor('brand')).resolves.toBeNull();
    // …while unique names in the same set still resolve exactly as before.
    await expect(resolveTokenColor('accent')).resolves.toEqual({ r: 0, g: 1, b: 0 });
  });

  it('drops a name that appears three times, not just twice', async () => {
    installFigma({
      color: [
        colorVar('brand', { r: 1, g: 0, b: 0, a: 1 }, 'a'),
        colorVar('brand', { r: 0, g: 1, b: 0, a: 1 }, 'b'),
        colorVar('brand', { r: 0, g: 0, b: 1, a: 1 }, 'c'),
      ],
    });
    await expect(resolveTokenColor('brand')).resolves.toBeNull();
  });

  it('follows an alias chain to the concrete colour', async () => {
    const target = colorVar('color/base/red', { r: 1, g: 0, b: 0, a: 1 }, 'target');
    installFigma({
      color: [colorVar('color/bg/danger', alias('target'))],
      byId: [target],
    });
    await expect(resolveTokenColor('color/bg/danger')).resolves.toEqual({ r: 1, g: 0, b: 0 });
  });

  it('resolves the deepest alias chain the guard allows', async () => {
    // The entry variable is depth 0, so four dereferences fit under the cap.
    const hops = [0, 1, 2].map((i) => colorVar(`hop-${i}`, alias(`hop-${i + 1}`), `hop-${i}`));
    const leaf = colorVar('hop-3', { r: 0.5, g: 0.5, b: 0.5, a: 1 }, 'hop-3');
    installFigma({ color: [colorVar('entry', alias('hop-0'))], byId: [...hops, leaf] });
    await expect(resolveTokenColor('entry')).resolves.toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  });

  it('gives up one hop past the guard instead of recursing forever', async () => {
    const hops = [0, 1, 2, 3].map((i) => colorVar(`hop-${i}`, alias(`hop-${i + 1}`), `hop-${i}`));
    const leaf = colorVar('hop-4', { r: 1, g: 1, b: 1, a: 1 }, 'hop-4');
    installFigma({ color: [colorVar('entry', alias('hop-0'))], byId: [...hops, leaf] });
    await expect(resolveTokenColor('entry')).resolves.toBeNull();
  });

  it('survives a self-referential alias', async () => {
    const loop = colorVar('loop', alias('loop'), 'loop');
    installFigma({ color: [loop], byId: [loop] });
    await expect(resolveTokenColor('loop')).resolves.toBeNull();
  });

  it('returns null when the alias target no longer exists', async () => {
    installFigma({ color: [colorVar('dangling', alias('missing'))] });
    await expect(resolveTokenColor('dangling')).resolves.toBeNull();
  });

  it('returns null when the collection has no default mode', async () => {
    installFigma({
      color: [colorVar('color/bg/brand', { r: 1, g: 1, b: 1, a: 1 })],
      collectionWithoutMode: true,
    });
    await expect(resolveTokenColor('color/bg/brand')).resolves.toBeNull();
  });

  it('degrades to no swatch when the variables API throws', async () => {
    installFigma({ throwOnList: true });
    await expect(resolveTokenColor('anything')).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe('caching', () => {
  it('loads the variable list once and serves later lookups from cache', async () => {
    const { getLocalVariablesAsync } = installFigma({
      color: [colorVar('a', { r: 1, g: 1, b: 1, a: 1 }), colorVar('b', { r: 0, g: 0, b: 0, a: 1 })],
    });
    await resolveTokenColor('a');
    await resolveTokenColor('b');
    await resolveTokenColor('missing');
    expect(getLocalVariablesAsync).toHaveBeenCalledTimes(1);
  });

  it('caches the empty map after a failure so a broken API is not retried per token', async () => {
    const { getLocalVariablesAsync } = installFigma({ throwOnList: true });
    await resolveTokenColor('a');
    await resolveTokenColor('b');
    expect(getLocalVariablesAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps colour and float caches independent', async () => {
    const { getLocalVariablesAsync } = installFigma({
      color: [colorVar('c', { r: 1, g: 1, b: 1, a: 1 })],
      float: [colorVar('f', 8)],
    });
    await resolveTokenColor('c');
    await resolveTokenNumber('f');
    expect(getLocalVariablesAsync).toHaveBeenCalledTimes(2);
    expect(getLocalVariablesAsync).toHaveBeenNthCalledWith(1, 'COLOR');
    expect(getLocalVariablesAsync).toHaveBeenNthCalledWith(2, 'FLOAT');
  });

  it('re-reads every cache after a reset so edited variables resolve fresh', async () => {
    const first = installFigma({
      color: [colorVar('t', { r: 1, g: 0, b: 0, a: 1 })],
      float: [colorVar('n', 4)],
      styles: [{ name: 's', fontName: { family: 'Inter', style: 'Regular' }, fontSize: 12 }],
    });
    await expect(resolveTokenColor('t')).resolves.toEqual({ r: 1, g: 0, b: 0 });
    await expect(resolveTokenNumber('n')).resolves.toBe(4);
    await expect(resolveTokenTypography('s')).resolves.toBe('Inter Regular 12');
    expect(first.getLocalVariablesAsync).toHaveBeenCalledTimes(2);
    expect(first.getLocalTextStylesAsync).toHaveBeenCalledTimes(1);

    // The designer edits their variables; the next frame build resets caches.
    resetTokenResolveCaches();
    const second = installFigma({
      color: [colorVar('t', { r: 0, g: 0, b: 1, a: 1 })],
      float: [colorVar('n', 16)],
      styles: [{ name: 's', fontName: { family: 'Inter', style: 'Bold' }, fontSize: 20 }],
    });
    await expect(resolveTokenColor('t')).resolves.toEqual({ r: 0, g: 0, b: 1 });
    await expect(resolveTokenNumber('n')).resolves.toBe(16);
    await expect(resolveTokenTypography('s')).resolves.toBe('Inter Bold 20');
    expect(second.getLocalVariablesAsync).toHaveBeenCalledTimes(2);
    expect(second.getLocalTextStylesAsync).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// resolveTokenNumber
// ---------------------------------------------------------------------------

describe('resolveTokenNumber', () => {
  it('resolves a FLOAT token to its default-mode number', () => {
    installFigma({ float: [colorVar('space/md', 12)] });
    return expect(resolveTokenNumber('space/md')).resolves.toBe(12);
  });

  it('resolves zero rather than treating it as absent', () => {
    installFigma({ float: [colorVar('space/none', 0)] });
    return expect(resolveTokenNumber('space/none')).resolves.toBe(0);
  });

  it('follows an alias chain to the concrete number', async () => {
    const target = colorVar('space/base', 4, 'target');
    installFigma({ float: [colorVar('space/xs', alias('target'))], byId: [target] });
    await expect(resolveTokenNumber('space/xs')).resolves.toBe(4);
  });

  it('gives up one hop past the guard, mirroring the colour resolver', async () => {
    const hops = [0, 1, 2, 3].map((i) => colorVar(`h-${i}`, alias(`h-${i + 1}`), `h-${i}`));
    installFigma({
      float: [colorVar('entry', alias('h-0'))],
      byId: [...hops, colorVar('h-4', 2, 'h-4')],
    });
    await expect(resolveTokenNumber('entry')).resolves.toBeNull();
  });

  it('returns null when the value is not a number', async () => {
    installFigma({ float: [colorVar('bogus', 'twelve')] });
    await expect(resolveTokenNumber('bogus')).resolves.toBeNull();
  });

  it('returns null for an unknown token and for a duplicated name', async () => {
    installFigma({
      float: [colorVar('dup', 1, 'a'), colorVar('dup', 2, 'b'), colorVar('ok', 3)],
    });
    await expect(resolveTokenNumber('unknown')).resolves.toBeNull();
    await expect(resolveTokenNumber('dup')).resolves.toBeNull();
    await expect(resolveTokenNumber('ok')).resolves.toBe(3);
  });
});

// ---------------------------------------------------------------------------
// resolveTokenTypography
// ---------------------------------------------------------------------------

describe('resolveTokenTypography', () => {
  it('summarises a matching text style as family, style, size', () => {
    installFigma({
      styles: [{ name: 'Heading/H1', fontName: { family: 'Inter', style: 'Bold' }, fontSize: 32 }],
    });
    return expect(resolveTokenTypography('Heading/H1')).resolves.toBe('Inter Bold 32');
  });

  it('returns null for an unknown token', () => {
    installFigma({ styles: [] });
    return expect(resolveTokenTypography('Heading/H1')).resolves.toBeNull();
  });

  it('returns null when fontName is mixed', () => {
    // figma.mixed is a symbol, not an object with a family.
    installFigma({ styles: [{ name: 'Mixed', fontName: Symbol('mixed'), fontSize: 16 }] });
    return expect(resolveTokenTypography('Mixed')).resolves.toBeNull();
  });

  it('returns null when fontSize is mixed', () => {
    installFigma({
      styles: [{ name: 'Mixed', fontName: { family: 'Inter', style: 'Regular' }, fontSize: Symbol('mixed') }],
    });
    return expect(resolveTokenTypography('Mixed')).resolves.toBeNull();
  });

  it('leaves a duplicated style name unresolved', async () => {
    installFigma({
      styles: [
        { name: 'Body', fontName: { family: 'Inter', style: 'Regular' }, fontSize: 14 },
        { name: 'Body', fontName: { family: 'Roboto', style: 'Regular' }, fontSize: 16 },
      ],
    });
    await expect(resolveTokenTypography('Body')).resolves.toBeNull();
  });

  it('degrades to null when the text styles API throws', () => {
    installFigma({ throwOnStyles: true });
    return expect(resolveTokenTypography('Heading/H1')).resolves.toBeNull();
  });

  it('degrades to null when reading the style itself throws', () => {
    const hostile = {
      name: 'Hostile',
      get fontName(): unknown { throw new Error('detached node'); },
      fontSize: 16,
    };
    installFigma({ styles: [hostile as unknown as FakeStyle] });
    return expect(resolveTokenTypography('Hostile')).resolves.toBeNull();
  });
});
