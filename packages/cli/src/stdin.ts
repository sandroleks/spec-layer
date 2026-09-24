import { createInterface } from 'node:readline';

/**
 * The first non-empty line on `input`, trimmed, or null when the stream ends
 * before one arrives. `--key -` reads the pull key this way so the key never
 * sits on the command line, where shell history and `ps` can read it. Works
 * for a pipe and for a terminal paste followed by Enter alike; `terminal:
 * false` keeps readline from taking over the terminal. When `input` is a
 * real TTY (an interactive paste, not a pipe or a test double), a short
 * prompt goes to stderr first, so the wait for input does not look like a
 * hang.
 */
export async function readFirstLine(input: NodeJS.ReadableStream): Promise<string | null> {
  if ((input as NodeJS.ReadStream).isTTY) {
    process.stderr.write('Paste your pull key and press Enter:\n');
  }
  const rl = createInterface({ input, terminal: false });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed.length > 0) return trimmed;
    }
    return null;
  } finally {
    rl.close();
  }
}

/** Commands that resolve a pull key at all. Every other command ignores `--key` entirely. */
export const KEY_COMMANDS: ReadonlySet<string> = new Set(['setup', 'pull', 'status']);

export interface StdinKeyResult {
  /** The key read from stdin, or null when this call never read stdin at all. */
  key: string | null;
  /** Set when stdin closed before a line arrived, or could not be read; the caller should refuse and exit 1. */
  error: string | null;
}

/**
 * Resolves `--key -` from stdin, but only for a command that actually reads
 * a key (`setup`, `pull`, `status`; see `KEY_COMMANDS`). For any other
 * command, or when `key` is not `-`, this returns immediately without
 * touching `input` at all: `list --key -`, `show --key -`, `tools --key -`,
 * `skill --key -`, and `init --key -` never block on a paste that would be
 * discarded anyway.
 */
export async function resolveKeyFromStdin(
  command: string | undefined,
  key: string | undefined,
  input: NodeJS.ReadableStream,
): Promise<StdinKeyResult> {
  if (key !== '-' || command === undefined || !KEY_COMMANDS.has(command)) {
    return { key: null, error: null };
  }
  let line: string | null;
  try {
    line = await readFirstLine(input);
  } catch {
    // A closed descriptor (`<&-`) or EIO on a detached terminal errors the
    // stream. That is one sentence and exit 1, like every other refusal.
    return {
      key: null,
      error: '--key - could not read the key from stdin. Pipe the key in, paste it and press Enter, or set SPEC_LAYER_KEY.',
    };
  }
  if (line === null) {
    return {
      key: null,
      error: '--key - reads the key from stdin, and nothing arrived. Pipe the key in, or paste it and press Enter.',
    };
  }
  return { key: line, error: null };
}
