import { describe, it, expect, vi } from 'vitest';
import {
  createState,
  updateFromSource,
  type BuildPresenter,
  type DocSource,
} from '../src/ui/actions';

function fakePresenter(): BuildPresenter & { errors: string[]; progress: string[][] } {
  const errors: string[] = [];
  const progress: string[][] = [];
  return {
    errors,
    progress,
    clear: vi.fn(),
    error: (message: string) => { errors.push(message); },
    info: vi.fn(),
    setBusy: vi.fn(),
    startProgress: (messages: string[]) => { progress.push(messages); },
    stopProgress: vi.fn(),
  };
}

const badSource = {
  docId: 'd1',
  node: { id: 'n1', name: 'broken' },
  fileKey: 'f1',
  config: { sections: [], variantIds: [], aiEnabled: false },
} as unknown as DocSource;

describe('updateFromSource', () => {
  it('narrates before it starts working', async () => {
    const ui = fakePresenter();
    await updateFromSource(createState(), badSource, ui);
    expect(ui.progress[0]).toEqual([
      'Reading the component',
      'Composing sections',
      'Placing the frame on the canvas',
    ]);
  });

  it('reports failure through the presenter rather than throwing', async () => {
    const ui = fakePresenter();
    await expect(updateFromSource(createState(), badSource, ui)).resolves.toBe(false);
    expect(ui.errors.length).toBeGreaterThan(0);
  });
});
