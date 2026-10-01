import { createInterface } from 'node:readline';

/**
 * The first non-empty line on `input`, trimmed, or null when the stream ends
 * first. `--key -` reads the key this way so it never sits on the command line,
 * where shell history and `ps` see it. `terminal: false` keeps readline off the
 * terminal; on a TTY a prompt goes to stderr so the wait does not look like a hang.
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

/** Commands that resolve a pull key; every other command ignores `--key`. */
export const KEY_COMMANDS: ReadonlySet<string> = new Set(['setup', 'pull', 'status']);

export interface StdinKeyResult {
  /** The key read from stdin, or null when stdin was not read. */
  key: string | null;
  /** Set when stdin closed or failed before a line arrived; the caller exits 1. */
  error: string | null;
}

/**
 * Resolves `--key -` from stdin only for a command in `KEY_COMMANDS`; any other
 * command returns without touching `input`, so it never blocks on a paste.
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
    // A closed descriptor (`<&-`) or EIO on a detached terminal errors the stream.
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
