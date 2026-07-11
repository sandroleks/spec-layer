import { identityFromHeaders } from './identity';
import { activateLicense, checkLicense, type KVLike } from './license';
import type { QuotaSnapshot, ReserveResult, Tier } from './quota';

export interface QuotaClient {
  reserve(tier: Tier, cacheKey: string): Promise<ReserveResult>;
  commit(cacheKey: string, body: string): Promise<void>;
  release(cacheKey: string): Promise<void>;
  snapshot(tier: Tier): Promise<QuotaSnapshot>;
}

export interface HandlerDeps {
  salt: string;
  anthropicKey: string;
  fetcher: typeof fetch;
  licenseCache: KVLike;
  now(): number;
  quotaFor(identityId: string): QuotaClient;
  log(event: string, fields: Record<string, unknown>): void;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function quotaHeaders(s: QuotaSnapshot): Record<string, string> {
  return {
    'X-Tier': s.tier,
    'X-Quota-Used': String(s.used),
    'X-Quota-Limit': s.limit === null ? 'unlimited' : String(s.limit),
    'X-Quota-Remaining': s.remaining === null ? 'unlimited' : String(s.remaining),
    'X-Quota-Resets-At': s.resetsAt,
  };
}

interface ProseBody {
  cacheKey?: unknown;
  request?: { model?: unknown; max_tokens?: unknown; messages?: unknown };
}

/** The proxy must not be usable as a generic Anthropic relay. */
function validateProseBody(body: ProseBody): string | null {
  if (typeof body.cacheKey !== 'string' || !/^prose:v\d+:/.test(body.cacheKey)) return 'bad cacheKey';
  const r = body.request;
  if (!r || typeof r !== 'object') return 'missing request';
  if (r.model !== 'claude-haiku-4-5') return 'model not allowed';
  if (typeof r.max_tokens !== 'number' || r.max_tokens > 3000) return 'max_tokens too large';
  if (!Array.isArray(r.messages)) return 'missing messages';
  return null;
}

export async function handleProse(req: Request, deps: HandlerDeps): Promise<Response> {
  const identity = identityFromHeaders(req.headers, deps.salt);
  if (!identity) return json(401, { error: 'unauthenticated' });

  let body: ProseBody;
  try { body = (await req.json()) as ProseBody; } catch { return json(400, { error: 'invalid json' }); }
  const invalid = validateProseBody(body);
  if (invalid) return json(400, { error: invalid });
  const cacheKey = body.cacheKey as string;

  let tier: Tier = 'free';
  let identityId: string;
  if (identity.kind === 'license') {
    const lic = await checkLicense(identity.key, { fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now });
    if (lic.tier !== 'pro') return json(401, { error: 'license_not_active', reason: lic.reason });
    tier = 'pro';
    identityId = `lic:${identity.key}`;
  } else {
    identityId = `free:${identity.id}`;
  }

  const quota = deps.quotaFor(identityId);
  const reserved = await quota.reserve(tier, cacheKey);

  switch (reserved.kind) {
    case 'cached': {
      const s = await quota.snapshot(tier);
      return new Response(reserved.body, { status: 200, headers: { 'content-type': 'application/json', ...quotaHeaders(s) } });
    }
    case 'pending':
      return json(409, { error: 'generation_pending' });
    case 'exhausted':
      return json(402, { error: 'quota_exhausted', resetsAt: reserved.resetsAt });
    case 'rate_limited':
      return json(429, { error: 'rate_limited', retryAfterMs: reserved.retryAfterMs });
    case 'proceed':
      break;
    default:
      // Fail closed: a ReserveResult variant this switch doesn't know must
      // never reach the upstream call.
      return json(500, { error: 'internal' });
  }
  if (reserved.kind === 'proceed' && reserved.flagged) {
    deps.log('fair_use_flag', { identityId, tier }); // counters only — never content
  }

  let upstream: Response;
  try {
    upstream = await deps.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': deps.anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body.request),
    });
  } catch {
    await quota.release(cacheKey);
    return json(502, { error: 'upstream_unreachable' });
  }

  if (!upstream.ok) {
    await quota.release(cacheKey);
    deps.log('upstream_error', { status: upstream.status });
    return json(502, { error: 'upstream_error', status: upstream.status });
  }

  const text = await upstream.text();
  await quota.commit(cacheKey, text);
  const s = await quota.snapshot(tier);
  return new Response(text, { status: 200, headers: { 'content-type': 'application/json', ...quotaHeaders(s) } });
}

export async function handleQuota(req: Request, deps: HandlerDeps): Promise<Response> {
  const identity = identityFromHeaders(req.headers, deps.salt);
  if (!identity) return json(401, { error: 'unauthenticated' });
  let tier: Tier = 'free';
  let identityId: string;
  if (identity.kind === 'license') {
    const lic = await checkLicense(identity.key, { fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now });
    tier = lic.tier === 'pro' ? 'pro' : 'free';
    identityId = `lic:${identity.key}`;
  } else {
    identityId = `free:${identity.id}`;
  }
  const s = await deps.quotaFor(identityId).snapshot(tier);
  return json(200, s);
}

export async function handleActivate(req: Request, deps: HandlerDeps): Promise<Response> {
  let body: { key?: unknown; instanceName?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return json(400, { error: 'invalid json' }); }
  if (typeof body.key !== 'string' || !body.key) return json(400, { error: 'missing key' });
  const out = await activateLicense(body.key, typeof body.instanceName === 'string' ? body.instanceName : 'Figma plugin', {
    fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now,
  });
  return json(200, out);
}

export async function route(req: Request, deps: HandlerDeps): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (req.method === 'POST' && pathname === '/v1/prose') return handleProse(req, deps);
  if (req.method === 'GET' && pathname === '/v1/quota') return handleQuota(req, deps);
  if (req.method === 'POST' && pathname === '/v1/license/activate') return handleActivate(req, deps);
  return json(404, { error: 'not_found' });
}
