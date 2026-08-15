import { describe, it, expect, afterEach, vi } from 'vitest';
import { copyText } from '../src/ui/clipboard';

const g = globalThis as Record<string, unknown>;
const hadDocument = 'document' in g;

function stubDom(execResult: boolean) {
  const el = { value: '', style: {} as Record<string, string>, select: () => {}, setSelectionRange: () => {}, focus: () => {} };
  g.document = {
    createElement: () => el,
    body: { appendChild: () => {}, removeChild: () => {} },
    execCommand: () => execResult,
  };
  return el;
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (!hadDocument) delete g.document;
});

describe('copyText', () => {
  it('uses the async clipboard when it resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubDom(true);
    expect(await copyText('hello')).toBe('async');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the async clipboard rejects', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } });
    const el = stubDom(true);
    expect(await copyText('payload')).toBe('exec');
    expect(el.value).toBe('payload');
  });

  it('falls back to execCommand when navigator.clipboard is absent entirely', async () => {
    vi.stubGlobal('navigator', {});
    stubDom(true);
    expect(await copyText('payload')).toBe('exec');
  });

  it('reports manual when both automatic tiers fail', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
    stubDom(false);
    expect(await copyText('payload')).toBe('manual');
  });

  it('never throws when execCommand itself throws', async () => {
    vi.stubGlobal('navigator', {});
    g.document = {
      createElement: () => ({ value: '', style: {}, select: () => {}, setSelectionRange: () => {}, focus: () => {} }),
      body: { appendChild: () => {}, removeChild: () => {} },
      execCommand: () => { throw new Error('denied'); },
    };
    expect(await copyText('payload')).toBe('manual');
  });
});
