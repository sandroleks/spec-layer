import { parseArgs } from 'node:util';
import { runInit, runSetup, runPull, runStatus, runList, runShow, type Flags, type Io } from './commands';

const USAGE = `spec-layer <command>

Commands:
  setup   --id lib_... --key sl_... [--out DIR] [selection]
                                                 store the key, then pull
  init    --id lib_... [--out DIR] [selection]   write speclayer.json
  pull    [--id lib_...] [--key sl_...] [selection]
                                                 fetch the library into DIR (default .speclayer); the foundation lands as DTCG under DIR/tokens/
  status  [--id lib_...] [--key sl_...]          check freshness; exits 2 when behind
  list                                           list every artifact in the last pull
  show    foundation | component NAME [--canonical]
                                                 print one artifact (foundation: the DTCG document; component: its AI YAML; --canonical for JSON)

Selection (setup, pull and init; flags replace the include block in speclayer.json):
  --only foundation | components   write just the foundation, or just components
  --component NAME                 write only this component (repeatable, matched by slug)

Options:
  --api URL   override the API origin (default https://api.spec-layer.com)
The pull key comes from --key, SPEC_LAYER_KEY, or speclayer.local.json written by setup.`;

const io: Io = {
  out: (l) => console.log(l),
  err: (l) => console.error(l),
  write: (t) => { process.stdout.write(t); },
};

async function main(): Promise<number> {
  let values: Flags;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        id: { type: 'string' },
        out: { type: 'string' },
        key: { type: 'string' },
        api: { type: 'string' },
        only: { type: 'string' },
        component: { type: 'string', multiple: true },
        canonical: { type: 'boolean' },
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
    if (command === 'setup') return await runSetup(cwd, values, process.env, io);
    if (command === 'init') return runInit(cwd, values, io);
    if (command === 'pull') return await runPull(cwd, values, process.env, io);
    if (command === 'status') return await runStatus(cwd, values, process.env, io);
    if (command === 'list') return runList(cwd, values, io);
    if (command === 'show') return runShow(cwd, values, positionals.slice(1), io);
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

// `spec-layer show foundation | head` closes stdout early. That is not an
// error worth a stack trace; exit quietly with the code the command chose.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw err;
});

process.exitCode = await main();
