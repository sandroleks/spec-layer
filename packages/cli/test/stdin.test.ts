import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { readFirstLine, resolveKeyFromStdin, KEY_COMMANDS } from '../src/stdin';

const KEY = `sl_${'a'.repeat(48)}`;
const OTHER_KEY = `sl_${'b'.repeat(48)}`;

describe('readFirstLine', () => {
  it('returns the first non-empty line, trimmed', async () => {
    expect(await readFirstLine(Readable.from([`  ${KEY}  \n`, `${OTHER_KEY}\n`]))).toBe(KEY);
    expect(await readFirstLine(Readable.from(['\n', '\n', KEY]))).toBe(KEY);
  });

  it('strips a trailing carriage return, so a Windows line ending works too', async () => {
    expect(await readFirstLine(Readable.from([`${KEY}\r\n`]))).toBe(KEY);
  });

  it('returns null when the stream ends without a line', async () => {
    expect(await readFirstLine(Readable.from([]))).toBeNull();
    expect(await readFirstLine(Readable.from(['\n\n']))).toBeNull();
  });
});

describe('resolveKeyFromStdin', () => {
  it('reads the key from stdin for every command that resolves a key', async () => {
    expect(KEY_COMMANDS).toEqual(new Set(['setup', 'pull', 'status']));
    for (const command of KEY_COMMANDS) {
      expect(await resolveKeyFromStdin(command, '-', Readable.from([`${KEY}\n`]))).toEqual({ key: KEY, error: null });
    }
  });

  it('refuses when stdin closes before a line arrives, for a key-reading command', async () => {
    expect(await resolveKeyFromStdin('pull', '-', Readable.from(['\n']))).toEqual({
      key: null,
      error: '--key - reads the key from stdin, and nothing arrived. Pipe the key in, or paste it and press Enter.',
    });
  });

  // A closed descriptor (`<&-`) or EIO on a detached terminal errors the
  // stream; that must be one sentence and exit 1, never a stack trace.
  it('turns a stdin read error into one sentence instead of rejecting', async () => {
    const broken = new Readable({ read() { this.destroy(new Error('EIO: i/o error, read')); } });
    expect(await resolveKeyFromStdin('setup', '-', broken)).toEqual({
      key: null,
      error: '--key - could not read the key from stdin. Pipe the key in, paste it and press Enter, or set SPEC_LAYER_KEY.',
    });
  });

  it('never touches stdin for a command that does not resolve a key', async () => {
    const read = vi.fn(() => { throw new Error('stdin must not be read for a command that never uses the key'); });
    const stream = new Readable({ read });
    for (const command of ['list', 'show', 'tools', 'skill', 'init']) {
      expect(await resolveKeyFromStdin(command, '-', stream)).toEqual({ key: null, error: null });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('never touches stdin when --key is not "-"', async () => {
    const read = vi.fn(() => { throw new Error('stdin must not be read when --key is not "-"'); });
    const stream = new Readable({ read });
    expect(await resolveKeyFromStdin('pull', KEY, stream)).toEqual({ key: null, error: null });
    expect(await resolveKeyFromStdin('pull', undefined, stream)).toEqual({ key: null, error: null });
    expect(read).not.toHaveBeenCalled();
  });
});
