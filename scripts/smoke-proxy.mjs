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
 *
 * It first waits for the host to answer at all. The first deploy to a new
 * custom domain returns before Cloudflare has its DNS and certificate in
 * place, and the first run of this test, 60 ms later, failed every probe
 * with "fetch failed" against a Worker that was deployed and fine.
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

/** The system error code under a fetch failure (ENOTFOUND, a TLS code), or the message. */
function failureReason(err) {
  const code = err?.cause?.code;
  const message = err instanceof Error ? err.message : String(err);
  return typeof code === 'string' ? `${message}: ${code}` : message;
}

/**
 * Waits until `origin` answers anything but a network failure or one of
 * Cloudflare's 52x "origin not ready" codes, polling every `intervalMs` for
 * up to `timeoutMs`. Returns null once it answers, or why it never did.
 * Whether the answer is right is the probes' job, not this one's.
 */
export async function waitForReachable(origin, {
  fetchFn = fetch, timeoutMs = 120_000, intervalMs = 5_000,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }), now = () => Date.now(),
  onWait = () => {},
} = {}) {
  const deadline = now() + timeoutMs;
  let last;
  for (;;) {
    try {
      const res = await fetchFn(`${origin.replace(/\/$/, '')}/v1/smoke-not-a-route`, { method: 'GET', signal: AbortSignal.timeout(15_000) });
      if (res.status < 520 || res.status > 527) return null;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = failureReason(err);
    }
    if (now() + intervalMs > deadline) return `${origin} did not answer within ${Math.round(timeoutMs / 1000)} s (last: ${last}).`;
    onWait(last);
    await sleep(intervalMs);
  }
}

/**
 * Who answered an unexpected response, for the failure line. The Worker
 * answers JSON; a block by Cloudflare's own security features answers before
 * it ever runs, and says so in `cf-mitigated`, in an "error code: NNNN" body,
 * or in an HTML challenge page.
 */
export async function answeredBy(res) {
  const parts = [];
  const mitigated = res.headers.get('cf-mitigated');
  if (mitigated) parts.push(`cf-mitigated: ${mitigated}`);
  let text = '';
  try { text = await res.clone().text(); } catch { /* body unreadable */ }
  const code = /error code: (\d{3,4})/i.exec(text)?.[1];
  if (code) parts.push(`Cloudflare error ${code}`);
  else if (/<html/i.test(text)) parts.push('an HTML page, not the Worker\'s JSON');
  else if (text) parts.push(`body ${JSON.stringify(text.slice(0, 80))}`);
  const ray = res.headers.get('cf-ray');
  if (ray) parts.push(`cf-ray ${ray}`);
  return parts.length > 0 ? ` (${parts.join('; ')})` : '';
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
      problems.push(`${label}: request failed (${failureReason(err)})`);
      return;
    }
    const problem = await check(res);
    if (problem) problems.push(`${label}: ${problem}`);
  };

  await probe('CORS preflight', '/v1/prose', { method: 'OPTIONS' }, async (res) => {
    if (res.status !== 204) return `HTTP ${res.status}, expected 204${await answeredBy(res)}`;
    if (res.headers.get('access-control-allow-origin') !== '*') return 'no Access-Control-Allow-Origin: *';
    return null;
  });
  await probe('Unknown path', '/v1/smoke-not-a-route', { method: 'GET' }, async (res) => {
    if (res.status !== 404) return `HTTP ${res.status}, expected 404${await answeredBy(res)}`;
    if ((await body(res))?.error !== 'not_found') return 'body is not {"error":"not_found"}';
    if (res.headers.get('access-control-allow-origin') !== '*') return 'error response carries no CORS headers';
    return null;
  });
  await probe('Pull of an unknown library (reads KV)', `/v1/libraries/${PROBE_LIBRARY}`, {
    method: 'GET', headers: { Authorization: `Bearer ${PROBE_KEY}` },
  }, async (res) => {
    if (res.status !== 404) return `HTTP ${res.status}, expected 404${await answeredBy(res)}`;
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
  const unreachable = await waitForReachable(base, {
    onWait: (why) => console.log(`Waiting for ${base} to answer (${why})...`),
  });
  if (unreachable) {
    console.error(`Smoke test against ${base} failed: ${unreachable}`);
    process.exit(1);
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
