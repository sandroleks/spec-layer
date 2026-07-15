import { draftProse } from '@spec-layer/extractor';
import type { IntermediateSpec, ProseDrafts, ProseKey, ProxyQuota } from '@spec-layer/extractor';
import { send } from './actions';
import { PROXY_URL, type ProxyAuth } from './proxy';

// One in-flight image request at a time; resolved by ui.ts on 'componentImage'.
// The timer is cleared on resolve so a stale timeout can never null-resolve a
// newer request (see plan review). settle() is idempotent and self-clearing.
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
  requested?: Set<ProseKey>,
  onQuota?: (q: ProxyQuota) => void,
): Promise<ProseDrafts | null> {
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
