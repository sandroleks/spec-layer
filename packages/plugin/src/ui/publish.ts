/**
 * publish.ts — assemble a library bundle through the SAME extractor code
 * paths Copy for AI uses, and POST it to the proxy.
 *
 * Deterministic bundle assembly (buildPublishBundle) lives beside the proxy
 * calls (publishBundle / rotatePullKey) because both halves of a publish
 * share one module boundary: what gets sent, and how it is sent.
 */
import {
  extract, buildFoundation, compareCodeUnits, toYaml, EXTRACTOR_VERSION,
  buildFoundationArtifactV5, foundationAiContext,
  buildComponentArtifactV5, componentAiContext,
  type FoundationArtifactV5, type YamlValue, type SerializedFoundation,
} from '@spec-layer/extractor';
import { pluginBuild, generatedGuidelines } from './actions';
import { PROXY_URL, authHeaders, type ProxyAuth } from './proxy';
import type { PublishComponentSource } from '../messages';

export interface PublishSources {
  foundation: SerializedFoundation | null;
  groupDescriptions: Record<string, Record<string, string>>;
  components: PublishComponentSource[];
  fileKey: string;
  fileName: string;
}

export interface PublishBundleV1 {
  schema: 'spec-layer-library-bundle';
  version: '1.0.0';
  fileName: string | null;
  pluginVersion: string | null;
  extractorVersion: string;
  foundation: { ai: string; artifact: FoundationArtifactV5 } | null;
  components: Array<{ name: string; ai: string; artifact: unknown }>;
}

export function buildPublishBundle(sources: PublishSources, generatedAt: string): PublishBundleV1 {
  const build = pluginBuild();
  let foundation: PublishBundleV1['foundation'] = null;
  let foundationArtifact: FoundationArtifactV5 | undefined;
  if (sources.foundation) {
    const spec = buildFoundation(sources.foundation);
    const { artifact } = buildFoundationArtifactV5(spec, {
      exportId: `foundation:${spec.fileKey && spec.fileKey !== 'unknown' ? spec.fileKey : 'local'}:${generatedAt}`,
      generatedAt,
      build,
    });
    const guidelines = generatedGuidelines(sources.groupDescriptions);
    if (guidelines) artifact.guidelines = guidelines;
    foundationArtifact = artifact;
    foundation = { ai: toYaml(foundationAiContext(artifact) as unknown as YamlValue), artifact };
  }
  const components = [...sources.components]
    .sort((a, b) => compareCodeUnits(a.name, b.name))
    .map(({ name, node, prose }) => {
      const spec = extract(node, {
        figmaFile: sources.fileKey,
        ...(sources.fileName ? { figmaFileName: sources.fileName } : {}),
      });
      const artifact = buildComponentArtifactV5(spec, {
        exportId: `component:${node.id}:${generatedAt}`,
        generatedAt,
        build,
        ...(foundationArtifact ? { foundation: foundationArtifact } : {}),
        prose,
      });
      return { name, ai: toYaml(componentAiContext(artifact) as unknown as YamlValue), artifact };
    });
  return {
    schema: 'spec-layer-library-bundle',
    version: '1.0.0',
    fileName: sources.fileName || null,
    pluginVersion: build,
    extractorVersion: EXTRACTOR_VERSION,
    foundation,
    components,
  };
}

export type PublishOutcome =
  | { kind: 'created'; libraryId: string; pullKey: string; publishedAt: string }
  | { kind: 'updated'; libraryId: string; publishedAt: string }
  | { kind: 'gone' }
  | { kind: 'error'; message: string };

function publishErrorCopy(status: number, body: Record<string, unknown>): string {
  const error = typeof body.error === 'string' ? body.error : '';
  if (status === 401) return 'Publishing needs an active Pro license.';
  if (error === 'bundle_too_large') return `This library is larger than the publish limit (${String(body.size)} of ${String(body.limit)} characters).`;
  if (error === 'library_limit') return `This license already publishes ${String(body.limit)} libraries, which is the limit.`;
  if (status === 429) return 'Too many requests just now. Give it a minute.';
  return `Publishing failed with HTTP ${status}.`;
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  try { return await res.json() as Record<string, unknown>; } catch { return {}; }
}

export async function publishBundle(
  bundle: PublishBundleV1,
  opts: { auth: ProxyAuth; libraryId: string | null; fetcher?: typeof fetch },
): Promise<PublishOutcome> {
  const headers = authHeaders(opts.auth);
  if (!headers) return { kind: 'error', message: 'Publishing needs an active Pro license.' };
  const doFetch = opts.fetcher ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${PROXY_URL}/v1/libraries`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ ...(opts.libraryId ? { libraryId: opts.libraryId } : {}), bundle }),
    });
  } catch {
    return { kind: 'error', message: 'Could not reach the publish service. Check your connection and try again.' };
  }
  const body = await bodyOf(res);
  if (res.status === 201) {
    return { kind: 'created', libraryId: String(body.libraryId), pullKey: String(body.pullKey), publishedAt: String(body.publishedAt) };
  }
  if (res.ok) return { kind: 'updated', libraryId: String(body.libraryId), publishedAt: String(body.publishedAt) };
  if (opts.libraryId && (res.status === 404 || body.error === 'not_owner')) return { kind: 'gone' };
  return { kind: 'error', message: publishErrorCopy(res.status, body) };
}

export async function rotatePullKey(
  libraryId: string, auth: ProxyAuth, fetcher?: typeof fetch,
): Promise<{ kind: 'rotated'; pullKey: string } | { kind: 'error'; message: string }> {
  const headers = authHeaders(auth);
  if (!headers) return { kind: 'error', message: 'Rotating the key needs an active Pro license.' };
  const doFetch = fetcher ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${PROXY_URL}/v1/libraries/${libraryId}/rotate`, { method: 'POST', headers });
  } catch {
    return { kind: 'error', message: 'Could not reach the publish service. Check your connection and try again.' };
  }
  const body = await bodyOf(res);
  if (res.ok) return { kind: 'rotated', pullKey: String(body.pullKey) };
  if (res.status === 401) return { kind: 'error', message: 'Rotating the key needs an active Pro license.' };
  return { kind: 'error', message: `Rotating the key failed with HTTP ${res.status}.` };
}

export function setupCommand(libraryId: string, pullKey: string): string {
  return `SPEC_LAYER_KEY=${pullKey} npx spec-layer pull --id ${libraryId}`;
}
