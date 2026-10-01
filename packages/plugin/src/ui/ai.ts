import { draftProse, draftGroupDescriptions } from '@spec-layer/extractor';
import type {
  IntermediateSpec, ProseValidation, ProseV2Key, ProxyQuota, GroupDraftInput, GroupDraft,
} from '@spec-layer/extractor';
import { send } from './actions';
import { PROXY_URL, type ProxyAuth } from './proxy';

// One in-flight image request, resolved by ui-vnext.ts on 'componentImage'.
// settle() clears the timer, so a stale timeout never null-resolves a newer one.
type ImageResult = { base64: string; mediaType: string } | null;
let pendingImage: ((r: ImageResult) => void) | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function settle(r: ImageResult): void {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  const fn = pendingImage; pendingImage = null;
  fn?.(r);
}
export function resolveComponentImage(r: ImageResult): void { settle(r); }

function requestImage(nodeId: string): Promise<ImageResult> {
  return new Promise((resolve) => {
    pendingImage = resolve;
    send({ type: 'requestComponentImage', nodeId });
    pendingTimer = setTimeout(() => settle(null), 15000); // fail open → text-only
  });
}

const cache = new Map<string, string>();
const cacheStore = {
  get: async (k: string) => cache.get(k) ?? null,
  set: async (k: string, v: string) => { cache.set(k, v); },
};

export async function generateProse(
  spec: IntermediateSpec,
  auth: ProxyAuth,
  nodeId: string,
  requested?: Set<ProseV2Key>,
  onQuota?: (q: ProxyQuota) => void,
): Promise<ProseValidation | null> {
  const img = await requestImage(nodeId);
  return draftProse(spec, {
    apiKey: null,
    fetcher: window.fetch.bind(window),
    cacheStore,
    proxy: { url: PROXY_URL, licenseKey: auth.licenseKey, licenseInstanceId: auth.licenseInstanceId, figmaUserId: auth.figmaUserId, onQuota },
    imageBase64: img?.base64 ?? null,
    imageMediaType: img?.mediaType,
    requested,
  });
}

/** One AI call for every colour group, as the tab's copy promises. Shares the
 *  prose cache, so an unchanged rebuild is free. */
export async function generateGroupDescriptions(
  input: GroupDraftInput,
  auth: ProxyAuth,
  onQuota?: (q: ProxyQuota) => void,
): Promise<GroupDraft> {
  return draftGroupDescriptions(input, {
    apiKey: null,
    fetcher: window.fetch.bind(window),
    cacheStore,
    proxy: {
      url: PROXY_URL,
      licenseKey: auth.licenseKey,
      licenseInstanceId: auth.licenseInstanceId,
      figmaUserId: auth.figmaUserId,
      onQuota,
    },
  });
}
