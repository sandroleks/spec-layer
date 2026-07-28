import { afterEach, describe, it, expect, vi } from 'vitest';
import type { SerializedNode } from '@spec-layer/extractor';
import type { SectionId } from '../src/ui/docModel';
import { createState, downloadDoc, type BuildPresenter } from '../src/ui/actions';

function fakePresenter(): BuildPresenter & { errors: string[] } {
  const errors: string[] = [];
  return {
    errors,
    clear: vi.fn(),
    error: (message: string) => { errors.push(message); },
    info: vi.fn(),
    setBusy: vi.fn(),
    startProgress: vi.fn(),
    stopProgress: vi.fn(),
  };
}

function buttonNode(): SerializedNode {
  return {
    id: '1:1',
    name: 'Button',
    type: 'COMPONENT',
    visible: true,
    children: [],
  };
}

function lifecyclePresenter() {
  const errors: string[] = [];
  const busy: boolean[] = [];
  const startProgress = vi.fn();
  const stopProgress = vi.fn();
  const ui: BuildPresenter = {
    clear: vi.fn(),
    error: (message) => { errors.push(message); },
    info: vi.fn(),
    setBusy: (value) => { busy.push(value); },
    startProgress,
    stopProgress,
  };
  return { ui, errors, busy, startProgress, stopProgress };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadDoc', () => {
  it('refuses without a component', async () => {
    const ui = fakePresenter();
    await downloadDoc(createState(), { sections: new Set(), variantIds: new Set() }, ui);
    expect(ui.errors).toEqual(['Select a component first.']);
  });

  it('never leaves the button stuck busy after refusing', async () => {
    const ui = fakePresenter();
    await downloadDoc(createState(), { sections: new Set(), variantIds: new Set() }, ui);
    expect(ui.setBusy).not.toHaveBeenCalledWith(true);
  });

  it('preserves refusal order when no sections are selected', async () => {
    const state = createState();
    state.currentNode = { id: '1', name: 'Button' } as never;
    state.currentSpec = { name: 'Button' } as never;
    const events: string[] = [];
    const ui: BuildPresenter = {
      clear: () => { events.push('clear'); },
      error: (message) => { events.push(`error:${message}`); },
      info: (message) => { events.push(`info:${message}`); },
      setBusy: (busy) => { events.push(`busy:${busy}`); },
      startProgress: (messages) => { events.push(`progress:${messages.length}`); },
      stopProgress: () => { events.push('stop'); },
    };

    await downloadDoc(state, { sections: new Set(), variantIds: new Set() }, ui);

    expect(events).toEqual([
      'clear',
      'busy:true',
      'progress:4',
      'error:Select at least one section.',
      'stop',
      'busy:false',
    ]);
  });

  it('stops progress and restores the button after a successful download', async () => {
    let clicks = 0;
    vi.stubGlobal('document', {
      createElement: () => ({
        href: '',
        download: '',
        click: () => { clicks += 1; },
      }),
    });
    const state = createState();
    state.currentNode = buttonNode();
    state.currentFileKey = 'FILE1';
    const lifecycle = lifecyclePresenter();

    await downloadDoc(
      state,
      { sections: new Set<SectionId>(['configuration']), variantIds: new Set() },
      lifecycle.ui,
    );

    expect(clicks).toBe(1);
    expect(lifecycle.errors).toEqual([]);
    expect(lifecycle.busy).toEqual([true, false]);
    expect(lifecycle.startProgress).toHaveBeenCalledOnce();
    expect(lifecycle.stopProgress).toHaveBeenCalledOnce();
  });

  it('stops progress and restores the button when saving fails', async () => {
    vi.stubGlobal('document', {
      createElement: () => { throw new Error('download unavailable'); },
    });
    const state = createState();
    state.currentNode = buttonNode();
    state.currentFileKey = 'FILE1';
    const lifecycle = lifecyclePresenter();

    await downloadDoc(
      state,
      { sections: new Set<SectionId>(['configuration']), variantIds: new Set() },
      lifecycle.ui,
    );

    expect(lifecycle.errors).toEqual(['Download failed: download unavailable']);
    expect(lifecycle.busy).toEqual([true, false]);
    expect(lifecycle.stopProgress).toHaveBeenCalledOnce();
  });
});
