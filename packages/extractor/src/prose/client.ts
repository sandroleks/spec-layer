import type { IntermediateSpec } from '../extract';
import { contentHash } from '../hash';
import {
  PROSE_SYSTEM_PROMPT,
  buildProsePrompt,
  parseProseResponse,
  proseFewShot,
  type ProseDrafts,
} from './prompt';

/**
 * Bumped whenever the prompt, system prompt, or few-shot changes the produced
 * voice. It is part of the cache key so old-voice drafts are never served after
 * a prompt change. v1 = original single-shot prompt; v2 = house-style system
 * prompt + few-shot; v3 = no em dashes, bulleted Accessibility, shorter sentences;
 * v4 = richer Markdown structure (bold lead-ins, variant guide, level-3 grouping);
 * v5 = anatomy summary + per-part role descriptions;
 * v6 = definition/variants rebalance (type guide moved from Definition to Variants);
 * v7 = Definition renamed to Overview, value-led prose (no style names).
 */
export const PROSE_PROMPT_VERSION = 'v7';

/**
 * The cache key for a prose draft. Centralised so the writer (`draftProse`) and
 * every reader (e.g. the detail page's pristine-draft check) stay in lockstep —
 * a key built two different ways is a silent cache miss.
 */
export function proseCacheKey(spec: IntermediateSpec, opts: { image?: boolean } = {}): string {
  return `prose:${PROSE_PROMPT_VERSION}:${contentHash(spec)}${opts.image ? ':img' : ''}`;
}

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
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
}

export async function draftProse(spec: IntermediateSpec, opts: DraftOptions): Promise<ProseDrafts | null> {
  if (!opts.apiKey) return null;

  // Vision and text-only runs produce different output, so they must not share a
  // cache entry. Key on the (stable) content hash plus a vision marker — NOT the
  // image URL, which is a signed URL that rotates hourly for an unchanged render.
  const key = proseCacheKey(spec, { image: Boolean(opts.imageUrl || opts.imageBase64) });
  if (!opts.bypassCache) {
    const hit = await opts.cacheStore.get(key);
    if (hit) return parseProseResponse(hit);
  }

  const prompt = buildProsePrompt(spec);
  const imageBlock = opts.imageBase64
    ? { type: 'image', source: { type: 'base64', media_type: opts.imageMediaType ?? 'image/png', data: opts.imageBase64 } }
    : opts.imageUrl
      ? { type: 'image', source: { type: 'url', url: opts.imageUrl } }
      : null;
  const content = imageBlock ? [imageBlock, { type: 'text', text: prompt }] : prompt;

  const res = await opts.fetcher('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      // Required: the request originates from the Figma plugin UI iframe (browser context).
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      system: PROSE_SYSTEM_PROMPT,
      messages: [...proseFewShot(), { role: 'user', content }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API error ${res.status}`);
  const data = await res.json();
  const raw = data?.content?.[0]?.text;
  if (typeof raw !== 'string') {
    throw new Error(`Unexpected Claude API response shape: ${JSON.stringify(data).slice(0, 200)}`);
  }
  const prose = parseProseResponse(raw);
  await opts.cacheStore.set(key, JSON.stringify(prose));
  return prose;
}
