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

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    id: { type: 'string' },
    out: { type: 'string' },
    key: { type: 'string' },
    api: { type: 'string' },
  },
});

const command = positionals[0];
const cwd = process.cwd();
let code: number;
if (command === 'init') code = runInit(cwd, values, io);
else if (command === 'pull') code = await runPull(cwd, values, process.env, io);
else if (command === 'status') code = await runStatus(cwd, values, process.env, io);
else {
  io.err(USAGE);
  code = 1;
}
process.exitCode = code;
