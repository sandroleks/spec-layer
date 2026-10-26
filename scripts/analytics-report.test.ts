import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  ACCOUNT_ID, MAX_DAYS, SECTIONS, SCRIPT_PATH, TOKEN_ENV, USAGE, cli, datasetNames, formatCell, formatTable,
  listDatasets, parseArgs, query, renderReport, runReport, sqlEndpoint,
} from './analytics-report.mjs';

const WRANGLER = readFileSync(new URL('../packages/proxy/wrangler.toml', import.meta.url), 'utf8');
const ACCOUNT = ACCOUNT_ID;
// Shaped like nothing the secret scan knows; never a real token.
const TOKEN = 'test-token-for-the-report';

type Row = Record<string, unknown>;

/** A fake SQL API: `answers` maps a statement fragment to its rows; SHOW TABLES lists `datasets`. */
function fakeApi(datasets: string[], answers: Array<[string, Row[]]> = []) {
  const calls: Array<{ url: string; init: RequestInit; sql: string }> = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    const sql = String(init.body);
    calls.push({ url, init, sql });
    if (sql.startsWith('SHOW TABLES')) return new Response(datasets.map((dataset) => JSON.stringify({ dataset })).join('\n'));
    const hit = answers.find(([fragment]) => sql.includes(fragment));
    return new Response((hit?.[1] ?? []).map((row) => JSON.stringify(row)).join('\n'));
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe('configuration', () => {
  it('pins the account id to the one wrangler.toml deploys with', () => {
    // Pinned in the script rather than read from the file, so the script's
    // one outbound request depends on nothing but its constants and the token.
    expect(ACCOUNT_ID).toBe(/^account_id = "([0-9a-f]{32})"$/m.exec(WRANGLER)?.[1]);
    expect(sqlEndpoint(ACCOUNT)).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`);
  });

  it('names the datasets wrangler.toml binds, per environment', () => {
    expect(datasetNames(false)).toEqual({ requests: 'spec_layer_requests_v1', events: 'spec_layer_events_v1' });
    expect(datasetNames(true)).toEqual({ requests: 'spec_layer_requests_v1_staging', events: 'spec_layer_events_v1_staging' });
    for (const name of Object.values(datasetNames(false))) expect(WRANGLER).toContain(`dataset = "${name}"`);
    for (const name of Object.values(datasetNames(true))) expect(WRANGLER).toContain(`dataset = "${name}"`);
  });
});

describe('SECTIONS', () => {
  it('asks each question of the right table over the window, and never counts rows with COUNT()', () => {
    const ids = new Set<string>();
    for (const section of SECTIONS) {
      expect(ids.has(section.id)).toBe(false);
      ids.add(section.id);
      expect(['requests', 'events']).toContain(section.dataset);
      const sql = section.sql('the_table', 30);
      expect(sql).toContain('FROM the_table');
      expect(sql).toContain("INTERVAL '30' DAY");
      expect(sql).not.toMatch(/COUNT\(\s*\*?\s*\)/i);
      // Every alias the output names is one the statement produces.
      for (const column of section.columns) expect(sql).toContain(` AS ${column}`);
    }
    expect(SECTIONS.filter((s) => s.dataset === 'events').length).toBeGreaterThanOrEqual(5);
  });

  it('weights every count and quantile by the sample interval', () => {
    for (const section of SECTIONS) {
      const sql = section.sql('t', 7);
      expect(sql).toContain('SUM(_sample_interval)');
      for (const quantile of sql.match(/quantileWeighted\([^)]+\)\([^)]+\)/g) ?? []) expect(quantile).toContain('_sample_interval');
    }
  });
});

describe('query', () => {
  it('POSTs the statement with the bearer and JSONEachRow, and parses one row per line', async () => {
    const { fetchFn, calls } = fakeApi([], [['SELECT 1', [{ a: 1 }, { a: '2' }]]]);
    const rows = await query('SELECT 1', { accountId: ACCOUNT, token: TOKEN, fetchFn });
    expect(rows).toEqual([{ a: 1 }, { a: '2' }]);
    expect(calls[0].url).toBe(sqlEndpoint(ACCOUNT));
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(calls[0].sql).toBe('SELECT 1 FORMAT JSONEachRow');
  });

  it('turns a refusal into an error naming the status and the body, never the token', async () => {
    const fetchFn = (async () => new Response('{"success":false,"errors":[{"code":10000,"message":"Authorization error"}]}', { status: 403 })) as unknown as typeof fetch;
    const failure = query('SELECT 1', { accountId: ACCOUNT, token: TOKEN, fetchFn });
    await expect(failure).rejects.toThrow('SQL API answered HTTP 403');
    await expect(failure).rejects.toThrow('Authorization error');
    await expect(failure).rejects.not.toThrow(TOKEN);
  });

  it('lists the datasets that exist', async () => {
    const { fetchFn } = fakeApi(['spec_layer_requests_v1']);
    expect(await listDatasets({ accountId: ACCOUNT, token: TOKEN, fetchFn })).toEqual(['spec_layer_requests_v1']);
  });
});

describe('runReport', () => {
  it('runs every section against its dataset and marks the ones whose dataset does not exist yet', async () => {
    const { fetchFn, calls } = fakeApi(['spec_layer_requests_v1'], [
      ['GROUP BY route, outcome, tier', [{ route: 'prose', outcome: 'ok', tier: 'free', requests: '12' }]],
    ]);
    const report = await runReport({ accountId: ACCOUNT, token: TOKEN, days: 7, fetchFn });
    expect(report.days).toBe(7);
    expect(report.datasets.events).toBe('spec_layer_events_v1');
    const requests = report.sections.find((s) => s.id === 'requests');
    expect(requests?.missing).toBe(false);
    expect(requests?.rows).toEqual([{ route: 'prose', outcome: 'ok', tier: 'free', requests: '12' }]);
    for (const section of report.sections.filter((s) => s.dataset === 'spec_layer_events_v1')) {
      expect(section.missing).toBe(true);
      expect(section.rows).toEqual([]);
    }
    // SHOW TABLES, then one statement per section whose table exists.
    const requestSections = SECTIONS.filter((s) => s.dataset === 'requests').length;
    expect(calls).toHaveLength(1 + requestSections);
    for (const call of calls.slice(1)) expect(call.sql).toContain("INTERVAL '7' DAY");
  });

  it('reads the staging datasets when asked', async () => {
    const { fetchFn, calls } = fakeApi(['spec_layer_requests_v1_staging', 'spec_layer_events_v1_staging']);
    const report = await runReport({ accountId: ACCOUNT, token: TOKEN, days: 1, staging: true, fetchFn });
    expect(report.sections.every((s) => !s.missing)).toBe(true);
    expect(calls).toHaveLength(1 + SECTIONS.length);
    expect(calls.slice(1).every((call) => /FROM spec_layer_(requests|events)_v1_staging /.test(call.sql))).toBe(true);
  });
});

describe('formatting', () => {
  it('prints whole numbers whole, other numbers to one decimal, and text as it is', () => {
    expect(formatCell('12')).toBe('12');
    expect(formatCell(12)).toBe('12');
    expect(formatCell(12.345)).toBe('12.3');
    expect(formatCell('plugin/7.1.0')).toBe('plugin/7.1.0');
    expect(formatCell('')).toBe('');
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
  });

  it('aligns numbers right and text left under a rule, and says when there is nothing', () => {
    const table = formatTable(['route', 'requests'], [{ route: 'prose', requests: '120' }, { route: 'unmatched', requests: '3' }]);
    expect(table.split('\n')).toEqual([
      '  route      requests',
      '  ---------  --------',
      '  prose           120',
      '  unmatched         3',
    ]);
    expect(formatTable(['route'], [])).toBe('  (none)');
  });

  it('renders the report with a heading per section and a note for a dataset not created yet', () => {
    const text = renderReport({
      days: 7, staging: false, datasets: datasetNames(false),
      sections: [
        { id: 'requests', title: 'Requests', columns: ['route', 'requests'], dataset: 'spec_layer_requests_v1', missing: false, rows: [{ route: 'pull', requests: '2' }] },
        { id: 'installs', title: 'Installs', columns: ['client'], dataset: 'spec_layer_events_v1', missing: true, rows: [] },
      ],
    });
    expect(text).toContain('Spec Layer usage, last 7 days, production (spec_layer_requests_v1, spec_layer_events_v1)');
    expect(text).toContain('\nRequests\n  route  requests');
    expect(text).toContain('\nInstalls\n  (spec_layer_events_v1 does not exist yet: nothing has written to it)');
  });
});

describe('cli', () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, stdout: (t: string) => { out.push(t); }, stderr: (t: string) => { err.push(t); } };
  };

  it('parses its arguments and refuses the rest with usage', () => {
    expect(parseArgs([])).toEqual({ days: 7, staging: false, json: false });
    expect(parseArgs(['--days', '30', '--staging', '--json'])).toEqual({ days: 30, staging: true, json: true });
    expect(parseArgs(['--days', 'abc'])).toContain('--days needs a whole number');
    expect(parseArgs(['--days', String(MAX_DAYS + 1)])).toContain('--days needs a whole number');
    expect(parseArgs(['--week'])).toBe('unknown argument --week');
    expect(USAGE).toContain(TOKEN_ENV);
  });

  it('exits 2 without a token or on a usage error, and prints the usage', async () => {
    const a = io();
    expect(await cli([], {}, { fetchFn: vi.fn() as unknown as typeof fetch, ...a })).toBe(2);
    expect(a.err.join('')).toContain(`${TOKEN_ENV} is not set.`);
    const b = io();
    expect(await cli(['--days', '0'], { [TOKEN_ENV]: TOKEN }, { fetchFn: vi.fn() as unknown as typeof fetch, ...b })).toBe(2);
    expect(b.err.join('')).toContain('--days needs a whole number');
  });

  it('prints the report, or the rows as JSON, and exits 0', async () => {
    const { fetchFn } = fakeApi(['spec_layer_requests_v1'], [['GROUP BY route, outcome, tier', [{ route: 'quota', outcome: 'ok', tier: 'free', requests: '5' }]]]);
    const text = io();
    expect(await cli([], { [TOKEN_ENV]: TOKEN }, { fetchFn, ...text })).toBe(0);
    expect(text.out.join('')).toContain('  quota  ok       free         5');
    const json = io();
    expect(await cli(['--json'], { [TOKEN_ENV]: TOKEN }, { fetchFn, ...json })).toBe(0);
    const parsed = JSON.parse(json.out.join('')) as { sections: Array<{ id: string; rows: Row[] }> };
    expect(parsed.sections.find((s) => s.id === 'requests')?.rows).toEqual([{ route: 'quota', outcome: 'ok', tier: 'free', requests: '5' }]);
    expect(json.out.join('')).not.toContain(TOKEN);
  });

  it('exits 1 on an API failure and says why, without the token', async () => {
    const fetchFn = (async () => new Response('Authorization error', { status: 403 })) as unknown as typeof fetch;
    const a = io();
    expect(await cli([], { [TOKEN_ENV]: TOKEN }, { fetchFn, ...a })).toBe(1);
    expect(a.err.join('')).toContain('HTTP 403');
    expect(a.err.join('')).not.toContain(TOKEN);
  });

  it('runs as a script: a missing token is a usage error, exit 2, before any request', () => {
    const r = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`${TOKEN_ENV} is not set.`);
  });
});
