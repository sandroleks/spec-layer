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
import type { MainToUi, PublishComponentSource, UiToMain } from '../messages';

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

// ---------------------------------------------------------------------------
// Publish controller — module state driving the library screen's "Publish for
// developers" section, mirroring the module-state + host pattern actions.ts
// uses for foundations. Lives beside buildPublishBundle/publishBundle/
// rotatePullKey because it is the third leg of the same publish flow:
// assemble, send, orchestrate.
// ---------------------------------------------------------------------------

export type PublishSourcesMsg = Extract<MainToUi, { type: 'publishSources' }>;
export type PublishInfoMsg = Extract<MainToUi, { type: 'publishInfo' }>;

export interface PublishState {
  status: 'idle' | 'collecting' | 'uploading' | 'done' | 'error';
  message: string | null;
  libraryId: string | null;
  pullKey: string | null;
  lastPublishedAt: string | null;
}

function createPublishState(): PublishState {
  return { status: 'idle', message: null, libraryId: null, pullKey: null, lastPublishedAt: null };
}

let state: PublishState = createPublishState();

/**
 * The fileKey the current libraryId/pullKey belong to, learned from either a
 * publishSources reply or the persisted publishInfo seed. onRotateClick needs
 * it to send setPublishInfo, since a rotate reply carries only the new key.
 */
let publishFileKey: string | null = null;

export interface PublishHost { repaint(): void; send(msg: UiToMain): void }

const noopPublishHost: PublishHost = { repaint: () => {}, send: () => {} };
let host: PublishHost = noopPublishHost;

export function setPublishHost(nextHost: PublishHost): void {
  host = nextHost;
}

export function publishState(): Readonly<PublishState> {
  return state;
}

/**
 * Start a publish: ask the main thread to collect this file's sources.
 *
 * `_auth` is accepted (unused here) for symmetry with onPublishSources and
 * onRotateClick, which each recompute their own effective auth freshly at the
 * moment they run, since a license can activate or lapse mid-session. This
 * step only talks to the main thread's Figma sandbox, which needs no proxy
 * identity.
 */
export function onPublishClick(_auth: ProxyAuth): void {
  if (state.status === 'collecting' || state.status === 'uploading') return;
  state = { ...state, status: 'collecting', message: null };
  host.repaint();
  host.send({ type: 'requestPublishSources' });
}

function skippedMessage(skipped: Array<{ name: string; reason: string }>): string {
  const names = skipped.map((s) => s.name).join(', ');
  const count = skipped.length;
  return `Nothing was published. ${count} component${count === 1 ? '' : 's'} could not be read: ${names}. Fix or remove those docs, then publish again.`;
}

export async function onPublishSources(
  msg: PublishSourcesMsg,
  auth: ProxyAuth,
  fetcher?: typeof fetch,
): Promise<void> {
  publishFileKey = msg.fileKey;
  if (msg.skipped.length > 0) {
    state = { ...state, status: 'error', message: skippedMessage(msg.skipped) };
    host.repaint();
    return;
  }

  state = { ...state, status: 'uploading' };
  host.repaint();

  const bundle = buildPublishBundle(msg, new Date().toISOString());
  let outcome = await publishBundle(bundle, { auth, libraryId: state.libraryId, fetcher });
  // The republish target is gone (deleted, or owned by someone else now):
  // retry exactly once as a brand-new library rather than surfacing an error
  // for something the user can fix simply by publishing again.
  if (outcome.kind === 'gone') {
    outcome = await publishBundle(bundle, { auth, libraryId: null, fetcher });
  }

  switch (outcome.kind) {
    case 'created':
      state = {
        ...state,
        status: 'done',
        libraryId: outcome.libraryId,
        pullKey: outcome.pullKey,
        lastPublishedAt: outcome.publishedAt,
        message: 'Published. Anyone with the key can pull this version.',
      };
      host.send({
        type: 'setPublishInfo',
        fileKey: msg.fileKey,
        libraryId: outcome.libraryId,
        pullKey: outcome.pullKey,
      });
      break;
    case 'updated':
      state = {
        ...state,
        status: 'done',
        libraryId: outcome.libraryId,
        lastPublishedAt: outcome.publishedAt,
        message: 'Published. Developers get this version on their next pull.',
      };
      break;
    case 'gone':
      // publishBundle only maps 404/not_owner to 'gone' when a libraryId was
      // sent; the retry above always sends null, so this is unreachable. Kept
      // so the switch stays exhaustive for the type checker.
      state = { ...state, status: 'error', message: 'That library is gone. Publish again to create a new one.' };
      break;
    case 'error':
      state = { ...state, status: 'error', message: outcome.message };
      break;
  }
  host.repaint();
}

export function onPublishSourcesError(message: string): void {
  state = {
    ...state,
    status: 'error',
    message: `Could not read the library. Nothing was published. ${message}`,
  };
  host.repaint();
}

/**
 * Seed libraryId/pullKey from what was last persisted for this file, so a
 * fresh session's Library screen can show the setup command and Rotate
 * action without waiting for a publish. Only takes effect while idle: once a
 * publish (or rotate) has run this session, that in-memory result is the
 * truth, and a slow publishInfo reply landing afterward must not clobber it.
 */
export function onPublishInfo(msg: PublishInfoMsg): void {
  publishFileKey = msg.fileKey;
  if (state.status !== 'idle') return;
  state = { ...state, libraryId: msg.libraryId, pullKey: msg.pullKey };
  host.repaint();
}

export async function onRotateClick(auth: ProxyAuth, fetcher?: typeof fetch): Promise<void> {
  const libraryId = state.libraryId;
  if (!libraryId) return;
  const outcome = await rotatePullKey(libraryId, auth, fetcher);
  if (outcome.kind === 'rotated') {
    state = {
      ...state,
      pullKey: outcome.pullKey,
      message: 'Key rotated. The old key no longer works. Share the new command with your developers.',
    };
    if (publishFileKey) {
      host.send({
        type: 'setPublishInfo',
        fileKey: publishFileKey,
        libraryId,
        pullKey: outcome.pullKey,
      });
    }
  } else {
    state = { ...state, status: 'error', message: outcome.message };
  }
  host.repaint();
}
