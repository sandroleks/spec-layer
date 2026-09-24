import { describe, it, expect, vi } from 'vitest';
import {
  createFoundationReader,
  type VariablesSource,
  type StylesSource,
  type VariableSource,
  type TextStyleSource,
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

  describe('publishStatus option', () => {
    const status = () => vi.fn(async (): Promise<PublishStatus> => 'CURRENT');

    function sourcesWith(read: ReturnType<typeof status>) {
      const variables: VariablesSource = {
        getLocalVariableCollectionsAsync: vi.fn(async () => [{
          id: 'c1', name: 'C', modes: [{ modeId: 'm1', name: 'M' }], defaultModeId: 'm1',
          variableIds: ['a'], hiddenFromPublishing: false, remote: false, getPublishStatusAsync: read,
        }]),
        getLocalVariablesAsync: vi.fn(async () => [variable('a', { getPublishStatusAsync: read })]),
        getVariableByIdAsync: vi.fn(async () => null),
        getVariableCollectionByIdAsync: vi.fn(async () => null),
      };
      const styles: StylesSource = {
        getLocalTextStylesAsync: vi.fn(async (): Promise<TextStyleSource[]> => [{
          id: 't1', name: 'Body', description: '', fontName: { family: 'Inter', style: 'Regular' },
          fontSize: 16, lineHeight: { unit: 'AUTO' }, letterSpacing: { unit: 'PERCENT', value: 0 },
          paragraphSpacing: 0, paragraphIndent: 0, textCase: 'ORIGINAL', textDecoration: 'NONE',
          remote: false, getPublishStatusAsync: read,
        }]),
        getLocalEffectStylesAsync: vi.fn(async () => [{
          id: 'e1', name: 'Shadow', description: '', effects: [], remote: false, getPublishStatusAsync: read,
        }]),
      };
      return { variables, styles };
    }

    it('reads publish status for every source by default', async () => {
      const read = status();
      const { variables, styles } = sourcesWith(read);
      const reader = createFoundationReader(variables, styles);
      expect((await reader.collections())[0].publishStatus).toBe('CURRENT');
      expect((await reader.variable('a'))?.publishStatus).toBe('CURRENT');
      expect((await reader.textStyles())[0].publishStatus).toBe('CURRENT');
      expect((await reader.effectStyles())[0].publishStatus).toBe('CURRENT');
      expect(read).toHaveBeenCalledTimes(4);
    });

    it('skips every publish status read when told not to, leaving the status null', async () => {
      const read = status();
      const { variables, styles } = sourcesWith(read);
      const reader = createFoundationReader(variables, styles, { publishStatus: false });
      expect((await reader.collections())[0].publishStatus).toBeNull();
      expect((await reader.variable('a'))?.publishStatus).toBeNull();
      expect((await reader.textStyles())[0].publishStatus).toBeNull();
      expect((await reader.effectStyles())[0].publishStatus).toBeNull();
      // hidden/remote are synchronous properties and still travel.
      expect((await reader.variable('a'))?.hiddenFromPublishing).toBe(false);
      expect(read).not.toHaveBeenCalled();
    });
  });
});
