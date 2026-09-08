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
  buildFoundationArtifactV5, foundationDtcgDocument,
  buildComponentArtifactV5, componentAiContext, parseQuotaHeaders,
  type FoundationArtifactV5, type ProxyQuota, type YamlValue, type SerializedFoundation,
} from '@spec-layer/extractor';
import { pluginBuild, generatedGuidelines } from './actions';
import { PROXY_URL, authHeaders, type ProxyAuth } from './proxy';
import { formatResetDate } from './viewModel/allowance';
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
    foundation = { ai: `${JSON.stringify(foundationDtcgDocument(artifact), null, 2)}\n`, artifact };
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
  | { kind: 'unchanged'; libraryId: string; publishedAt: string }
  | { kind: 'gone' }
  | { kind: 'error'; message: string };

/** The publish half of the proxy's quota, as the response headers state it. */
export type PublishQuotaSnapshot = NonNullable<ProxyQuota['publish']>;

export interface PublishResult {
  outcome: PublishOutcome;
  /**
   * The publish allowance the response reported, or null when it carried no
   * quota headers (a network failure, or a refusal the proxy answers before
   * it reaches the quota engine). The proxy sends them on 200, 201, 402, 409,
   * and 429, so a spent update is visible without a second round trip.
   */
  quota: PublishQuotaSnapshot | null;
}

const NO_IDENTITY = 'Publishing needs a signed-in Figma account or a license key.';
const ROTATE_NO_IDENTITY = 'Rotating the key needs a signed-in Figma account or a license key.';

const PUBLISH_LIMIT_MESSAGE_PREFIX = 'Free plans publish one Figma file.';

/** Bytes as "5.6 MB", with no decimal when it is whole, or the raw value when it is not a number. */
function megabytes(bytes: unknown): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return String(bytes);
  const mb = bytes / 1_000_000;
  return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)} MB`;
}

function publishErrorCopy(status: number, body: Record<string, unknown>): string {
  const error = typeof body.error === 'string' ? body.error : '';
  if (status === 401) return NO_IDENTITY;
  if (status === 402) {
    const reset = formatResetDate(typeof body.resetsAt === 'string' ? body.resetsAt : '');
    const after = reset ? ` or publish again after ${reset}` : '';
    return `You have used your 10 free updates for this month. Upgrade to Pro${after}.`;
  }
  if (status === 409 || error === 'publish_pending') {
    return 'A publish is already running. Give it a moment and try again.';
  }
  if (error === 'bundle_too_large') return `This library is larger than the publish limit (${megabytes(body.size)} of ${megabytes(body.limit)}).`;
  if (error === 'library_limit') {
    const existing = body.existing as { fileName?: unknown } | undefined;
    if (existing) {
      const name = typeof existing.fileName === 'string' && existing.fileName ? existing.fileName : 'another file';
      return `${PUBLISH_LIMIT_MESSAGE_PREFIX} This account already publishes ${name}. Upgrade to Pro to publish up to 10 files.`;
    }
    return `This plan already publishes ${String(body.limit)} Figma files, which is the limit.`;
  }
  if (status === 429) return 'Too many requests just now. Give it a minute.';
  return `Publishing failed with HTTP ${status}.`;
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  try { return await res.json() as Record<string, unknown>; } catch { return {}; }
}

export async function publishBundle(
  bundle: PublishBundleV1,
  opts: { auth: ProxyAuth; libraryId: string | null; fetcher?: typeof fetch },
): Promise<PublishResult> {
  const headers = authHeaders(opts.auth);
  if (!headers) return { outcome: { kind: 'error', message: NO_IDENTITY }, quota: null };
  const doFetch = opts.fetcher ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${PROXY_URL}/v1/libraries`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ ...(opts.libraryId ? { libraryId: opts.libraryId } : {}), bundle }),
    });
  } catch {
    return {
      outcome: {
        kind: 'error',
        message: 'Could not reach the publish service. Check your connection and try again.',
      },
      quota: null,
    };
  }
  const body = await bodyOf(res);
  // Read the allowance off every answer that states one, refusals included: a
  // 402 is exactly when the screen's count matters most.
  const quota = parseQuotaHeaders(res.headers);
  const result = (outcome: PublishOutcome): PublishResult => ({ outcome, quota });
  if (res.status === 201) {
    return result({ kind: 'created', libraryId: String(body.libraryId), pullKey: String(body.pullKey), publishedAt: String(body.publishedAt) });
  }
  if (res.ok && body.unchanged === true) {
    return result({ kind: 'unchanged', libraryId: String(body.libraryId), publishedAt: String(body.publishedAt) });
  }
  if (res.ok) return result({ kind: 'updated', libraryId: String(body.libraryId), publishedAt: String(body.publishedAt) });
  if (opts.libraryId && (res.status === 404 || body.error === 'not_owner')) return result({ kind: 'gone' });
  return result({ kind: 'error', message: publishErrorCopy(res.status, body) });
}

export async function rotatePullKey(
  libraryId: string, auth: ProxyAuth, fetcher?: typeof fetch,
): Promise<{ kind: 'rotated'; pullKey: string } | { kind: 'error'; message: string }> {
  const headers = authHeaders(auth);
  if (!headers) return { kind: 'error', message: ROTATE_NO_IDENTITY };
  const doFetch = fetcher ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${PROXY_URL}/v1/libraries/${libraryId}/rotate`, { method: 'POST', headers });
  } catch {
    return { kind: 'error', message: 'Could not reach the publish service. Check your connection and try again.' };
  }
  const body = await bodyOf(res);
  if (res.ok) return { kind: 'rotated', pullKey: String(body.pullKey) };
  return { kind: 'error', message: `Rotating the key failed with HTTP ${res.status}.` };
}

export function setupCommand(libraryId: string, pullKey: string): string {
  return `npx spec-layer setup --id ${libraryId} --key ${pullKey}`;
}

/**
 * The same setup, phrased for a coding agent a developer pastes it to. It
 * carries `--yes` because an unattended npx run otherwise stops to ask before
 * downloading the package, and it ends with the command that writes the
 * agent's guide to the pulled files, since an agent that only receives the
 * setup line has no way to know what landed or how to read it.
 */
export function agentSetupMessage(libraryId: string, pullKey: string): string {
  return [
    'Set up Spec Layer design-system context in this repository.',
    '',
    '1. In the repository root, run:',
    `   npx --yes spec-layer setup --id ${libraryId} --key ${pullKey}`,
    '   It writes speclayer.json, stores the pull key in a gitignored speclayer.local.json, and pulls the published library into .speclayer/.',
    '2. Then run:',
    '   npx --yes spec-layer skill --install',
    '   It writes a guide to the pulled files, adapted to this codebase, where you read project instructions. Read that guide before using the files.',
    '3. Never print, commit, or copy the key anywhere else. npx --yes spec-layer tools lists every command with what it reaches and writes.',
  ].join('\n');
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

export interface PublishHost {
  repaint(): void;
  send(msg: UiToMain): void;
  /**
   * A publish allowance the proxy just stated. The controller cannot repaint
   * the meter itself: the quota lives in the panel's state, and without this
   * the screen would keep showing the count from the last quota fetch after
   * spending an update.
   */
  onPublishQuota(snapshot: PublishQuotaSnapshot): void;
}

const noopPublishHost: PublishHost = {
  repaint: () => {}, send: () => {}, onPublishQuota: () => {},
};
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

const GONE_MESSAGE =
  'That library is gone or belongs to another account. Nothing was published. '
  + 'Publish again to create a new library, then share its setup command with your developers.';

export async function onPublishSources(
  msg: PublishSourcesMsg,
  auth: ProxyAuth,
  fetcher?: typeof fetch,
): Promise<void> {
  if (msg.skipped.length > 0) {
    state = { ...state, status: 'error', message: skippedMessage(msg.skipped) };
    host.repaint();
    return;
  }

  // What this session already knows wins; otherwise the identity the main
  // thread read from the file in this same round trip. A publishInfo reply
  // that has not landed yet can no longer cost us a republish.
  const libraryId = state.libraryId ?? msg.publishInfo.libraryId;
  const pullKey = state.pullKey ?? msg.publishInfo.pullKey;
  const lastPublishedAt = state.lastPublishedAt ?? msg.publishInfo.publishedAt;
  state = { ...state, status: 'uploading', libraryId, pullKey, lastPublishedAt };
  host.repaint();

  const bundle = buildPublishBundle(msg, new Date().toISOString());
  const { outcome, quota } = await publishBundle(bundle, { auth, libraryId, fetcher });
  // Before the repaint below, so one paint shows both the result and the count
  // it left behind.
  if (quota) host.onPublishQuota(quota);

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
      host.send({ type: 'setPublishInfo', libraryId: outcome.libraryId, pullKey: outcome.pullKey });
      host.send({ type: 'setPublishedAt', libraryId: outcome.libraryId, publishedAt: outcome.publishedAt });
      break;
    case 'updated':
      state = {
        ...state,
        status: 'done',
        libraryId: outcome.libraryId,
        lastPublishedAt: outcome.publishedAt,
        message: 'Published. Developers get this version on their next pull.',
      };
      host.send({ type: 'setPublishedAt', libraryId: outcome.libraryId, publishedAt: outcome.publishedAt });
      break;
    case 'unchanged':
      // The unchanged answer carries the stored library's existing date, which
      // is the true last-published time, so it is recorded like the others.
      state = {
        ...state,
        status: 'done',
        libraryId: outcome.libraryId,
        lastPublishedAt: outcome.publishedAt,
        message: 'Nothing changed since the last publish.',
      };
      host.send({ type: 'setPublishedAt', libraryId: outcome.libraryId, publishedAt: outcome.publishedAt });
      break;
    case 'gone':
      // Never recreate on the user's behalf: the developers pulling the old id
      // would be stranded without anyone being told. Drop the stale identity
      // here and in the file so the next click is a deliberate new library.
      state = {
        ...state, status: 'error', libraryId: null, pullKey: null, lastPublishedAt: null, message: GONE_MESSAGE,
      };
      host.send({ type: 'clearPublishInfo' });
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
 * Seed libraryId, pullKey and lastPublishedAt from what was last persisted
 * for this file, so a fresh session's publish screen can show the setup
 * command, the Rotate action and the last publish date without waiting for a
 * publish. Only takes effect while idle: once a publish (or rotate) has run
 * this session, that in-memory result is the truth, and a slow publishInfo
 * reply landing afterward must not clobber it.
 */
export function onPublishInfo(msg: PublishInfoMsg): void {
  if (state.status !== 'idle') return;
  state = { ...state, libraryId: msg.libraryId, pullKey: msg.pullKey, lastPublishedAt: msg.publishedAt };
  host.repaint();
}

export const isPublishBusy = (s: Readonly<PublishState>): boolean =>
  s.status === 'collecting' || s.status === 'uploading';

export async function onRotateClick(auth: ProxyAuth, fetcher?: typeof fetch): Promise<void> {
  const libraryId = state.libraryId;
  // A rotate racing an upload would let the two overwrite each other's
  // result on the server, and a failed rotate flipping status mid-upload
  // would re-enable Publish. The button is disabled while busy; this is the
  // guard behind it.
  if (!libraryId || isPublishBusy(state)) return;
  const outcome = await rotatePullKey(libraryId, auth, fetcher);
  if (outcome.kind === 'rotated') {
    state = {
      ...state,
      status: 'done',
      pullKey: outcome.pullKey,
      message: 'Key rotated. The old key stops working within about a minute. Share the new command with your developers.',
    };
    host.send({ type: 'setPublishInfo', libraryId, pullKey: outcome.pullKey });
  } else {
    state = { ...state, status: 'error', message: outcome.message };
  }
  host.repaint();
}
