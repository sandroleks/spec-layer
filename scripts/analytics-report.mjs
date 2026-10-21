#!/usr/bin/env node
/**
 * analytics-report.mjs — the week's usage from Workers Analytics Engine, as
 * text tables: one question per section over the two datasets the proxy
 * writes (packages/proxy/README.md, "Usage metrics" and "Usage events").
 *
 *   CLOUDFLARE_ANALYTICS_TOKEN=… npm run report:analytics                 # production, last 7 days
 *   CLOUDFLARE_ANALYTICS_TOKEN=… npm run report:analytics -- --days 30    # a month
 *   CLOUDFLARE_ANALYTICS_TOKEN=… npm run report:analytics -- --staging    # the staging datasets
 *   CLOUDFLARE_ANALYTICS_TOKEN=… npm run report:analytics -- --json       # the rows, for a script
 *
 * The token needs Account | Account Analytics | Read and nothing else. It is
 * read from the environment, never from a file or an argument, so it has no
 * place to land in this repository; the secret scan rejects its shape if it
 * ever does. The account id is pinned below and held equal to the one in
 * packages/proxy/wrangler.toml by the test, so the script reads no file:
 * what leaves it is the fixed endpoint, a statement and the token.
 *
 * Counts are SUM(_sample_interval), never COUNT(), because Analytics Engine
 * samples under load. A dataset that does not exist yet (no plugin build has
 * sent an event) is reported as such, not as a failure. Nothing here writes.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TOKEN_ENV = 'CLOUDFLARE_ANALYTICS_TOKEN';

/** The Cloudflare account, as packages/proxy/wrangler.toml names it; the test pins the two together. */
export const ACCOUNT_ID = 'f3ea0f8b485b5b11e917f415c224b1cb';

/** Analytics Engine keeps three months; a longer window only reads as a shorter one. */
export const MAX_DAYS = 92;

export function sqlEndpoint(accountId) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;
}

/** The two datasets, as wrangler.toml names them for each environment. */
export function datasetNames(staging) {
  const suffix = staging ? '_staging' : '';
  return { requests: `spec_layer_requests_v1${suffix}`, events: `spec_layer_events_v1${suffix}` };
}

const N = 'SUM(_sample_interval)';
const since = (days) => `timestamp > NOW() - INTERVAL '${days}' DAY`;
const p = (q, column) => `quantileWeighted(${q})(${column}, _sample_interval)`;

/**
 * One question each. `dataset` is the table it reads; `sql(table, days)` is
 * the statement; `columns` is the output order, matching the aliases. The
 * column meanings are the README's tables: blob1 is the route or the event,
 * blob4 the client on a request and blob2 on an event, and so on.
 */
export const SECTIONS = [
  {
    id: 'requests', dataset: 'requests', title: 'Requests by route, outcome and tier',
    columns: ['route', 'outcome', 'tier', 'requests'],
    sql: (t, d) => `SELECT blob1 AS route, blob2 AS outcome, blob3 AS tier, ${N} AS requests FROM ${t} WHERE ${since(d)} GROUP BY route, outcome, tier ORDER BY requests DESC`,
  },
  {
    id: 'callers', dataset: 'requests', title: 'Active callers, by tier (distinct hashed identities)',
    columns: ['tier', 'callers', 'requests'],
    sql: (t, d) => `SELECT blob3 AS tier, COUNT(DISTINCT index1) AS callers, ${N} AS requests FROM ${t} WHERE ${since(d)} AND index1 != '' GROUP BY tier ORDER BY callers DESC`,
  },
  {
    id: 'ai', dataset: 'requests', title: 'AI writing: prose requests and billed generations',
    columns: ['tier', 'kind', 'outcome', 'requests', 'generations'],
    sql: (t, d) => `SELECT blob3 AS tier, blob5 AS kind, blob2 AS outcome, ${N} AS requests, SUM(double4 * _sample_interval) AS generations FROM ${t} WHERE ${since(d)} AND blob1 = 'prose' GROUP BY tier, kind, outcome ORDER BY requests DESC`,
  },
  {
    id: 'builds', dataset: 'requests', title: 'Builds on the wire',
    columns: ['client', 'requests', 'last_seen'],
    sql: (t, d) => `SELECT blob4 AS client, ${N} AS requests, MAX(timestamp) AS last_seen FROM ${t} WHERE ${since(d)} AND blob4 != '' GROUP BY client ORDER BY requests DESC`,
  },
  {
    id: 'legacy', dataset: 'requests', title: 'Legacy 5.1.0 prose contract (v8): remove its branch once this is empty',
    columns: ['requests', 'callers'],
    sql: (t, d) => `SELECT ${N} AS requests, COUNT(DISTINCT index1) AS callers FROM ${t} WHERE ${since(d)} AND blob1 = 'prose' AND blob6 = 'v8'`,
  },
  {
    id: 'publishing', dataset: 'requests', title: 'Publishing',
    columns: ['outcome', 'kind', 'bump', 'publishes', 'components'],
    sql: (t, d) => `SELECT blob2 AS outcome, blob5 AS kind, blob6 AS bump, ${N} AS publishes, SUM(double4 * _sample_interval) AS components FROM ${t} WHERE ${since(d)} AND blob1 = 'publish' GROUP BY outcome, kind, bump ORDER BY publishes DESC`,
  },
  {
    id: 'pulls', dataset: 'requests', title: 'Pulls by library and status (304 is an unchanged pull)',
    columns: ['library', 'status', 'pulls', 'bytes'],
    sql: (t, d) => `SELECT blob7 AS library, double1 AS status, ${N} AS pulls, SUM(double3 * _sample_interval) AS bytes FROM ${t} WHERE ${since(d)} AND blob1 = 'pull' GROUP BY library, status ORDER BY pulls DESC`,
  },
  {
    id: 'licenses', dataset: 'requests', title: 'License calls and verdicts',
    columns: ['route', 'call', 'verdict', 'requests'],
    sql: (t, d) => `SELECT blob1 AS route, blob6 AS call, blob5 AS verdict, ${N} AS requests FROM ${t} WHERE ${since(d)} AND blob1 IN ('activate', 'deactivate') GROUP BY route, call, verdict ORDER BY requests DESC`,
  },
  {
    id: 'latency', dataset: 'requests', title: 'Latency per route (ms)',
    columns: ['route', 'p50', 'p90', 'requests'],
    sql: (t, d) => `SELECT blob1 AS route, ${p(0.5, 'double2')} AS p50, ${p(0.9, 'double2')} AS p90, ${N} AS requests FROM ${t} WHERE ${since(d)} AND blob1 != 'preflight' GROUP BY route ORDER BY requests DESC`,
  },
  {
    id: 'installs', dataset: 'events', title: 'Active installs, by build',
    columns: ['client', 'installs', 'events'],
    sql: (t, d) => `SELECT blob2 AS client, COUNT(DISTINCT index1) AS installs, ${N} AS events FROM ${t} WHERE ${since(d)} GROUP BY client ORDER BY installs DESC`,
  },
  {
    id: 'events', dataset: 'events', title: 'Events by name, kind, outcome and detail',
    columns: ['event', 'kind', 'outcome', 'detail', 'events', 'installs'],
    sql: (t, d) => `SELECT blob1 AS event, blob3 AS kind, blob4 AS outcome, blob5 AS detail, ${N} AS events, COUNT(DISTINCT index1) AS installs FROM ${t} WHERE ${since(d)} GROUP BY event, kind, outcome, detail ORDER BY events DESC`,
  },
  {
    id: 'copies', dataset: 'events', title: 'Copy for AI and snapshot sizes (bytes)',
    columns: ['event', 'kind', 'format', 'count', 'p50', 'p90'],
    sql: (t, d) => `SELECT blob1 AS event, blob3 AS kind, blob5 AS format, ${N} AS count, ${p(0.5, 'double3')} AS p50, ${p(0.9, 'double3')} AS p90 FROM ${t} WHERE ${since(d)} AND blob1 IN ('copy_for_ai', 'snapshot_download') AND double3 > 0 GROUP BY event, kind, format ORDER BY count DESC`,
  },
  {
    id: 'library_checks', dataset: 'events', title: 'Library checks: docs and duration (ms)',
    columns: ['outcome', 'checks', 'docs_p50', 'offered_p50', 'duration_p50', 'duration_p90'],
    sql: (t, d) => `SELECT blob4 AS outcome, ${N} AS checks, ${p(0.5, 'double1')} AS docs_p50, ${p(0.5, 'double2')} AS offered_p50, ${p(0.5, 'double4')} AS duration_p50, ${p(0.9, 'double4')} AS duration_p90 FROM ${t} WHERE ${since(d)} AND blob1 = 'library_check' GROUP BY outcome ORDER BY checks DESC`,
  },
  {
    id: 'errors', dataset: 'events', title: 'Unexpected errors: where the toast fires',
    columns: ['realm', 'message_type', 'events', 'installs'],
    sql: (t, d) => `SELECT blob3 AS realm, blob5 AS message_type, ${N} AS events, COUNT(DISTINCT index1) AS installs FROM ${t} WHERE ${since(d)} AND blob1 = 'unexpected_error' GROUP BY realm, message_type ORDER BY events DESC`,
  },
  {
    id: 'usage_switch', dataset: 'events', title: 'Usage data switch changes',
    columns: ['value', 'events', 'installs'],
    sql: (t, d) => `SELECT blob5 AS value, ${N} AS events, COUNT(DISTINCT index1) AS installs FROM ${t} WHERE ${since(d)} AND blob1 = 'setting_changed' AND blob3 = 'usage_data' GROUP BY value ORDER BY events DESC`,
  },
];

/**
 * One statement against the SQL API, as rows. The answer is JSONEachRow, one
 * object per line; a non-2xx answer is an error naming the status and the
 * body, which Cloudflare keeps short, and never the token.
 */
export async function query(sql, { accountId, token, fetchFn = fetch }) {
  const res = await fetchFn(sqlEndpoint(accountId), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: `${sql} FORMAT JSONEachRow`,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL API answered HTTP ${res.status}: ${text.trim().slice(0, 300)}`);
  return text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line));
}

/** The datasets that exist so far; one is created by the first write to it. */
export async function listDatasets(opts) {
  return (await query('SHOW TABLES', opts)).map((row) => String(row.dataset));
}

/**
 * Every section, in order: its rows, or the dataset it could not read because
 * it does not exist yet. One SHOW TABLES, then one statement per section.
 */
export async function runReport({ accountId, token, days = 7, staging = false, fetchFn = fetch }) {
  const opts = { accountId, token, fetchFn };
  const names = datasetNames(staging);
  const existing = new Set(await listDatasets(opts));
  const sections = [];
  for (const section of SECTIONS) {
    const table = names[section.dataset];
    const base = { id: section.id, title: section.title, columns: section.columns, dataset: table };
    if (!existing.has(table)) {
      sections.push({ ...base, missing: true, rows: [] });
      continue;
    }
    sections.push({ ...base, missing: false, rows: await query(section.sql(table, days), opts) });
  }
  return { days, staging, datasets: names, sections };
}

/** A cell as text: integers whole, other numbers to one decimal, strings as they are. */
export function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || (typeof value === 'string' && value !== '' && Number.isFinite(Number(value)))) {
    const n = Number(value);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  return String(value);
}

function isNumeric(value) {
  return typeof value === 'number' || (typeof value === 'string' && value !== '' && Number.isFinite(Number(value)));
}

/** Aligned columns: numbers right, text left, a rule under the header, `(none)` for no rows. */
export function formatTable(columns, rows) {
  if (rows.length === 0) return '  (none)';
  const cells = rows.map((row) => columns.map((column) => formatCell(row[column])));
  const numeric = columns.map((column) => rows.every((row) => row[column] === undefined || row[column] === '' || isNumeric(row[column])));
  const widths = columns.map((column, i) => Math.max(column.length, ...cells.map((row) => row[i].length)));
  const line = (values) => `  ${values.map((value, i) => (numeric[i] ? value.padStart(widths[i]) : value.padEnd(widths[i]))).join('  ')}`;
  return [line(columns), `  ${widths.map((w) => '-'.repeat(w)).join('  ')}`, ...cells.map(line)].join('\n');
}

export function renderReport(report) {
  const out = [
    `Spec Layer usage, last ${report.days} day${report.days === 1 ? '' : 's'}, ${report.staging ? 'staging' : 'production'} ` +
    `(${report.datasets.requests}, ${report.datasets.events})`,
  ];
  for (const section of report.sections) {
    out.push('', section.title);
    out.push(section.missing
      ? `  (${section.dataset} does not exist yet: nothing has written to it)`
      : formatTable(section.columns, section.rows));
  }
  return `${out.join('\n')}\n`;
}

export const USAGE = `Usage: ${TOKEN_ENV}=<token> node scripts/analytics-report.mjs [--days N] [--staging] [--json]
  --days N    the window, 1 to ${MAX_DAYS} (default 7)
  --staging   the staging datasets instead of production
  --json      the sections and rows as JSON, for a script
The token needs Account | Account Analytics | Read.`;

/** Argument parsing alone: an object, or the usage error as a string. */
export function parseArgs(argv) {
  const options = { days: 7, staging: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--staging') options.staging = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--days') {
      const days = Number(argv[i + 1]);
      if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return `--days needs a whole number from 1 to ${MAX_DAYS}`;
      options.days = days;
      i += 1;
    } else return `unknown argument ${arg}`;
  }
  return options;
}

/**
 * The command, with its inputs and outputs injected so it can be run in a
 * test: returns the exit code, 0 on a report, 1 on an API failure, 2 on a
 * usage error. The token is read here and reaches nothing but the request.
 */
export async function cli(argv, env, { fetchFn = fetch, stdout, stderr }) {
  const options = parseArgs(argv);
  if (typeof options === 'string') {
    stderr(`${options}\n${USAGE}`);
    return 2;
  }
  const token = env[TOKEN_ENV];
  if (!token) {
    stderr(`${TOKEN_ENV} is not set.\n${USAGE}`);
    return 2;
  }
  let report;
  try {
    report = await runReport({ accountId: ACCOUNT_ID, token, days: options.days, staging: options.staging, fetchFn });
  } catch (err) {
    stderr(err instanceof Error ? err.message : String(err));
    return 1;
  }
  stdout(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report));
  return 0;
}

async function main() {
  const code = await cli(process.argv.slice(2), process.env, {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => console.error(text),
  });
  process.exit(code);
}

function invokedRealPath() {
  if (!process.argv[1]) return null;
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return null;
  }
}

const invoked = invokedRealPath();
if (invoked && pathToFileURL(invoked).href === import.meta.url) {
  await main();
}

export const SCRIPT_PATH = fileURLToPath(import.meta.url);
