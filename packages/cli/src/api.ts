import { createHash } from 'node:crypto';
import { cliVersion } from './version';

export type FetchBundleResult =
  | { kind: 'ok'; raw: string; publishedAt: string; bundleHash: string; version: string | null }
  | { kind: 'not_modified'; version: string | null }
  /**
   * `retryable`: network, timeout, unreadable body, or 5xx. A 4xx needs
   * something changed first, so a caller must not suggest a bare retry.
   */
  | { kind: 'error'; message: string; retryable: boolean; retryAfterMs?: number };

/** One request's deadline, headers and body together. */
export const FETCH_TIMEOUT_MS = 30_000;

/**
 * The largest response read. The proxy refuses to store a bundle over 5 MB,
 * so this is a guard against a misconfigured --api origin streaming without
 * end, not a limit a real library reaches.
 */
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

/** Sent on every request, so the server can tell CLI versions apart. */
export function userAgent(): string {
  return `spec-layer/${cliVersion()} node/${process.versions.node}`;
}

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const;
const TLS_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** The system error code under a fetch failure (ENOTFOUND, ECONNREFUSED, a TLS code), or null. */
function causeCode(err: unknown): string | null {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === 'string' ? cause.code : null;
}

/**
 * What to try when a request never reached the server. Node's built-in fetch
 * ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set, so a pull behind a
 * corporate proxy otherwise fails with nothing to go on.
 */
function reachHint(code: string | null, env: Record<string, string | undefined>): string {
  if (code && TLS_CODES.has(code)) {
    return ' If a proxy or security product re-signs HTTPS traffic, point NODE_EXTRA_CA_CERTS at its CA certificate.';
  }
  const proxyVar = PROXY_VARS.find((v) => env[v]);
  if (proxyVar && env.NODE_USE_ENV_PROXY !== '1') {
    return ` ${proxyVar} is set, but Node's built-in fetch only uses it when NODE_USE_ENV_PROXY=1 is set too (current Node 22 and 24 releases).`;
  }
  return '';
}

/** Seconds or an HTTP date, as milliseconds from now; null when absent or unreadable. */
function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** The body as text, refusing past `maxBytes` whether or not Content-Length was sent. */
async function readCapped(res: Response, maxBytes: number): Promise<string | 'too_large'> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    return 'too_large';
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return 'too_large';
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** `AbortSignal.timeout` rejects with a DOMException named TimeoutError; nothing else in this path does. */
const isTimeout = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'TimeoutError';

export interface FetchBundleOptions {
  api: string; libraryId: string; key: string; etag?: string; fetcher?: typeof fetch; timeoutMs?: number;
  /** For the proxy hint; defaults to process.env. */
  env?: Record<string, string | undefined>;
  maxBytes?: number;
}

/** One attempt. `fetchBundleWithRetry` is what commands call. */
export async function fetchBundle(opts: FetchBundleOptions): Promise<FetchBundleResult> {
  const doFetch = opts.fetcher ?? fetch;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  // Worded for both places the deadline fires: before the headers, or mid-body.
  const timedOut: FetchBundleResult = {
    kind: 'error', message: `${opts.api} did not finish answering within ${timeoutMs / 1000} seconds.`, retryable: true,
  };
  // One signal covers the headers and the body, so a stalled server cannot hang the CLI.
  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await doFetch(`${opts.api}/v1/libraries/${encodeURIComponent(opts.libraryId)}`, {
      headers: {
        Authorization: `Bearer ${opts.key}`,
        'User-Agent': userAgent(),
        ...(opts.etag ? { 'If-None-Match': `"${opts.etag}"` } : {}),
      },
      signal,
    });
  } catch (err) {
    if (isTimeout(err)) return timedOut;
    const code = causeCode(err);
    return {
      kind: 'error',
      message: `Could not reach ${opts.api}${code ? ` (${code})` : ''}.${reachHint(code, opts.env ?? process.env)}`,
      retryable: true,
    };
  }
  const version = res.headers.get('X-Library-Version');
  if (res.status === 304) return { kind: 'not_modified', version };
  if (res.status === 401) {
    return {
      kind: 'error',
      message: 'Key was rotated or revoked. Run the setup command from the plugin\'s '
        + 'Publish screen to store the current key.',
      retryable: false,
    };
  }
  if (res.status === 404) return { kind: 'error', message: 'Library not found. It may have been unpublished.', retryable: false };
  if (res.status === 429 || res.status >= 500) {
    const wait = retryAfterMs(res.headers.get('retry-after'), Date.now());
    return {
      kind: 'error',
      message: res.status === 429
        ? `${opts.api} is rate limiting requests from this address. Try again in a minute.`
        : `Request failed with HTTP ${res.status}.`,
      retryable: true,
      ...(wait !== null ? { retryAfterMs: wait } : {}),
    };
  }
  if (!res.ok) return { kind: 'error', message: `Request failed with HTTP ${res.status}.`, retryable: false };
  const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;
  let raw: string;
  try {
    const read = await readCapped(res, maxBytes);
    if (read === 'too_large') {
      return { kind: 'error', message: `The response from ${opts.api} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, far past any published library. Check --api or SPEC_LAYER_API.`, retryable: false };
    }
    raw = read;
  } catch (err) {
    return isTimeout(err)
      ? timedOut
      : { kind: 'error', message: `The response from ${opts.api} could not be read.`, retryable: true };
  }
  return {
    kind: 'ok',
    raw,
    publishedAt: res.headers.get('X-Published-At') ?? 'unknown',
    bundleHash: createHash('sha256').update(raw).digest('hex'),
    version,
  };
}

/** The waits before the second and third attempts; jittered by up to half again. */
export const RETRY_DELAYS_MS = [1000, 3000] as const;
/** A Retry-After longer than this is not waited out; the error is reported instead. */
export const MAX_RETRY_WAIT_MS = 30_000;

export interface RetryOptions {
  /** How many retries after the first attempt; SPEC_LAYER_RETRIES, default 2. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** One line per retry, to stderr in the CLI. */
  onRetry?: (message: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** SPEC_LAYER_RETRIES as a count, or the default when unset or not a small whole number. */
export function retriesFromEnv(env: Record<string, string | undefined>): number {
  const raw = env.SPEC_LAYER_RETRIES;
  return raw !== undefined && /^\d$/.test(raw.trim()) ? Number(raw.trim()) : RETRY_DELAYS_MS.length;
}

/**
 * `fetchBundle` with retries on what a retry can fix: no connection, a
 * timeout, a 5xx, or a 429. Each attempt has its own deadline. A Retry-After
 * the server sends is honoured up to MAX_RETRY_WAIT_MS; past that the error
 * is reported now rather than holding a CI job.
 */
export async function fetchBundleWithRetry(opts: FetchBundleOptions, retry: RetryOptions = {}): Promise<FetchBundleResult> {
  const retries = retry.retries ?? RETRY_DELAYS_MS.length;
  const sleep = retry.sleep ?? defaultSleep;
  const random = retry.random ?? Math.random;
  let result = await fetchBundle(opts);
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (result.kind !== 'error' || !result.retryable) return result;
    const base = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    const wait = result.retryAfterMs ?? Math.round(base * (1 + random() / 2));
    if (wait > MAX_RETRY_WAIT_MS) return result;
    retry.onRetry?.(`${result.message} Retrying in ${Math.max(1, Math.round(wait / 1000))} s (${attempt + 1} of ${retries}).`);
    await sleep(wait);
    result = await fetchBundle(opts);
  }
  return result;
}
