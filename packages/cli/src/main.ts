import { parseArgs } from 'node:util';
import {
  runInit, runSetup, runPull, runStatus, runList, runShow, runTools, runSkill, type Flags, type Io,
} from './commands';
import { resolveKeyFromStdin } from './stdin';
import { cliVersion } from './version';

export const USAGE = `spec-layer <command>

Commands:
  setup   --id lib_... --key sl_...|- [--out DIR] [selection] [--platform P]... [--component-format F]
                                                 store the key, then pull
  init    --id lib_... [--out DIR] [selection] [--platform P]... [--component-format F]
                                                 write speclayer.json
  pull    [--id lib_...] [--key sl_...|-] [selection] [--platform P]... [--component-format F] [--strict] [--json]
                                                 fetch the library into DIR (default .speclayer); the foundation lands as DTCG under DIR/tokens/;
                                                 --strict exits 1 when tokens/report.json or an outputs/*.report.json holds an error-severity entry, even on a cached pull (default exit stays 0)
  status  [--id lib_...] [--key sl_...|-] [--json] check freshness; exits 2 when behind
  list    [--json]                               list every artifact in the last pull
  show    foundation | component NAME [--component-format F] [--canonical]
                                                 print one artifact (foundation: the DTCG document; component: its AI YAML or Markdown; --canonical for JSON)
  tools   [--json]                               list every command with what it reaches and writes
  skill   [--install] [--agent HOST]... [--platform P]... [--json]
                                                 print a guide for a coding agent, adapted to this repo and the last pull;
                                                 --install writes it for claude, cursor, copilot, windsurf, gemini, or agents-md

Selection (setup, pull and init; flags replace the include block in speclayer.json):
  --only foundation | components   write just the foundation, or just components
  --component NAME                 write only this component (repeatable, matched by slug)

Options:
  --json      on pull, status and list: one JSON object on stdout; exit codes unchanged
  --api URL   override the API origin (default https://api.spec-layer.com); https only, except http to localhost
  --platform web|ios|android|flutter   the target this repo builds for (repeatable); applies to setup, init, pull, and skill; setup and init store it, pull uses it for the run
  --component-format yaml|md   how component-specs/ is written and show prints a component (default yaml); setup and init store it, pull and show use it for the run
The pull key comes from --key, SPEC_LAYER_KEY, or speclayer.local.json written by setup.
--key - reads it from stdin (a pipe, or a paste followed by Enter), so the key stays out of shell history.
SPEC_LAYER_RETRIES (default 2) sets how many times pull and status retry a network, timeout, 5xx or 429 failure.

spec-layer --help prints this; spec-layer --version prints the version.`;

/** Words that ask for the usage text as a command rather than a flag. */
const HELP_WORDS: ReadonlySet<string> = new Set(['help']);

export interface MainDeps {
  cwd: string;
  env: Record<string, string | undefined>;
  stdin: NodeJS.ReadableStream;
  io: Io;
}

/**
 * Parses `argv` (without the node and script paths) and runs one command.
 * Returns the exit code. Separate from cli.ts, which only wires the process,
 * so argument handling is testable without spawning the bundle.
 */
export async function main(argv: string[], deps: MainDeps): Promise<number> {
  const { cwd, env, stdin, io } = deps;
  let values: Flags & { help?: boolean; version?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        id: { type: 'string' },
        out: { type: 'string' },
        key: { type: 'string' },
        api: { type: 'string' },
        only: { type: 'string' },
        component: { type: 'string', multiple: true },
        canonical: { type: 'boolean' },
        json: { type: 'boolean' },
        install: { type: 'boolean' },
        strict: { type: 'boolean' },
        agent: { type: 'string', multiple: true },
        platform: { type: 'string', multiple: true },
        'component-format': { type: 'string' },
      },
    }));
  } catch {
    // parseArgs throws on a bad flag: show usage, not the exception.
    io.err(USAGE);
    return 1;
  }

  const command = positionals[0];
  // Asked for, so stdout and success; an unknown command below stays stderr and 1.
  if (values.help || (command !== undefined && HELP_WORDS.has(command))) {
    io.out(USAGE);
    return 0;
  }
  if (values.version) {
    io.out(cliVersion());
    return 0;
  }
  const { help: _help, version: _version, ...flags } = values;

  try {
    // Inside the try, so an unexpected stdin failure reaches the net below.
    const stdinKey = await resolveKeyFromStdin(command, flags.key, stdin);
    if (stdinKey.error !== null) {
      io.err(stdinKey.error);
      return 1;
    }
    const resolvedFlags: Flags = stdinKey.key !== null ? { ...flags, key: stdinKey.key } : flags;

    if (command === 'setup') return await runSetup(cwd, resolvedFlags, env, io);
    if (command === 'init') return runInit(cwd, resolvedFlags, io);
    if (command === 'pull') return await runPull(cwd, resolvedFlags, env, io);
    if (command === 'status') return await runStatus(cwd, resolvedFlags, env, io);
    if (command === 'list') return runList(cwd, resolvedFlags, io);
    if (command === 'show') return runShow(cwd, resolvedFlags, positionals.slice(1), io);
    if (command === 'tools') return runTools(resolvedFlags, io);
    if (command === 'skill') return runSkill(cwd, resolvedFlags, io);
    io.err(USAGE);
    return 1;
  } catch (err) {
    // Last-resort net: an error a command did not anticipate prints as plain
    // text, never a stack trace.
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
