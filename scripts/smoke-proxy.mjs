#!/usr/bin/env node
/**
 * smoke-proxy.mjs — prove a freshly deployed proxy answers, without spending
 * anything.
 *
 *   node scripts/smoke-proxy.mjs https://staging-api.spec-layer.com
 *
 * deploy-proxy.yml runs this after the staging deploy and gates production
 * on it. Every probe is free: no Anthropic call, no quota reservation, no
 * Lemon Squeezy call, no write. The pull probe does read KV, so a broken
 * namespace binding shows up as a 500 here rather than for a developer.
 */
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Well-formed but never issued: built at runtime so no file holds a value of
// the pull-key shape the secret scan rejects.
const PROBE_LIBRARY = `lib_${'0'.repeat(24)}`;
const PROBE_KEY = `sl_${'0'.repeat(48)}`;

async function body(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Problems with the deployment at `base`, as sentences; empty when healthy. */
export async function smokeProblems(base, fetchFn = fetch) {
  const origin = base.replace(/\/$/, '');
  const problems = [];
  const probe = async (label, path, init, check) => {
    let res;
    try {
      res = await fetchFn(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      problems.push(`${label}: request failed (${err instanceof Error ? err.message : String(err)})`);
      return;
    }
    const problem = await check(res);
    if (problem) problems.push(`${label}: ${problem}`);
  };

  await probe('CORS preflight', '/v1/prose', { method: 'OPTIONS' }, async (res) => {
    if (res.status !== 204) return `HTTP ${res.status}, expected 204`;
    if (res.headers.get('access-control-allow-origin') !== '*') return 'no Access-Control-Allow-Origin: *';
    return null;
  });
  await probe('Unknown path', '/v1/smoke-not-a-route', { method: 'GET' }, async (res) => {
    if (res.status !== 404) return `HTTP ${res.status}, expected 404`;
    if ((await body(res))?.error !== 'not_found') return 'body is not {"error":"not_found"}';
    if (res.headers.get('access-control-allow-origin') !== '*') return 'error response carries no CORS headers';
    return null;
  });
  await probe('Pull of an unknown library (reads KV)', `/v1/libraries/${PROBE_LIBRARY}`, {
    method: 'GET', headers: { Authorization: `Bearer ${PROBE_KEY}` },
  }, async (res) => {
    if (res.status !== 404) return `HTTP ${res.status}, expected 404`;
    if ((await body(res))?.error !== 'not_found') return 'body is not {"error":"not_found"}';
    if (!/\bno-store\b/.test(res.headers.get('cache-control') ?? '')) return 'Cache-Control does not say no-store';
    return null;
  });
  return problems;
}

async function main() {
  const base = process.argv[2];
  if (!base || !/^https:\/\//.test(base)) {
    console.error('Usage: smoke-proxy.mjs https://host');
    process.exit(2);
  }
  const problems = await smokeProblems(base);
  if (problems.length > 0) {
    console.error(`Smoke test against ${base} failed:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`Smoke test against ${base}: 3 probes ok.`);
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
