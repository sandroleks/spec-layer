import type { IntermediateSpec } from '../extract';
import { contentHash } from '../hash';
import {
  parseProseResponse,
  PROSE_SYSTEM_PROMPT,
  PROSE_MAX_TOKENS,
  buildProsePrompt,
  proseFewShot,
  type ProseRequestMessage,
} from './promptV2';
import { validateProseV2, type ProseV2Key, type ProseValidation } from './v2';
import {
  FOUNDATION_SYSTEM_PROMPT,
  buildGroupPrompt,
  parseGroupDraft,
  type GroupDraft,
  type GroupDraftInput,
} from './foundationPrompt';

/**
 * Bump whenever the prompt, system prompt, or few-shot changes the produced
 * voice: part of the cache key, so an old-voice draft is never served. v9 is
 * the structured ProseV2 contract.
 */
export const PROSE_PROMPT_VERSION = 'v9';

/** The proxy picks the model from the tier it proves. The client names the tier
 *  in the cache key only, and the proxy rejects a key whose tier disagrees. */
export type ProseTier = 'pro' | 'free';

/**
 * Hashes the rendered prompt, so the key moves on EXACTLY what the model sees.
 * The proxy meters generations per unknown key, so any hashed field that does
 * not reach the prompt is a billed regeneration of identical prose.
 *
 * NOT specContentHash: that flattens anatomy to depth 0, but nested parts reach
 * the prompt, so it would serve a stale draft. Do not merge the two.
 */
function proseInputHash(spec: IntermediateSpec, requested?: ReadonlySet<ProseV2Key>): string {
  return contentHash(buildProsePrompt(spec, requested));
}

/**
 * The cache key for a prose draft, shared by writer and readers so it is never
 * built two ways. The tier follows the version because the tiers are written by
 * different models: a shared key would replay a Haiku draft to a Pro user.
 */
export function proseCacheKey(
  spec: IntermediateSpec,
  opts: { tier: ProseTier; image?: boolean; keys?: readonly ProseV2Key[] | undefined },
): string {
  // Sorted, so key order does not split one request into two entries.
  const keySig = opts.keys && opts.keys.length ? `:keys=${[...opts.keys].sort().join(',')}` : '';
  // Hashed because the prompt varies with it; keySig only keeps logs readable.
  const requested = opts.keys && opts.keys.length ? new Set(opts.keys) : undefined;
  return `prose:${PROSE_PROMPT_VERSION}:${opts.tier}:${proseInputHash(spec, requested)}${opts.image ? ':img' : ''}${keySig}`;
}

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface ProxyQuota {
  tier: 'free' | 'pro';
  used: number;
  limit: number | null;
  remaining: number | null;
  resetsAt: string;
  /** Why a stored key is not granting pro; license identities only. */
  licenseReason?: 'invalid' | 'expired' | 'inactive' | 'unreachable' | undefined;
  /** Library publish allowance, same shape. Absent from proxies that predate it. */
  publish?: { tier: 'free' | 'pro'; used: number; limit: number | null; remaining: number | null; resetsAt: string };
}

export type ProseProxyErrorCode =
  | 'quota_exhausted' | 'rate_limited' | 'generation_pending'
  | 'license_not_active' | 'bad_request' | 'upstream';

/** The plugin branches on `code` (402 → upsell, etc.). */
export class ProseProxyError extends Error {
  constructor(public code: ProseProxyErrorCode, public resetsAt?: string, public reason?: string) {
    super(code);
    this.name = 'ProseProxyError';
  }
}

const PROXY_ERROR_BY_STATUS: Record<number, ProseProxyErrorCode> = {
  400: 'bad_request', 401: 'license_not_active', 402: 'quota_exhausted',
  409: 'generation_pending', 429: 'rate_limited',
};

/**
 * The slice of the Fetch API the prose client uses. The extractor compiles
 * with no host's types (no DOM, no Node, no Figma), and any host's `fetch`,
 * the UI iframe's, Node's or a test double, fits these shapes.
 */
export interface FetchHeaders { get(name: string): string | null }
export interface FetchResponse {
  ok: boolean;
  status: number;
  headers: FetchHeaders;
  json(): Promise<unknown>;
}
export type Fetcher = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

/** The `X-Tier` / `X-Quota-*` headers, or null when absent. Publish responses
 *  carry them too, for the publish allowance. */
export function parseQuotaHeaders(headers: FetchHeaders): ProxyQuota | null {
  const tier = headers.get('X-Tier');
  if (tier !== 'free' && tier !== 'pro') return null;
  const num = (v: string | null): number | null =>
    v === null || v === 'unlimited' ? null : Number(v);
  return {
    tier,
    used: Number(headers.get('X-Quota-Used') ?? 0),
    limit: num(headers.get('X-Quota-Limit')),
    remaining: num(headers.get('X-Quota-Remaining')),
    resetsAt: headers.get('X-Quota-Resets-At') ?? '',
  };
}

export interface DraftOptions {
  apiKey: string | null;
  fetcher: Fetcher;
  cacheStore: CacheStore;
  /** A rendered component image URL, attached as an image block; absent sends text only. */
  imageUrl?: string | null | undefined;
  /** Base64 component image (plugin path); in practice exclusive with imageUrl. */
  imageBase64?: string | null | undefined;
  imageMediaType?: string | undefined; // e.g. 'image/png'
  /** Omit to request the full set. */
  requested?: ReadonlySet<ProseV2Key> | undefined;
  /** Every component name in the file, for the whenNotToUse rule in `validateProseV2`. */
  fileComponents?: readonly string[] | undefined;
  /** Routes through the Spec Layer proxy and ignores `apiKey`. licenseKey (pro)
   *  wins over figmaUserId (free). onQuota fires on every successful response. */
  proxy?: {
    url: string;
    licenseKey?: string | null;
    licenseInstanceId?: string | null;
    figmaUserId?: string | null;
    onQuota?: ((q: ProxyQuota) => void) | undefined;
  };
}

/**
 * The transport half of every prose call (proxy or direct key, auth, quota
 * headers, error mapping), shared so the two prompts never bill or fail
 * differently.
 */
async function postCompletion(
  requestBody: unknown,
  cacheKey: string,
  opts: Pick<DraftOptions, 'apiKey' | 'fetcher' | 'proxy'>,
): Promise<string> {
  let res: FetchResponse;
  if (opts.proxy) {
    const bearer = opts.proxy.licenseKey
      ? opts.proxy.licenseInstanceId
        ? `${opts.proxy.licenseKey}:${opts.proxy.licenseInstanceId}`
        : opts.proxy.licenseKey
      : null;
    const auth: Record<string, string> = bearer
      ? { Authorization: `Bearer ${bearer}` }
      : { 'X-Figma-User': opts.proxy.figmaUserId ?? '' };
    res = await opts.fetcher(`${opts.proxy.url}/v1/prose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ cacheKey, request: requestBody }),
    });
    if (!res.ok) {
      const code = PROXY_ERROR_BY_STATUS[res.status] ?? 'upstream';
      let resetsAt: string | undefined;
      let reason: string | undefined;
      try {
        const b = (await res.json()) as { resetsAt?: string; reason?: string };
        resetsAt = b.resetsAt;
        reason = b.reason;
      } catch { /* body optional */ }
      throw new ProseProxyError(code, resetsAt, reason);
    }
    const quota = parseQuotaHeaders(res.headers);
    if (quota && opts.proxy.onQuota) opts.proxy.onQuota(quota);
  } else {
    res = await opts.fetcher('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey as string,
        'anthropic-version': '2023-06-01',
        // Required: the request originates from the Figma plugin UI iframe (browser context).
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(requestBody),
    });
    if (!res.ok) throw new Error(`Claude API error ${res.status}`);
  }

  const data = await res.json() as {
    content?: Array<{ type?: unknown; text?: unknown }>;
  };
  return answerText(data);
}

/**
 * The text of the first block carrying a string `text`. Not `content[0]`:
 * Sonnet 5 and 5.5 can lead with a `thinking` block, which has no `text`.
 */
function answerText(data: { content?: Array<{ type?: unknown; text?: unknown }> } | null | undefined): string {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  for (const block of blocks) {
    if (block && typeof block.text === 'string') return block.text;
  }
  throw new Error(`Unexpected Claude API response shape: ${JSON.stringify(data).slice(0, 200)}`);
}

export interface ProseRequest { max_tokens: number; system: string; messages: ProseRequestMessage[] }

/** The exact model-agnostic request the plugin posts, exported so a test can
 *  run the proxy's validator against it. */
export function proseRequest(
  spec: IntermediateSpec,
  opts: { requested?: ReadonlySet<ProseV2Key> | undefined; imageBase64?: string | null | undefined; imageMediaType?: string | undefined; imageUrl?: string | null | undefined } = {},
): ProseRequest {
  const prompt = buildProsePrompt(spec, opts.requested);
  const imageBlock = opts.imageBase64
    ? { type: 'image', source: { type: 'base64', media_type: opts.imageMediaType ?? 'image/png', data: opts.imageBase64 } }
    : opts.imageUrl
      ? { type: 'image', source: { type: 'url', url: opts.imageUrl } }
      : null;
  const content = imageBlock ? [imageBlock, { type: 'text', text: prompt }] : prompt;
  return {
    max_tokens: PROSE_MAX_TOKENS,
    system: PROSE_SYSTEM_PROMPT,
    messages: [...proseFewShot(), { role: 'user', content } as ProseRequestMessage],
  };
}

/** A caller with its own key has no proxy to assign a model. */
const DIRECT_MODEL = 'claude-haiku-4-5';

export async function draftProse(spec: IntermediateSpec, opts: DraftOptions): Promise<ProseValidation | null> {
  if (!opts.apiKey && !opts.proxy) return null;
  const tier: ProseTier = opts.proxy?.licenseKey ? 'pro' : 'free';
  // A vision marker, NOT the image URL: that is signed and rotates hourly.
  const key = proseCacheKey(spec, {
    tier,
    image: Boolean(opts.imageUrl || opts.imageBase64),
    keys: opts.requested ? [...opts.requested] : undefined,
  });
  const validate = (raw: string): ProseValidation =>
    validateProseV2(spec, parseProseResponse(raw), { fileComponents: opts.fileComponents });

  const hit = await opts.cacheStore.get(key);
  if (hit) return validate(hit);

  const request = proseRequest(spec, opts);
  const body = opts.proxy ? request : { model: DIRECT_MODEL, ...request };
  const raw = await postCompletion(body, key, opts);
  // Parse before caching, so an unparseable answer is never stored; cache the
  // raw text, so a later parser fix reaches an existing entry.
  const result = validate(raw);
  await opts.cacheStore.set(key, raw);
  return result;
}

// ---------------------------------------------------------------------------
// Foundation group descriptions
// ---------------------------------------------------------------------------

/** Bump when the foundation prompt changes the produced voice. v3: one block
 *  and one overview per collection (Docs 2.0 Plan 3). */
export const GROUP_PROMPT_VERSION = 'v3';

/**
 * The proxy checks equality, not a ceiling, so a change here needs a proxy
 * deploy. Truncation is all or nothing (no closing brace, empty draft), and the
 * worst case is about 3,300 tokens (48 descriptions plus four overviews).
 */
export const GROUP_MAX_TOKENS = 4000;

/**
 * The `prose:v<n>:` prefix is a deployed server contract: the proxy rejects a
 * key not matching `/^prose:v\d+:/` with a 400. `groups:` keeps these keys out
 * of the component prose namespace.
 */
export function groupCacheKey(input: GroupDraftInput, tier: ProseTier): string {
  return `prose:${GROUP_PROMPT_VERSION}:groups:${tier}:${contentHash({
    collections: input.collections.map((c) => ({
      collectionId: c.collectionId,
      collectionName: c.collectionName,
      modeNames: c.modeNames,
      aliasCounts: c.aliasCounts,
      groups: c.groups.map((g) => ({
        folder: g.folder,
        title: g.title,
        resolvedType: g.resolvedType,
        tokenNames: g.tokenNames,
        sampleValues: g.sampleValues,
      })),
    })),
  })}`;
}

/** The exact `{cacheKey, request}` payload, exported so a test can run the
 *  proxy's validator against it; a stubbed fetch cannot. */
export function groupProseRequest(input: GroupDraftInput, tier: ProseTier): {
  cacheKey: string;
  request: { max_tokens: number; system: string; messages: unknown[] };
} {
  return {
    cacheKey: groupCacheKey(input, tier),
    request: {
      max_tokens: GROUP_MAX_TOKENS,
      system: FOUNDATION_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: buildGroupPrompt(input),
      }],
    },
  };
}

/** One request (one generation) per build, covering every collection; a
 *  collection with no groups still gets its overview. */
export async function draftGroupDescriptions(
  input: GroupDraftInput,
  opts: Pick<DraftOptions, 'apiKey' | 'fetcher' | 'cacheStore' | 'proxy'>,
): Promise<GroupDraft> {
  const empty: GroupDraft = { descriptions: {}, overviews: {} };
  if (!opts.apiKey && !opts.proxy) return empty;
  if (input.collections.length === 0) return empty;

  const folders = input.collections.flatMap((c) => c.groups.map((g) => g.folder));
  const collectionIds = input.collections.map((c) => c.collectionId);
  const tier: ProseTier = opts.proxy?.licenseKey ? 'pro' : 'free';
  const { cacheKey, request } = groupProseRequest(input, tier);

  const hit = await opts.cacheStore.get(cacheKey);
  if (hit) return parseGroupDraft(hit, folders, collectionIds);

  const raw = await postCompletion(opts.proxy ? request : { model: DIRECT_MODEL, ...request }, cacheKey, opts);

  // Same parse-then-cache-raw ordering as draftProse.
  const parsed = parseGroupDraft(raw, folders, collectionIds);
  await opts.cacheStore.set(cacheKey, raw);
  return parsed;
}
