/**
 * The one list of what this CLI can do. The usage banner, `spec-layer tools`,
 * the agent skill, and the README all draw on it, so a command cannot exist
 * in one place and be missing from another. Every entry states what the
 * command touches: an agent deciding whether a call is safe to run needs to
 * know whether it reaches the network, whether it needs the pull key, and
 * what it writes, before it knows anything else.
 */

export interface Tool {
  name: string;
  /** The full invocation shape, flags included. */
  usage: string;
  /** One sentence: what it does. */
  summary: string;
  /** When an agent should reach for it. */
  when: string;
  network: boolean;
  needsKey: boolean;
  /** Paths written, relative to the working directory; empty when read-only. */
  writes: string[];
  /** Exit codes and their meaning. */
  exits: Record<string, string>;
}

const OK_OR_ERROR = { '0': 'success', '1': 'usage error, bad key or id, or a network or server failure' };
const LOCAL_ONLY = { '0': 'success', '1': 'no local pull, or a usage error' };

export const TOOLS: readonly Tool[] = [
  {
    name: 'setup',
    usage: 'spec-layer setup --id lib_... --key sl_... [--out DIR] [--platform web|ios|android|flutter]... [--only foundation|components] [--component NAME]...',
    summary: 'Records the library id, stores the pull key in a gitignored speclayer.local.json, then pulls.',
    when: 'Once, with the command the plugin\'s Publish screen hands out. Re-run it after the key is rotated.',
    network: true, needsKey: true,
    writes: [
      'speclayer.json', 'speclayer.local.json', '.gitignore (one line, when inside a git repo)', '<outDir>/',
      'outputs[].path from speclayer.json (default spec-layer/tokens.css for web), written in place',
    ],
    exits: OK_OR_ERROR,
  },
  {
    name: 'init',
    usage: 'spec-layer init --id lib_... [--out DIR] [--platform web|ios|android|flutter]... [--only foundation|components] [--component NAME]...',
    summary: 'Writes speclayer.json, with the platforms and default outputs, so later commands need no flags. Stores no key and reaches no server.',
    when: 'A repo that supplies the key from SPEC_LAYER_KEY instead of a stored file.',
    network: false, needsKey: false,
    writes: ['speclayer.json'],
    exits: { '0': 'success', '1': 'usage error' },
  },
  {
    name: 'pull',
    usage: 'spec-layer pull [--id lib_...] [--key sl_...] [--out DIR] [--platform web|ios|android|flutter]... [--only foundation|components] [--component NAME]...',
    summary: 'Fetches the published library and writes it under the output directory (default .speclayer/).',
    when: 'After setup, whenever status says the local copy is behind, or after changing the include or dtcg block, or the outputs block.',
    network: true, needsKey: true,
    writes: ['<outDir>/', 'outputs[].path from speclayer.json (default spec-layer/tokens.css for web), written in place'],
    exits: OK_OR_ERROR,
  },
  {
    name: 'status',
    usage: 'spec-layer status [--id lib_...] [--key sl_...] [--out DIR]',
    summary: 'Checks whether the local pull is current without writing anything.',
    when: 'Before reading the pulled files, or in CI; exit 2 means run pull.',
    network: true, needsKey: true,
    writes: [],
    exits: { '0': 'up to date', '1': 'usage error, bad key or id, or a network or server failure', '2': 'behind, or no local pull yet' },
  },
  {
    name: 'list',
    usage: 'spec-layer list [--out DIR]',
    summary: 'Lists every artifact in the last pull with its file path, or "not written" when the selection skipped it.',
    when: 'To learn which components the library documents and where each file is.',
    network: false, needsKey: false,
    writes: [],
    exits: LOCAL_ONLY,
  },
  {
    name: 'show',
    usage: 'spec-layer show foundation | component NAME [--canonical] [--out DIR]',
    summary: 'Prints one artifact to stdout: the Foundation DTCG document, or one component\'s AI YAML; --canonical prints the v5 JSON.',
    when: 'To read one component or the token document without opening files; it pipes cleanly.',
    network: false, needsKey: false,
    writes: [],
    exits: LOCAL_ONLY,
  },
  {
    name: 'tools',
    usage: 'spec-layer tools [--json]',
    summary: 'Prints this list of commands, with what each reaches and writes.',
    when: 'A coding agent deciding which command to run; --json is stable for machines.',
    network: false, needsKey: false,
    writes: [],
    exits: { '0': 'success' },
  },
  {
    name: 'skill',
    usage: 'spec-layer skill [--install] [--agent claude|cursor|copilot|windsurf|gemini|agents-md]... [--platform web|ios|android|flutter] [--json] [--out DIR]',
    summary: 'Prints a guide for a coding agent, adapted to this repository\'s stack and to the last pull; --install writes it where the agent reads instructions.',
    when: 'Right after setup, and again after a pull that adds components or after the codebase changes stack.',
    network: false, needsKey: false,
    writes: ['agent instruction files (only with --install; each path is printed)'],
    exits: { '0': 'success', '1': 'usage error, or a file could not be written' },
  },
];

export const GLOBAL_FLAGS: ReadonlyArray<{ flag: string; summary: string }> = [
  { flag: '--api URL', summary: 'Override the API origin (default https://api.spec-layer.com). Also SPEC_LAYER_API.' },
  { flag: '--out DIR', summary: 'Output directory (default .speclayer, or the outDir in speclayer.json).' },
];

export const KEY_RESOLUTION = 'The pull key resolves from --key, then SPEC_LAYER_KEY, then speclayer.local.json written by setup. No command ever prints it.';

export function toolsText(): string {
  const lines: string[] = ['spec-layer commands', ''];
  for (const tool of TOOLS) {
    lines.push(tool.usage);
    lines.push(`  ${tool.summary}`);
    lines.push(`  When: ${tool.when}`);
    lines.push(`  Network: ${tool.network ? 'yes' : 'no'}. Key: ${tool.needsKey ? 'required' : 'not needed'}. Writes: ${tool.writes.length ? tool.writes.join(', ') : 'nothing'}.`);
    lines.push(`  Exits: ${Object.entries(tool.exits).map(([code, meaning]) => `${code} ${meaning}`).join('; ')}.`);
    lines.push('');
  }
  lines.push('Flags every command accepts where they apply:');
  for (const f of GLOBAL_FLAGS) lines.push(`  ${f.flag}  ${f.summary}`);
  lines.push('');
  lines.push(KEY_RESOLUTION);
  return lines.join('\n');
}

export function toolsJson(version: string): string {
  return `${JSON.stringify({
    cli: 'spec-layer', version,
    tools: TOOLS.map((t) => ({ ...t })),
    flags: GLOBAL_FLAGS,
    key_resolution: KEY_RESOLUTION,
  }, null, 2)}\n`;
}
