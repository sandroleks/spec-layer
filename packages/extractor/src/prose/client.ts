import type { IntermediateSpec } from '../extract';
import { contentHash } from '../hash';
import {
  PROSE_SYSTEM_PROMPT,
  buildProsePrompt,
  parseProseResponse,
  proseFewShot,
  type ProseDrafts,
  type ProseKey,
} from './prompt';
import {
  FOUNDATION_SYSTEM_PROMPT,
  buildGroupPrompt,
  parseGroupResponse,
  type FoundationGroupBrief,
} from './foundationPrompt';

/**
 * Bumped whenever the prompt, system prompt, or few-shot changes the produced
 * voice. It is part of the cache key so old-voice drafts are never served after
 * a prompt change. v1 = original single-shot prompt; v2 = house-style system
 * prompt + few-shot; v3 = no em dashes, bulleted Accessibility, shorter sentences;
 * v4 = richer Markdown structure (bold lead-ins, variant guide, level-3 grouping);
 * v5 = anatomy summary + per-part role descriptions;
 * v6 = definition/variants rebalance (type guide moved from Definition to Variants);
 * v7 = Definition renamed to Overview, value-led prose (no style names);
 * v8 = accessibility group expansion (Interactions, Design/Content Considerations)
 *      + selection-aware prompting and cache keys.
 */
export const PROSE_PROMPT_VERSION = 'v8';

/**
 * The part of a spec a prose draft actually depends on.
 *
 * `contrast` and `rawValues` are excluded, and `contrast` is the one that costs
 * real money: it is derived from the file's FOUNDATION, not from the component,
 * so keying on it means editing any colour variable invalidates every cached
 * draft in the file and re-bills a quota-metered generation for prose that would
 * have come out identical. Neither field reaches buildProsePrompt (it reads
 * name, anatomy, props, variants, states, tokens, layout and related), so
 * dropping them cannot make the key blind to an input the model actually sees.
 *
 * Deliberately NOT specContentHash: that projection also flattens anatomy to its
 * depth-0 legacy shape, and nested anatomy parts do reach the prompt, so reusing
 * it here would serve a stale draft after a real change to the component.
 */
function proseInputHash(spec: IntermediateSpec): string {
  const { contrast: _contrast, rawValues: _rawValues, ...rest } = spec;
  return contentHash(rest);
}

/**
 * The cache key for a prose draft. Centralised so the writer (`draftProse`) and
 * every reader (e.g. the detail page's pristine-draft check) stay in lockstep —
 * a key built two different ways is a silent cache miss.
 */
export function proseCacheKey(
  spec: IntermediateSpec,
  opts: { image?: boolean; keys?: readonly ProseKey[] } = {},
): string {
  // Sort so the signature is order-independent: {definition, interactions} and
  // {interactions, definition} are the same request and share one entry.
  const keySig = opts.keys && opts.keys.length
    ? `:keys=${[...opts.keys].sort().join(',')}`
    : '';
  return `prose:${PROSE_PROMPT_VERSION}:${proseInputHash(spec)}${opts.image ? ':img' : ''}${keySig}`;
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
  /** Why a stored key is not granting pro; only present on license identities. */
  licenseReason?: 'invalid' | 'expired' | 'inactive' | 'unreachable';
}

export type ProseProxyErrorCode =
  | 'quota_exhausted' | 'rate_limited' | 'generation_pending'
  | 'license_not_active' | 'bad_request' | 'upstream';

/** Typed proxy failure — the plugin branches on `code` (402 → upsell, etc.). */
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

function parseQuotaHeaders(headers: Headers): ProxyQuota | null {
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
  fetcher: typeof fetch;
  cacheStore: CacheStore;
  /** Skip an existing cache entry while still storing the newly generated draft. */
  bypassCache?: boolean;
  /**
   * Optional rendered component image (e.g. a Figma PNG URL). When provided, it
   * is attached as an image content block so the model can see the component,
   * not just its structured summary. Absent → text-only request (unchanged).
   */
  imageUrl?: string | null;
  /** Base64-encoded component image (plugin path). Mutually exclusive with imageUrl in practice. */
  imageBase64?: string | null;
  imageMediaType?: string; // e.g. 'image/png'
  /**
   * Which prose keys to generate. Omit to request the full set (legacy
   * behaviour). Threaded into the prompt, the parse (as the required set), and
   * the cache key so different selections never collide.
   */
  requested?: Set<ProseKey>;
  /**
   * When set, the request goes through the Spec Layer proxy instead of the
   * Anthropic API directly; `apiKey` is ignored. licenseKey (pro) wins over
   * figmaUserId (free). onQuota fires with the server's quota headers on
   * every successful response.
   */
  proxy?: {
    url: string;
    licenseKey?: string | null;
    licenseInstanceId?: string | null;
    figmaUserId?: string | null;
    onQuota?: (q: ProxyQuota) => void;
  };
}

/**
 * Send one completion request and return the model's text.
 *
 * The transport half of a prose call: proxy versus direct key, the bearer/free
 * identity split, quota headers, and the status-to-code error mapping. Extracted
 * so a second prompt (foundation group descriptions) reuses it rather than
 * carrying a second copy of the auth and error handling, which is exactly the
 * kind of duplication that drifts once and then bills or fails differently in
 * one of the two paths.
 */
async function postCompletion(
  requestBody: unknown,
  cacheKey: string,
  opts: Pick<DraftOptions, 'apiKey' | 'fetcher' | 'proxy'>,
): Promise<string> {
  let res: Response;
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
    content?: Array<{ text?: unknown }>;
  };
  const raw = data?.content?.[0]?.text;
  if (typeof raw !== 'string') {
    throw new Error(`Unexpected Claude API response shape: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return raw;
}

export async function draftProse(spec: IntermediateSpec, opts: DraftOptions): Promise<ProseDrafts | null> {
  if (!opts.apiKey && !opts.proxy) return null;

  // Vision and text-only runs produce different output, so they must not share a
  // cache entry. Key on the (stable) content hash plus a vision marker — NOT the
  // image URL, which is a signed URL that rotates hourly for an unchanged render.
  const key = proseCacheKey(spec, {
    image: Boolean(opts.imageUrl || opts.imageBase64),
    keys: opts.requested ? [...opts.requested] : undefined,
  });
  if (!opts.bypassCache) {
    const hit = await opts.cacheStore.get(key);
    if (hit) return parseProseResponse(hit, opts.requested);
  }

  const prompt = buildProsePrompt(spec, opts.requested);
  const imageBlock = opts.imageBase64
    ? { type: 'image', source: { type: 'base64', media_type: opts.imageMediaType ?? 'image/png', data: opts.imageBase64 } }
    : opts.imageUrl
      ? { type: 'image', source: { type: 'url', url: opts.imageUrl } }
      : null;
  const content = imageBlock ? [imageBlock, { type: 'text', text: prompt }] : prompt;

  const requestBody = {
    model: 'claude-haiku-4-5',
    max_tokens: 3000,
    system: PROSE_SYSTEM_PROMPT,
    messages: [...proseFewShot(), { role: 'user', content }],
  };

  const raw = await postCompletion(requestBody, key, opts);

  const prose = parseProseResponse(raw, opts.requested);
  await opts.cacheStore.set(key, JSON.stringify(prose));
  return prose;
}

// ---------------------------------------------------------------------------
// Foundation group descriptions
// ---------------------------------------------------------------------------

/**
 * Bumped when the foundation prompt or its system prompt changes the produced
 * voice, so old-voice descriptions are never served from cache afterwards.
 */
export const GROUP_PROMPT_VERSION = 'v1';

export interface GroupDraftInput {
  collectionName: string;
  groups: FoundationGroupBrief[];
}

/**
 * The cache key for a group-description request.
 *
 * The `prose:v<n>:` prefix is not decoration: the proxy REJECTS any cacheKey that
 * does not match `/^prose:v\d+:/`, so it is a deployed server contract, not a
 * local convention. Sending a bare hash returns 400 and the whole feature reads
 * as "the AI did not run". The `groups:` segment keeps these keys out of the
 * component prose namespace, so the server's cache can never answer one with the
 * other.
 *
 * Centralised for the same reason `proseCacheKey` is: a key built two ways is a
 * silent cache miss, and here it is also a hard rejection.
 */
export function groupCacheKey(input: GroupDraftInput): string {
  return `prose:${GROUP_PROMPT_VERSION}:groups:${contentHash({
    collectionName: input.collectionName,
    groups: input.groups.map((g) => ({
      folder: g.folder,
      title: g.title,
      resolvedType: g.resolvedType,
      tokenNames: g.tokenNames,
      sampleValues: g.sampleValues,
    })),
  })}`;
}

/**
 * The exact `{cacheKey, request}` payload posted for group descriptions.
 *
 * Exported so the proxy's own validator can be run against it in a test. The bug
 * this shape once had (an unprefixed cacheKey) was invisible to any test that
 * stubbed fetch, because the rule being broken lived on the server.
 */
export function groupProseRequest(input: GroupDraftInput): {
  cacheKey: string;
  request: { model: string; max_tokens: number; system: string; messages: unknown[] };
} {
  return {
    cacheKey: groupCacheKey(input),
    request: {
      model: 'claude-haiku-4-5',
      max_tokens: 1200,
      system: FOUNDATION_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: buildGroupPrompt(input.collectionName, input.groups),
      }],
    },
  };
}

/**
 * One request covering every group in a build, so a document with six groups
 * costs one generation rather than six.
 */
export async function draftGroupDescriptions(
  input: GroupDraftInput,
  opts: Pick<DraftOptions, 'apiKey' | 'fetcher' | 'cacheStore' | 'bypassCache' | 'proxy'>,
): Promise<Record<string, string>> {
  if (!opts.apiKey && !opts.proxy) return {};
  if (input.groups.length === 0) return {};

  const folders = input.groups.map((g) => g.folder);
  // Keyed on everything the prompt is built from, so editing a token name or
  // adding a group is a fresh request rather than a stale hit.
  const { cacheKey, request } = groupProseRequest(input);

  if (!opts.bypassCache) {
    const hit = await opts.cacheStore.get(cacheKey);
    if (hit) return parseGroupResponse(hit, folders);
  }

  const raw = await postCompletion(request, cacheKey, opts);

  const parsed = parseGroupResponse(raw, folders);
  // Cache the raw response, not the parsed map, so a later parser fix applies to
  // an existing entry instead of being stuck behind one.
  await opts.cacheStore.set(cacheKey, raw);
  return parsed;
}
