import {
  FOUNDATION_SYSTEM_PROMPT,
  PROSE_SYSTEM_PROMPT,
  proseFewShot,
} from '@spec-layer/extractor';
import { identityFromHeaders, licenseIdentityId } from './identity';
import { handlePublish, handlePull, handleRotate } from './libraries';
import { activateLicense, checkLicense, deactivateLicense, validateLicense, LICENSE_KEY_RE, LsUnreachable, type KVLike, type LicenseResult } from './license';
import type { QuotaSnapshot, ReserveResult, Tier } from './quota';
import type { SlidingWindowLimiter } from './ratelimit';

export { licenseIdentityId };

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
  licenseLimiter: SlidingWindowLimiter;
  requestLimiter: SlidingWindowLimiter;
  /** Library bundle storage. Wired to the same KV namespace as licenseCache
   *  today; a separate dep so a dedicated namespace later is a one-line change. */
  libraryStore: KVLike;
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

interface ProseRequest {
  model?: unknown;
  max_tokens?: unknown;
  system?: unknown;
  messages?: unknown;
}

interface ProseBody {
  cacheKey?: unknown;
  request?: ProseRequest;
}

const MAX_PROXY_BODY_CHARS = 7_000_000;
const MAX_IMAGE_BASE64_CHARS = 6_500_000;
const MAX_PROMPT_CHARS = 100_000;
const BODY_FIELDS = new Set(['cacheKey', 'request']);
const REQUEST_FIELDS = new Set(['model', 'max_tokens', 'system', 'messages']);

function hasOnlyFields(value: Record<string, unknown>, fields: Set<string>): boolean {
  return Object.keys(value).every((key) => fields.has(key));
}

function componentPrompt(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.length !== 2) return null;
  const [image, text] = content;
  if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
  if (!text || typeof text !== 'object' || Array.isArray(text)) return null;

  const imageBlock = image as Record<string, unknown>;
  const textBlock = text as Record<string, unknown>;
  if (!hasOnlyFields(imageBlock, new Set(['type', 'source']))) return null;
  if (!hasOnlyFields(textBlock, new Set(['type', 'text']))) return null;
  if (imageBlock.type !== 'image' || textBlock.type !== 'text' || typeof textBlock.text !== 'string') {
    return null;
  }

  const source = imageBlock.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const sourceRecord = source as Record<string, unknown>;
  if (!hasOnlyFields(sourceRecord, new Set(['type', 'media_type', 'data']))) return null;
  if (
    sourceRecord.type !== 'base64' ||
    !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(sourceRecord.media_type)) ||
    typeof sourceRecord.data !== 'string' ||
    sourceRecord.data.length === 0 ||
    sourceRecord.data.length > MAX_IMAGE_BASE64_CHARS
  ) {
    return null;
  }
  return textBlock.text;
}

/**
 * The proxy must not be usable as a generic Anthropic relay.
 *
 * Exported so a client can be tested against the real rules rather than against
 * a guess at them. The cacheKey prefix in particular is a contract a client
 * cannot discover by reading its own code.
 */
export function validateProseBody(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'invalid body';
  const record = body as Record<string, unknown>;
  if (!hasOnlyFields(record, BODY_FIELDS)) return 'unexpected body field';
  const typed = body as ProseBody;
  if (typeof typed.cacheKey !== 'string' || !/^prose:v\d+:/.test(typed.cacheKey)) return 'bad cacheKey';
  const r = typed.request;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'missing request';
  if (!hasOnlyFields(r as Record<string, unknown>, REQUEST_FIELDS)) return 'unexpected request field';
  if (r.model !== 'claude-haiku-4-5') return 'model not allowed';
  if (!Number.isInteger(r.max_tokens) || (r.max_tokens as number) <= 0 || (r.max_tokens as number) > 3000) {
    return 'invalid max_tokens';
  }
  if (!Array.isArray(r.messages)) return 'missing messages';

  const isGroups = typed.cacheKey.includes(':groups:');
  if (isGroups) {
    if (r.system !== FOUNDATION_SYSTEM_PROMPT) return 'system not allowed';
    if (r.max_tokens !== 1200) return 'max_tokens not allowed';
    if (r.messages.length !== 1) return 'invalid messages';
    const message = r.messages[0] as Record<string, unknown> | null;
    if (
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      !hasOnlyFields(message, new Set(['role', 'content'])) ||
      message.role !== 'user' ||
      typeof message.content !== 'string' ||
      message.content.length > MAX_PROMPT_CHARS ||
      !message.content.startsWith('Collection: ') ||
      !message.content.includes('\nGroups to describe:\n') ||
      !message.content.includes('\nReturn JSON: ')
    ) {
      return 'invalid messages';
    }
    return null;
  }

  if (r.system !== PROSE_SYSTEM_PROMPT) return 'system not allowed';
  if (r.max_tokens !== 3000) return 'max_tokens not allowed';
  if (r.messages.length !== 3) return 'invalid messages';
  const [expectedUser, expectedAssistant] = proseFewShot();
  const [user, assistant, final] = r.messages as Array<Record<string, unknown> | null>;
  if (
    !user ||
    !assistant ||
    !final ||
    !hasOnlyFields(user, new Set(['role', 'content'])) ||
    !hasOnlyFields(assistant, new Set(['role', 'content'])) ||
    !hasOnlyFields(final, new Set(['role', 'content'])) ||
    user.role !== expectedUser.role ||
    user.content !== expectedUser.content ||
    assistant.role !== expectedAssistant.role ||
    assistant.content !== expectedAssistant.content ||
    final.role !== 'user'
  ) {
    return 'invalid messages';
  }
  const prompt = componentPrompt(final.content);
  if (
    !prompt ||
    prompt.length > MAX_PROMPT_CHARS ||
    !prompt.startsWith('Component: ') ||
    !prompt.includes('\nReturn ONLY a JSON object with these keys: ')
  ) {
    return 'invalid messages';
  }
  return null;
}

export async function handleProse(req: Request, deps: HandlerDeps): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.requestLimiter.allow(`prose:${ip}`, deps.now())) {
    return json(429, { error: 'rate_limited' });
  }
  const identity = identityFromHeaders(req.headers, deps.salt);
  if (!identity) return json(401, { error: 'unauthenticated' });

  const declaredLength = Number(req.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_PROXY_BODY_CHARS) return json(413, { error: 'request_too_large' });
  let rawBody: string;
  try { rawBody = await req.text(); } catch { return json(400, { error: 'invalid body' }); }
  if (rawBody.length > MAX_PROXY_BODY_CHARS) return json(413, { error: 'request_too_large' });
  let body: ProseBody;
  try { body = JSON.parse(rawBody) as ProseBody; } catch { return json(400, { error: 'invalid json' }); }
  const invalid = validateProseBody(body);
  if (invalid) return json(400, { error: invalid });
  const cacheKey = body.cacheKey as string;

  let tier: Tier = 'free';
  let identityId: string;
  if (identity.kind === 'license') {
    const lic = await checkLicense(identity.key, identity.instanceId, { fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now });
    if (lic.tier !== 'pro') return json(401, { error: 'license_not_active', reason: lic.reason });
    tier = 'pro';
    identityId = licenseIdentityId(identity.key);
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
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.requestLimiter.allow(`quota:${ip}`, deps.now())) {
    return json(429, { error: 'rate_limited' });
  }
  const identity = identityFromHeaders(req.headers, deps.salt);
  if (!identity) return json(401, { error: 'unauthenticated' });
  let tier: Tier = 'free';
  let identityId: string;
  let licResult: LicenseResult | null = null;
  if (identity.kind === 'license') {
    licResult = await checkLicense(identity.key, identity.instanceId, { fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now });
    tier = licResult.tier === 'pro' ? 'pro' : 'free';
    identityId = licenseIdentityId(identity.key);
  } else {
    identityId = `free:${identity.id}`;
  }
  const s = await deps.quotaFor(identityId).snapshot(tier);
  if (identity.kind === 'license' && tier === 'free') {
    // licResult is always non-null here: the `identity.kind === 'license'` branch above
    // always assigns it. The `licResult &&` guard exists only to satisfy TS control-flow
    // analysis (it can't see that `tier === 'free'` implies the license branch ran).
    return json(200, { ...s, licenseReason: licResult && licResult.tier === 'free' ? licResult.reason : undefined });
  }
  return json(200, s);
}

export async function handleActivate(req: Request, deps: HandlerDeps): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.licenseLimiter.allow(ip, deps.now())) {
    return json(429, { error: 'rate_limited' });
  }
  let body: { key?: unknown; instanceName?: unknown; instanceId?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return json(400, { error: 'invalid json' }); }
  if (typeof body.key !== 'string' || !body.key) return json(400, { error: 'missing key' });
  if (!LICENSE_KEY_RE.test(body.key)) return json(200, { valid: false, status: 'invalid' });
  const licenseDeps = { fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now };
  try {
    // Repeat activation on a known device: validate the existing instance rather
    // than calling activate again (which would consume another device slot).
    if (typeof body.instanceId === 'string' && body.instanceId) {
      const v = await validateLicense(body.key, body.instanceId, licenseDeps);
      return json(200, { valid: v.valid, status: v.status, instanceId: body.instanceId });
    }
    const out = await activateLicense(body.key, typeof body.instanceName === 'string' ? body.instanceName : 'Figma plugin', licenseDeps);
    return json(200, out);
  } catch (err) {
    if (err instanceof LsUnreachable) return json(502, { error: 'ls_unreachable' });
    throw err;
  }
}

export async function handleDeactivate(req: Request, deps: HandlerDeps): Promise<Response> {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (!deps.licenseLimiter.allow(ip, deps.now())) return json(429, { error: 'rate_limited' });
  let body: { key?: unknown; instanceId?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return json(400, { error: 'invalid json' }); }
  if (typeof body.key !== 'string' || !LICENSE_KEY_RE.test(body.key)) return json(400, { error: 'missing key' });
  if (typeof body.instanceId !== 'string' || !body.instanceId) return json(400, { error: 'missing instanceId' });
  try {
    const out = await deactivateLicense(body.key, body.instanceId, { fetcher: deps.fetcher, cache: deps.licenseCache, now: deps.now });
    return json(200, out);
  } catch (err) {
    if (err instanceof LsUnreachable) return json(502, { error: 'ls_unreachable' });
    throw err;
  }
}

const CORS_HEADERS: Record<string, string> = {
  // Figma plugin iframes run with Origin: null — '*' (with header-based auth,
  // no cookies) is the correct and safe setting here.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Figma-User, If-None-Match',
  // Without this, the plugin iframe cannot read the quota headers at all.
  'Access-Control-Expose-Headers':
    'X-Tier, X-Quota-Used, X-Quota-Limit, X-Quota-Remaining, X-Quota-Resets-At, ETag, X-Published-At',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

async function routeInner(req: Request, deps: HandlerDeps): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (req.method === 'POST' && pathname === '/v1/prose') return handleProse(req, deps);
  if (req.method === 'GET' && pathname === '/v1/quota') return handleQuota(req, deps);
  if (req.method === 'POST' && pathname === '/v1/license/activate') return handleActivate(req, deps);
  if (req.method === 'POST' && pathname === '/v1/license/deactivate') return handleDeactivate(req, deps);
  if (req.method === 'POST' && pathname === '/v1/libraries') return handlePublish(req, deps);
  const pull = /^\/v1\/libraries\/(lib_[0-9a-f]{24})$/.exec(pathname);
  if (req.method === 'GET' && pull) return handlePull(req, deps, pull[1]);
  const rotate = /^\/v1\/libraries\/(lib_[0-9a-f]{24})\/rotate$/.exec(pathname);
  if (req.method === 'POST' && rotate) return handleRotate(req, deps, rotate[1]);
  return json(404, { error: 'not_found' });
}

export async function route(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  return withCors(await routeInner(req, deps));
}
