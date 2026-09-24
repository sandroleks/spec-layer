import { createInterface } from 'node:readline';

/**
 * The first non-empty line on `input`, trimmed, or null when the stream ends
 * before one arrives. `--key -` reads the pull key this way so the key never
 * sits on the command line, where shell history and `ps` can read it. Works
 * for a pipe and for a terminal paste followed by Enter alike; `terminal:
 * false` keeps readline from taking over the terminal.
 */
export async function readFirstLine(input: NodeJS.ReadableStream): Promise<string | null> {
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
