import { describe, it, expect, vi } from 'vitest';
import {
  createFoundationReader,
  type VariablesSource,
  type StylesSource,
  type VariableSource,
} from '../src/foundationReader';

function variable(id: string, over: Partial<VariableSource> = {}): VariableSource {
  return {
    id, name: `color/${id}`, resolvedType: 'COLOR', description: '',
    variableCollectionId: 'c1', codeSyntax: { WEB: `--${id}` },
    valuesByMode: { m1: { r: 0, g: 0, b: 0, a: 1 } },
    scopes: ['ALL_SCOPES'], remote: false, hiddenFromPublishing: false,
    getPublishStatusAsync: async () => 'CURRENT',
    ...over,
  };
}

function fakes(locals: VariableSource[], byId: Record<string, VariableSource> = {}) {
  const variables: VariablesSource = {
    getLocalVariableCollectionsAsync: vi.fn(async () => []),
    getLocalVariablesAsync: vi.fn(async () => locals),
    getVariableByIdAsync: vi.fn(async (id: string) => byId[id] ?? null),
    getVariableCollectionByIdAsync: vi.fn(async () => null),
  };
  const styles: StylesSource = {
    getLocalTextStylesAsync: vi.fn(async () => []),
    getLocalEffectStylesAsync: vi.fn(async () => []),
  };
  return { variables, styles };
}

describe('createFoundationReader', () => {
  it('reads every local variable in one call and serves lookups from it', async () => {
    const { variables, styles } = fakes([variable('a'), variable('b')]);
    const reader = createFoundationReader(variables, styles);
    const [a, b, a2] = await Promise.all([reader.variable('a'), reader.variable('b'), reader.variable('a')]);
    expect(a?.name).toBe('color/a');
    expect(b?.name).toBe('color/b');
    expect(a2?.codeSyntax).toEqual({ WEB: '--a' });
    expect(variables.getLocalVariablesAsync).toHaveBeenCalledTimes(1);
    expect(variables.getVariableByIdAsync).not.toHaveBeenCalled();
  });

  it('falls back to a per-id read for an id the bulk read did not return', async () => {
    const { variables, styles } = fakes([variable('a')], { late: variable('late') });
    const reader = createFoundationReader(variables, styles);
    expect((await reader.variable('late'))?.name).toBe('color/late');
    expect(variables.getVariableByIdAsync).toHaveBeenCalledWith('late');
    expect(await reader.variable('gone')).toBeNull();
  });

  it('falls back per id when the bulk read itself fails', async () => {
    const { variables, styles } = fakes([], { a: variable('a') });
    (variables.getLocalVariablesAsync as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no'));
    const reader = createFoundationReader(variables, styles);
    expect((await reader.variable('a'))?.name).toBe('color/a');
  });

  it('keeps the per-variable publication status and turns a failed read into null', async () => {
    const { variables, styles } = fakes([
      variable('ok'),
      variable('bad', { getPublishStatusAsync: async () => { throw new Error('offline'); } }),
    ]);
    const reader = createFoundationReader(variables, styles);
    expect((await reader.variable('ok'))?.publishStatus).toBe('CURRENT');
    expect((await reader.variable('bad'))?.publishStatus).toBeNull();
  });

  it('drops non-string code syntax entries and copies scopes', async () => {
    const { variables, styles } = fakes([
      variable('a', { codeSyntax: { WEB: '--a', iOS: undefined } as Record<string, string | undefined>, scopes: ['GAP'] }),
    ]);
    const reader = createFoundationReader(variables, styles);
    const a = await reader.variable('a');
    expect(a?.codeSyntax).toEqual({ WEB: '--a' });
    expect(a?.scopes).toEqual(['GAP']);
  });

  it('does not share the bulk read between two readers', async () => {
    const { variables, styles } = fakes([variable('a')]);
    await createFoundationReader(variables, styles).variable('a');
    await createFoundationReader(variables, styles).variable('a');
    expect(variables.getLocalVariablesAsync).toHaveBeenCalledTimes(2);
  });
});
