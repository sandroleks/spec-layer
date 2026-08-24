import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerializedFoundation } from '@spec-layer/extractor';
import {
  currentFoundationSelection,
  currentFoundationSpec,
  isFoundationGenerating,
  onFoundationChange,
  onFoundationMessage,
  onFoundationToggleAll,
  setFoundationGenerating,
  setFoundationHost,
  type FoundationHost,
} from '../src/ui/actions';

function dump(): SerializedFoundation {
  return {
    fileKey: 'FILE1',
    extractedAt: 'T',
    externals: [],
    textStyles: [{
      name: 'Body/M',
      description: '',
      fontFamily: 'Inter',
      fontStyle: 'Regular',
      fontSize: 16,
      lineHeight: { unit: 'PIXELS', value: 24 },
      letterSpacing: { unit: 'PERCENT', value: 0 },
      paragraphSpacing: 0,
      paragraphIndent: 0,
      textCase: 'ORIGINAL',
      textDecoration: 'NONE',
      boundVariables: {},
    }],
    collections: [{
      id: 'c1',
      name: 'Semantic',
      defaultModeId: 'm1',
      modes: [{ modeId: 'm1', name: 'Light' }, { modeId: 'm2', name: 'Dark' }],
      variables: [{
        id: 'v1',
        name: 'color/background',
        resolvedType: 'COLOR',
        description: '',
        codeSyntax: {},
        valuesByMode: {
          m1: { r: 1, g: 1, b: 1, a: 1 },
          m2: { r: 0, g: 0, b: 0, a: 1 },
        },
      }],
    }],
  };
}

function fakeHost(): FoundationHost & { progress: string[][]; busy: boolean[] } {
  const progress: string[][] = [];
  const busy: boolean[] = [];
  return {
    progress,
    busy,
    repaint: vi.fn(),
    setBusy: (value: boolean) => { busy.push(value); },
    startProgress: (messages: string[]) => { progress.push(messages); },
    stopProgress: vi.fn(),
  };
}

describe('foundation host', () => {
  let host: ReturnType<typeof fakeHost>;

  beforeEach(() => {
    host = fakeHost();
    setFoundationHost(host);
    setFoundationGenerating(false);
    host.busy.length = 0;
    host.progress.length = 0;
    vi.mocked(host.repaint).mockClear();
    vi.mocked(host.stopProgress).mockClear();
  });

  it('marks the build in flight so the shared lock can see it', () => {
    setFoundationGenerating(true);
    expect(isFoundationGenerating()).toBe(true);
    setFoundationGenerating(false);
    expect(isFoundationGenerating()).toBe(false);
  });

  it('drives busy state, progress, teardown, and repaint through the host', () => {
    setFoundationGenerating(true);
    setFoundationGenerating(false);
    expect(host.busy).toEqual([true, false]);
    expect(host.progress).toHaveLength(1);
    expect(host.stopProgress).toHaveBeenCalledOnce();
    expect(host.repaint).toHaveBeenCalledTimes(2);
  });

  it('publishes a parsed spec and its default selection', () => {
    onFoundationMessage(dump());
    expect(currentFoundationSpec()?.collections[0]?.name).toBe('Semantic');
    expect(currentFoundationSelection().collections).toEqual([
      { collectionId: 'c1', modeIds: ['m1', 'm2'] },
    ]);
    expect(host.repaint).toHaveBeenCalledOnce();
  });

  it('takes checkbox intent as a value and repaints from model state', () => {
    onFoundationMessage(dump());
    vi.mocked(host.repaint).mockClear();
    onFoundationChange({ kind: 'collection', collectionId: 'c1', checked: false });
    expect(currentFoundationSelection().collections).toEqual([]);
    expect(host.repaint).toHaveBeenCalledOnce();
  });

  it('toggles all sources without reading a DOM control', () => {
    onFoundationMessage(dump());
    vi.mocked(host.repaint).mockClear();
    onFoundationToggleAll();
    expect(currentFoundationSelection()).toEqual({ collections: [], textStyles: false });
    expect(host.repaint).toHaveBeenCalledOnce();
  });
});
