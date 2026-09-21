import {
  FOUNDATION_SYSTEM_PROMPT,
  PROSE_SYSTEM_PROMPT, PROSE_MAX_TOKENS, proseFewShot,
  LEGACY_PROSE_SYSTEM_PROMPT, LEGACY_PROSE_MAX_TOKENS, LEGACY_GROUP_MAX_TOKENS, legacyProseFewShot,
  LEGACY_FOUNDATION_SYSTEM_PROMPT,
  GROUP_MAX_TOKENS,
} from '@spec-layer/extractor';
import { identityFromHeaders, licenseIdentityId, callerProofs } from './identity';
import { handlePublish, handlePull, handleRotate, handleVersions } from './libraries';
import { activateLicense, checkLicense, deactivateLicense, validateLicense, LICENSE_KEY_RE, LsUnreachable, type KVLike, type LicenseResult, type LibraryStore } from './license';
import { quotaHeaders } from './quota';
import type { QuotaProfile, QuotaSnapshot, ReserveResult, Tier } from './quota';
import type { SlidingWindowLimiter } from './ratelimit';

export { licenseIdentityId };
export type { QuotaProfile };

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
  /** One engine per identity and profile. `profile` defaults to 'ai'. */
  quotaFor(identityId: string, profile?: QuotaProfile): QuotaClient;
  log(event: string, fields: Record<string, unknown>): void;
  licenseLimiter: SlidingWindowLimiter;
  requestLimiter: SlidingWindowLimiter;
  /** Library bundle storage. Wired to the same KV namespace as licenseCache
   *  today; a separate dep so a dedicated namespace later is a one-line change. */
  libraryStore: LibraryStore;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

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

/** The model each proved tier writes with. The plugin never names one. */
export const MODEL_BY_TIER: Record<Tier, string> = { pro: 'claude-sonnet-5', free: 'claude-haiku-4-5' };
/** Sonnet 5 runs adaptive thinking when the field is omitted and bills it as
 *  output; low effort keeps that small for a formatting-heavy JSON task. Haiku
 *  4.5 rejects `output_config.effort`, so free gets nothing extra. */
export const PRO_OUTPUT_CONFIG = { effort: 'low' } as const;

export interface ProseKeyInfo { version: number; kind: 'component' | 'groups'; tier: Tier | null }

/**
 * `prose:v9:pro:<hash>...`, `prose:v3:groups:free:<hash>...`, or the shipped
 * v8 / groups v1 shapes with no tier. Null for anything else.
 */
export function parseProseCacheKey(key: string): ProseKeyInfo | null {
  const m = /^prose:v(\d+):(groups:)?(?:(pro|free):)?[^:]/.exec(key);
  if (!m) return null;
  const version = Number(m[1]);
  const kind = m[2] ? 'groups' : 'component';
  const tier = (m[3] as Tier | undefined) ?? null;
  // The v2 groups key never shipped (Plan 2 merged and Plan 3 replaced it before
  // a release), so nothing legitimate sends it; refusing it keeps its cache
  // entries from ever answering a v3 request.
  if (kind === 'groups' && version === 2) return null;
  const legacy = (kind === 'component' && version <= 8) || (kind === 'groups' && version <= 1);
  if (legacy && tier !== null) return null;
  if (!legacy && tier === null) return null;
  return { version, kind, tier };
}

/** The body forwarded to Anthropic: the client's request plus what only the
 *  server may decide. A legacy request already names its model. */
export function upstreamRequest(request: Record<string, unknown>, tier: Tier, legacy: boolean): Record<string, unknown> {
  if (legacy) return request;
  return { ...request, model: MODEL_BY_TIER[tier], ...(tier === 'pro' ? { output_config: PRO_OUTPUT_CONFIG } : {}) };
}

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
  if (typeof typed.cacheKey !== 'string') return 'bad cacheKey';
  const info = parseProseCacheKey(typed.cacheKey);
  if (!info) return 'bad cacheKey';
  const r = typed.request;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'missing request';
  if (!hasOnlyFields(r as Record<string, unknown>, REQUEST_FIELDS)) return 'unexpected request field';
  const legacy = info.tier === null;
  if (legacy) {
    if (r.model !== 'claude-haiku-4-5') return 'model not allowed';
  } else if ('model' in (r as Record<string, unknown>)) {
    return 'model not allowed';
  }
  if (!Number.isInteger(r.max_tokens) || (r.max_tokens as number) <= 0) return 'invalid max_tokens';
  if (!Array.isArray(r.messages)) return 'missing messages';

  if (info.kind === 'groups') {
    // The foundation prompt has its own counter, GROUP_PROMPT_VERSION, which is
    // not the component prose one: its v2 added the collection-overview rule and
    // its v3 rewrote the prompt as one block per collection and raised the cap.
    // Every one of those is different bytes from what shipped, and a 5.1.0
    // client keeps sending the shipped ones under a groups v1 key, so the legacy
    // branch compares against the frozen copies. Without them every shipped
    // foundation build loses its AI descriptions the moment this deploys.
    if (r.system !== (legacy ? LEGACY_FOUNDATION_SYSTEM_PROMPT : FOUNDATION_SYSTEM_PROMPT)) return 'system not allowed';
    if (r.max_tokens !== (legacy ? LEGACY_GROUP_MAX_TOKENS : GROUP_MAX_TOKENS)) return 'max_tokens not allowed';
    if (r.messages.length !== 1) return 'invalid messages';
    const message = r.messages[0] as Record<string, unknown> | null;
    if (
      !message || typeof message !== 'object' || Array.isArray(message) ||
      !hasOnlyFields(message, new Set(['role', 'content'])) ||
      message.role !== 'user' || typeof message.content !== 'string' ||
      message.content.length > MAX_PROMPT_CHARS ||
      !message.content.startsWith('Collection: ') ||
      // Not `:\n`: a collection with no groups writes `Groups to describe: none`
      // on one line, and a build can be nothing but such collections.
      !message.content.includes('\nGroups to describe:') ||
      !message.content.includes('\nReturn JSON: ')
    ) return 'invalid messages';
    return null;
  }

  if (r.system !== (legacy ? LEGACY_PROSE_SYSTEM_PROMPT : PROSE_SYSTEM_PROMPT)) return 'system not allowed';
  if (r.max_tokens !== (legacy ? LEGACY_PROSE_MAX_TOKENS : PROSE_MAX_TOKENS)) return 'max_tokens not allowed';
  if (r.messages.length !== 3) return 'invalid messages';
  const [expectedUser, expectedAssistant] = legacy ? legacyProseFewShot() : proseFewShot();
  const [user, assistant, final] = r.messages as Array<Record<string, unknown> | null>;
  if (
    !user || !assistant || !final ||
    !hasOnlyFields(user, new Set(['role', 'content'])) ||
    !hasOnlyFields(assistant, new Set(['role', 'content'])) ||
    !hasOnlyFields(final, new Set(['role', 'content'])) ||
    user.role !== expectedUser.role ||
    !sameContent(user.content, expectedUser.content) ||
    assistant.role !== expectedAssistant.role ||
    !sameContent(assistant.content, expectedAssistant.content) ||
    final.role !== 'user'
  ) return 'invalid messages';
  const prompt = componentPrompt(final.content);
  if (
    !prompt || prompt.length > MAX_PROMPT_CHARS ||
    !prompt.startsWith('Component: ') ||
    !prompt.includes('\nReturn ONLY a JSON object with these keys: ')
  ) return 'invalid messages';
  return null;
}

/**
 * Byte-for-byte equality of a message's content with the shipped one, whether
 * it is a string or a block array. JSON.stringify is stable for the shapes the
 * extractor builds (a fixed key order in a literal), and the expected side is
 * built by the same code, so a serialized comparison is exact here. It is also
 * how the one allowed `cache_control` is pinned to its position: any other
 * placement changes the bytes and fails.
 */
function sameContent(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
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

  // The key names the tier the client believes it has, and the generated answer
  // is cached under it. A key that disagrees with the proof would let a Pro user
  // be served a Haiku draft (or the reverse), so it is refused before any quota
  // is reserved rather than quietly answered from the wrong bucket.
  const keyInfo = parseProseCacheKey(cacheKey)!; // validated above
  if (keyInfo.tier !== null && keyInfo.tier !== tier) return json(400, { error: 'tier mismatch' });

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
      body: JSON.stringify(upstreamRequest(body.request as Record<string, unknown>, tier, keyInfo.tier === null)),
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
  const proofs = callerProofs(req.headers, deps.salt);
  const figmaId = proofs.figmaHash ? `free:${proofs.figmaHash}` : null;
  // Same rule as `resolveCaller`'s `tierIdentity` in libraries.ts: Pro counts
  // under the license, free under the Figma identity. The two must agree, or
  // this meter reports a different bucket than a publish spends from.
  const publishIdentity = tier === 'pro' ? identityId : (figmaId ?? identityId);
  const publish = await deps.quotaFor(publishIdentity, 'publish').snapshot(tier);
  const s = await deps.quotaFor(identityId).snapshot(tier);
  if (identity.kind === 'license' && tier === 'free') {
    // licResult is always non-null here: the `identity.kind === 'license'` branch above
    // always assigns it. The `licResult &&` guard exists only to satisfy TS control-flow
    // analysis (it can't see that `tier === 'free'` implies the license branch ran).
    return json(200, { ...s, publish, licenseReason: licResult && licResult.tier === 'free' ? licResult.reason : undefined });
  }
  return json(200, { ...s, publish });
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
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Figma-User, X-Pull-Key, If-None-Match',
  // Without this, the plugin iframe cannot read the quota headers at all.
  'Access-Control-Expose-Headers':
    'X-Tier, X-Quota-Used, X-Quota-Limit, X-Quota-Remaining, X-Quota-Resets-At, ETag, X-Published-At, X-Library-Version',
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
  const versions = /^\/v1\/libraries\/(lib_[0-9a-f]{24})\/versions$/.exec(pathname);
  if (req.method === 'GET' && versions) return handleVersions(req, deps, versions[1]);
  return json(404, { error: 'not_found' });
}

export async function route(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  try {
    return withCors(await routeInner(req, deps));
  } catch (err) {
    // The last line of defence: an uncaught throw from any handler must still
    // answer with CORS headers, or the plugin sees an opaque network failure
    // instead of a real status. Handlers that need a more specific answer
    // (activation's 502 on an unreachable Lemon Squeezy, say) catch their own
    // errors before this ever runs; this is only for what nothing else caught.
    deps.log('internal_error', { message: err instanceof Error ? err.message : String(err) });
    return withCors(json(500, { error: 'internal' }));
  }
}
