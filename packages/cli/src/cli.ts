import { parseArgs } from 'node:util';
import { runInit, runPull, runStatus, type Io } from './commands';

const USAGE = `spec-layer <command>

Commands:
  init    --id lib_... [--out DIR]        write speclayer.json
  pull    [--id lib_...] [--key sl_...]   fetch the library into DIR (default .speclayer)
  status  [--id lib_...] [--key sl_...]   check freshness; exits 2 when behind

Options:
  --api URL   override the API origin (default https://api.spec-layer.com)
The pull key comes from --key or the SPEC_LAYER_KEY environment variable.`;

const io: Io = { out: (l) => console.log(l), err: (l) => console.error(l) };

async function main(): Promise<number> {
  let values: Record<string, string | undefined>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        id: { type: 'string' },
        out: { type: 'string' },
        key: { type: 'string' },
        api: { type: 'string' },
      },
    }));
  } catch {
    // util.parseArgs throws (e.g. ERR_PARSE_ARGS_UNKNOWN_OPTION) on a bad flag.
    // Surface usage, not the exception, and exit nonzero.
    io.err(USAGE);
    return 1;
  }

  const command = positionals[0];
  const cwd = process.cwd();
  try {
    if (command === 'init') return runInit(cwd, values, io);
    if (command === 'pull') return await runPull(cwd, values, process.env, io);
    if (command === 'status') return await runStatus(cwd, values, process.env, io);
    io.err(USAGE);
    return 1;
  } catch (err) {
    // Last-resort net: any error that escapes a command (fs failure, etc.)
    // is printed as plain text, never as a stack trace. Commands are expected
    // to handle their own known-failure paths and return a code directly;
    // this only catches what they didn't anticipate.
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

process.exitCode = await main();
