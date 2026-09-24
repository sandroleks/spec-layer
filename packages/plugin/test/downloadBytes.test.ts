// @vitest-environment happy-dom
//
// zipFiles is covered in download.test.ts under Node. downloadBytes is the
// one DOM contact, so it gets its own happy-dom file; URL.createObjectURL is
// not in happy-dom and is stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBytes, REVOKE_DELAY_MS } from '../src/ui/download';

const urlApi = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
const original = { create: urlApi.createObjectURL, revoke: urlApi.revokeObjectURL };
const clickOriginal = HTMLAnchorElement.prototype.click;

beforeEach(() => {
  vi.useFakeTimers();
  urlApi.createObjectURL = vi.fn(() => 'blob:spec-layer/1');
  urlApi.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  urlApi.createObjectURL = original.create;
  urlApi.revokeObjectURL = original.revoke;
  HTMLAnchorElement.prototype.click = clickOriginal;
  document.body.innerHTML = '';
});

describe('downloadBytes', () => {
  it('hands the browser a blob URL and revokes it only after the click has had time to start', () => {
    const clicked: string[] = [];
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicked.push(this.href); };

    downloadBytes(new Uint8Array([1, 2, 3]), 'spec-layer.zip', 'application/zip');

    expect(clicked).toEqual(['blob:spec-layer/1']);
    expect(urlApi.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
    expect(urlApi.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:spec-layer/1');
  });
});
