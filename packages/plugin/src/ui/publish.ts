/**
 * Assemble a library bundle through the same extractor paths Copy for AI uses,
 * and send it to the proxy: what gets sent, and how.
 */
import {
  extract, buildFoundation, compareCodeUnits, toYaml, EXTRACTOR_VERSION,
  buildFoundationArtifactV5, foundationDtcgDocument,
  buildComponentArtifactV5, componentAiContext, parseQuotaHeaders,
  compareBump, isSemver, nextVersion, specContentHash, proseToLegacy, knownFileKey,
  type FoundationArtifactV5, type ProxyQuota, type YamlValue, type SerializedFoundation,
  type Bump, type LibraryChange,
} from '@spec-layer/extractor';
import { DEFAULT_COMPONENT_FORMAT, type ComponentFormat } from '../componentFormat';
import { pluginBuild, generatedGuidelines } from './actions';
import { PROXY_URL, authHeaders, isLibraryId, type ProxyAuth } from './proxy';
import { formatResetDate } from './viewModel/allowance';
import { buildSkillFiles, skillZipFilename } from './skillZip';
import { downloadBytes, zipFiles } from './download';
import type { MainToUi, PublishComponentSource, PublishStampComponent, UiToMain } from '../messages';

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
  components: Array<{
    name: string; ai: string; artifact: unknown;
    /** Every variant instance, so the proxy's diff compares bindings per
     *  variant (libraryDiff.ts). */
    variants: Array<{ name: string; values: Record<string, string> }>;
  }>;
}

export interface PublishStamps {
  components: PublishStampComponent[];
  /** The Foundation dump the bundle was built from, or null. Sent verbatim on
   *  `stampPublished` so foundation docs get the hash of exactly the published
   *  content, with no second live read. */
  foundation: SerializedFoundation | null;
}

/** The proxy's dry-run answer. See packages/proxy/README.md, "Dry run". */
export interface DryRunResult {
  currentVersion: string | null;
  unchanged: boolean;
  minimumBump: Bump | null;
  proposedVersion: string | null;
  counts: { major: number; minor: number; patch: number };
  changes: LibraryChange[];
  changesTruncated: boolean;
}

export function buildPublishArtifacts(
  sources: PublishSources, generatedAt: string,
): { bundle: PublishBundleV1; stamps: PublishStamps } {
  const build = pluginBuild();
  let foundation: PublishBundleV1['foundation'] = null;
  let foundationArtifact: FoundationArtifactV5 | undefined;
  if (sources.foundation) {
    const spec = buildFoundation(sources.foundation);
    const { artifact } = buildFoundationArtifactV5(spec, {
      exportId: `foundation:${knownFileKey(spec.fileKey) ?? 'local'}:${generatedAt}`,
      generatedAt,
      build,
    });
    const guidelines = generatedGuidelines(sources.groupDescriptions);
    if (guidelines) artifact.guidelines = guidelines;
    foundationArtifact = artifact;
    foundation = { ai: `${JSON.stringify(foundationDtcgDocument(artifact), null, 2)}\n`, artifact };
  }
  const stamps: PublishStampComponent[] = [];
  const components = [...sources.components]
    .sort((a, b) => compareCodeUnits(a.name, b.name))
    .map(({ name, node, prose }) => {
      const spec = extract(node, {
        figmaFile: sources.fileKey,
        ...(sources.fileName ? { figmaFileName: sources.fileName } : {}),
      });
      // The same extraction a doc build runs, hashed both ways so main can
      // stamp each doc with the hash its own includeHidden produces.
      stamps.push({
        sourceNodeId: node.id,
        hashes: {
          visible: specContentHash(spec, { includeHidden: false }),
          hidden: specContentHash(spec, { includeHidden: true }),
        },
      });
      const artifact = buildComponentArtifactV5(spec, {
        exportId: `component:${node.id}:${generatedAt}`,
        generatedAt,
        build,
        ...(foundationArtifact ? { foundation: foundationArtifact } : {}),
        // The v5 artifact reads the v1 shape; the doc stores v2.
        prose: prose ? proseToLegacy(prose) : null,
      });
      return {
        name,
        ai: toYaml(componentAiContext(artifact) as unknown as YamlValue),
        artifact,
        variants: spec.variantInstances.map(({ name: variantName, values }) => ({ name: variantName, values })),
      };
    });
  const bundle: PublishBundleV1 = {
    schema: 'spec-layer-library-bundle',
    version: '1.0.0',
    fileName: sources.fileName || null,
    pluginVersion: build,
    extractorVersion: EXTRACTOR_VERSION,
    foundation,
    components,
  };
  return { bundle, stamps: { components: stamps, foundation: sources.foundation } };
}

export function buildPublishBundle(sources: PublishSources, generatedAt: string): PublishBundleV1 {
  return buildPublishArtifacts(sources, generatedAt).bundle;
}

export type PublishOutcome =
  | { kind: 'created'; libraryId: string; pullKey: string; publishedAt: string; version: string | null }
  | { kind: 'updated'; libraryId: string; publishedAt: string; version: string | null }
  | { kind: 'unchanged'; libraryId: string; publishedAt: string; version: string | null }
  /** The chosen bump undercounts the changes. Carries the minimum the proxy
   *  accepts and its version, so the screen re-renders with no round trip. */
  | { kind: 'below_minimum'; minimumBump: Bump; proposedVersion: string }
  | { kind: 'gone' }
  | { kind: 'error'; message: string };

/** The publish half of the proxy's quota, as the response headers state it. */
export type PublishQuotaSnapshot = NonNullable<ProxyQuota['publish']>;

export interface PublishResult {
  outcome: PublishOutcome;
  /** Null when the response had no quota headers (a network failure, or a
   *  refusal before the quota engine). The proxy sends them on 200, 201, 402,
   *  409 and 429. */
  quota: PublishQuotaSnapshot | null;
}

const NO_IDENTITY =
  'Couldn’t publish without a Figma account or license key. '
  + 'Sign in to Figma, or activate your license key on the License screen.';
const ROTATE_NO_IDENTITY =
  'Couldn’t rotate the pull key without a Figma account or license key. '
  + 'Sign in to Figma, or activate your license key on the License screen.';
const ROTATE_BAD_ID = 'Couldn’t rotate the pull key. The library link saved in this file is damaged.';

/** A publish or rotate whose request never reached the proxy at all. */
const UNREACHABLE = 'Couldn’t reach Spec Layer. Check your connection and try again.';

const PUBLISH_LIMIT_MESSAGE_PREFIX = 'Couldn’t publish. The free plan publishes 1 Figma file.';

/** Bytes as "5.6 MB" (no decimal when whole), or the raw value if not a number. */
function megabytes(bytes: unknown): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return String(bytes);
  const mb = bytes / 1_000_000;
  return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)} MB`;
}

const NOT_OWNER =
  'Couldn’t publish. This library belongs to another account, or this device doesn’t have its current pull key. '
  + 'Publish from the device that first published it or last rotated its key.';

/**
 * The spent allowance in the server's own number, read from the 402's quota
 * headers so it cannot drift from the proxy's limit. Without them the sentence
 * has no number, never a guessed one.
 */
function exhaustedCopy(body: Record<string, unknown>, quota: PublishQuotaSnapshot | null): string {
  const reset = formatResetDate(typeof body.resetsAt === 'string' ? body.resetsAt : '');
  const after = reset ? ` or publish again from ${reset}` : '';
  const limit = quota?.limit;
  const spent = typeof limit === 'number' && Number.isFinite(limit)
    ? `your ${limit} free publish${limit === 1 ? '' : 'es'}`
    : 'your free publishes';
  return `Couldn’t publish. You’ve used ${spent} this month. Upgrade to Pro${after}.`;
}

function publishErrorCopy(
  status: number, body: Record<string, unknown>, quota: PublishQuotaSnapshot | null = null,
): string {
  const error = typeof body.error === 'string' ? body.error : '';
  if (status === 401) {
    // A key that is not buying Pro: say what the proxy said about it rather
    // than asking for a key already entered.
    if (error === 'license_not_active') {
      return body.reason === 'unreachable'
        ? 'Couldn’t publish. Spec Layer couldn’t check your license key right now. Try again in a minute.'
        : 'Couldn’t publish. Your license key isn’t active. Renew or reconnect it on the License screen, '
          + 'or sign in to Figma to publish on the free plan.';
    }
    return NO_IDENTITY;
  }
  if (error === 'not_owner') return NOT_OWNER;
  if (status === 402) return exhaustedCopy(body, quota);
  if (status === 409 || error === 'publish_pending') {
    return 'These changes are already being published. Try again in a minute.';
  }
  if (error === 'bundle_too_large') {
    return `Couldn’t publish. This library is ${megabytes(body.size)}, over the ${megabytes(body.limit)} limit. `
      + 'Remove docs you don’t need from this file, then publish again.';
  }
  if (error === 'library_limit') {
    const existing = body.existing as { fileName?: unknown } | undefined;
    if (existing) {
      const name = typeof existing.fileName === 'string' && existing.fileName ? existing.fileName : 'another file';
      // A lapsed Pro license still owns every library it created, so the
      // count can exceed one.
      const owned = typeof body.owned === 'number' && body.owned > 1
        ? `${body.owned} files, including ${name}`
        : name;
      return `${PUBLISH_LIMIT_MESSAGE_PREFIX} This account already publishes ${owned}. Upgrade to Pro to publish up to 10 files.`;
    }
    return `Couldn’t publish. This account already publishes ${String(body.limit)} Figma files, which is the Pro limit.`;
  }
  if (status === 429) return 'Couldn’t publish. Too many requests in the last minute. Try again in a minute.';
  return 'Couldn’t publish. Spec Layer returned an error. Try again, or reopen the plugin if it keeps happening. '
    + `(HTTP ${status})`;
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  try { return await res.json() as Record<string, unknown>; } catch { return {}; }
}

/**
 * The pull key travels with every write. A Figma identity is not a secret, so
 * a free-plan library accepts an update or rotate only with its key.
 */
const withPullKey = (headers: Record<string, string>, pullKey: string | null | undefined): Record<string, string> =>
  pullKey ? { ...headers, 'X-Pull-Key': pullKey } : headers;

export async function publishBundle(
  bundle: PublishBundleV1,
  opts: {
    auth: ProxyAuth; libraryId: string | null; pullKey?: string | null; fetcher?: typeof fetch | undefined;
    /** Omitted or null lets the proxy apply the minimum bump. */
    bump?: Bump | null;
    note?: string | null;
    /** Create only; ignored on an update. */
    initialVersion?: string | null;
  },
): Promise<PublishResult> {
  const headers = authHeaders(opts.auth);
  if (!headers) return { outcome: { kind: 'error', message: NO_IDENTITY }, quota: null };
  const doFetch = opts.fetcher ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${PROXY_URL}/v1/libraries`, {
      method: 'POST',
      headers: { ...withPullKey(headers, opts.libraryId ? opts.pullKey : null), 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(opts.libraryId ? { libraryId: opts.libraryId } : {}),
        bundle,
        ...(opts.bump ? { bump: opts.bump } : {}),
        ...(opts.note ? { note: opts.note } : {}),
        ...(!opts.libraryId && opts.initialVersion ? { initialVersion: opts.initialVersion } : {}),
      }),
    });
  } catch {
    return { outcome: { kind: 'error', message: UNREACHABLE }, quota: null };
  }
  const body = await bodyOf(res);
  // Refusals included: a 402 is when the count matters most.
  const quota = parseQuotaHeaders(res.headers);
  const result = (outcome: PublishOutcome): PublishResult => ({ outcome, quota });
  const version = typeof body.version === 'string' ? body.version : null;
  if (res.status === 201) {
    return result({
      kind: 'created', libraryId: String(body.libraryId), pullKey: String(body.pullKey),
      publishedAt: String(body.publishedAt), version,
    });
  }
  if (res.ok && body.unchanged === true) {
    return result({ kind: 'unchanged', libraryId: String(body.libraryId), publishedAt: String(body.publishedAt), version });
  }
  if (res.ok) return result({ kind: 'updated', libraryId: String(body.libraryId), publishedAt: String(body.publishedAt), version });
  if (
    res.status === 400 && body.error === 'bump_below_minimum'
    && typeof body.minimumBump === 'string' && typeof body.proposedVersion === 'string'
  ) {
    return result({ kind: 'below_minimum', minimumBump: body.minimumBump as Bump, proposedVersion: body.proposedVersion });
  }
  // Only a 404 is gone. A 403 means another owner or a missing key, and the
  // file's id is still the one developers pull, so it stays.
  if (opts.libraryId && res.status === 404) return result({ kind: 'gone' });
  return result({ kind: 'error', message: publishErrorCopy(res.status, body, quota) });
}

/**
 * A request that never reached the proxy carries no message: the screen shows
 * PROPOSAL_FAILED_MESSAGE instead. Refusals keep theirs.
 */
export async function dryRunBundle(
  bundle: PublishBundleV1,
  opts: { auth: ProxyAuth; libraryId: string; pullKey?: string | null; fetcher?: typeof fetch | undefined },
): Promise<{ kind: 'ok'; result: DryRunResult } | { kind: 'error'; message?: string }> {
  const headers = authHeaders(opts.auth);
  if (!headers) return { kind: 'error', message: NO_IDENTITY };
  const doFetch = opts.fetcher ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${PROXY_URL}/v1/libraries`, {
      method: 'POST',
      headers: { ...withPullKey(headers, opts.pullKey), 'content-type': 'application/json' },
      body: JSON.stringify({ libraryId: opts.libraryId, bundle, dryRun: true }),
    });
  } catch {
    return { kind: 'error' };
  }
  const body = await bodyOf(res);
  if (!res.ok) return { kind: 'error', message: publishErrorCopy(res.status, body) };
  const bumps = new Set(['major', 'minor', 'patch']);
  const bump = (v: unknown): Bump | null => (typeof v === 'string' && bumps.has(v) ? (v as Bump) : null);
  const counts = (body.counts ?? {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    kind: 'ok',
    result: {
      currentVersion: typeof body.currentVersion === 'string' ? body.currentVersion : null,
      unchanged: body.unchanged === true,
      minimumBump: bump(body.minimumBump),
      proposedVersion: typeof body.proposedVersion === 'string' ? body.proposedVersion : null,
      counts: { major: n(counts.major), minor: n(counts.minor), patch: n(counts.patch) },
      changes: Array.isArray(body.changes) ? (body.changes as LibraryChange[]) : [],
      changesTruncated: body.changesTruncated === true,
    },
  };
}

export async function rotatePullKey(
  libraryId: string, auth: ProxyAuth, fetcher?: typeof fetch, pullKey: string | null = null,
): Promise<{ kind: 'rotated'; pullKey: string } | { kind: 'error'; message: string }> {
  const headers = authHeaders(auth);
  if (!headers) return { kind: 'error', message: ROTATE_NO_IDENTITY };
  // The id goes into the path while the key rides in a header.
  if (!isLibraryId(libraryId)) return { kind: 'error', message: ROTATE_BAD_ID };
  const doFetch = fetcher ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${PROXY_URL}/v1/libraries/${libraryId}/rotate`, { method: 'POST', headers: withPullKey(headers, pullKey) });
  } catch {
    return { kind: 'error', message: UNREACHABLE };
  }
  const body = await bodyOf(res);
  if (res.ok) return { kind: 'rotated', pullKey: String(body.pullKey) };
  // Ownership is the publishing license key, or the Figma account plus the
  // current pull key, so a teammate can be refused. Say what it takes.
  if (res.status === 403 || body.error === 'not_owner') {
    return {
      kind: 'error',
      message: 'Couldn’t rotate the pull key. That takes the license key this library was published with, '
        + 'or the Figma account that published it on a device with the current pull key.',
    };
  }
  return {
    kind: 'error',
    message: `Couldn’t rotate the pull key. Spec Layer returned an error. Try again in a minute. (HTTP ${res.status})`,
  };
}

/** Empty for YAML, the CLI default. `setup` stores the flag in speclayer.json,
 *  so every later pull writes the same format. */
function formatFlag(format: ComponentFormat): string {
  return format === 'md' ? ' --component-format md' : '';
}

export function setupCommand(libraryId: string, pullKey: string, format: ComponentFormat): string {
  return `npx spec-layer setup --id ${libraryId} --key ${pullKey}${formatFlag(format)}`;
}

/**
 * The setup phrased for a coding agent. `--yes` because unattended npx stops
 * to ask before downloading; it ends with the command that writes the agent's
 * guide, since the setup line alone says nothing about what landed.
 */
export function agentSetupMessage(libraryId: string, pullKey: string, format: ComponentFormat): string {
  return [
    'Set up Spec Layer design-system context in this repository.',
    '',
    '1. In the repository root, run:',
    `   npx --yes spec-layer setup --id ${libraryId} --key ${pullKey}${formatFlag(format)}`,
    '   It writes `speclayer.json`, stores the pull key in a gitignored `speclayer.local.json`, and pulls the published library into `.speclayer/`.',
    '2. Then run:',
    '   npx --yes spec-layer skill --install',
    '   It writes a guide to the pulled files, adapted to this codebase, into the file you read project instructions from. Read that guide before using the files.',
    '3. Never print, commit, or copy the pull key anywhere else. `npx --yes spec-layer tools` lists every command with what it reaches and writes.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Publish controller: module state plus a host, as actions.ts does for foundations
// ---------------------------------------------------------------------------

export type PublishSourcesMsg = Extract<MainToUi, { type: 'publishSources' }>;
export type PublishInfoMsg = Extract<MainToUi, { type: 'publishInfo' }>;

export interface PublishState {
  status: 'idle' | 'collecting' | 'uploading' | 'done' | 'error';
  message: string | null;
  libraryId: string | null;
  pullKey: string | null;
  lastPublishedAt: string | null;
  /** Which action the in-flight collect belongs to; all three share one
   *  round trip to main. */
  intent: 'publish' | 'download' | 'dryRun';
  /** Taken at the download click, so a Settings change mid-collect cannot
   *  change the zip. */
  downloadFormat: ComponentFormat;
  /** Null before the first versioned publish. */
  version: string | null;
  /** The last dry-run answer, or the local first-publish proposal. */
  proposal: DryRunResult | null;
  proposalStatus: 'idle' | 'loading' | 'failed';
  /** Null means "apply the minimum". */
  chosenBump: Bump | null;
  note: string;
  /** Sent only on a create. */
  initialVersion: string;
  /**
   * Whether this session has heard the file's publish identity (`publishInfo`
   * or `publishSources`). Until then the screen claims neither "Published" nor
   * "Not published" and proposes no version: either would be a guess.
   */
  infoKnown: boolean;
  /** Bumped by `invalidatePublishProposal` whenever the session may have
   *  changed what a publish would contain. */
  proposalGeneration: number;
  /**
   * `proposalGeneration` when the current dry-run or publish collect was sent.
   * Checked when the sources reply lands and again after the proxy call, so an
   * invalidation during either is caught. A download never reads it.
   */
  collectGeneration: number;
  /** Where `proposal` came from, so the "checked" note is honest: a dry run
   *  answers only for its moment; a publish's result is exactly what it sent. */
  proposalSource: 'check' | 'publish';
}

export function createPublishState(): PublishState {
  return {
    status: 'idle', message: null, libraryId: null, pullKey: null, lastPublishedAt: null, intent: 'publish',
    downloadFormat: DEFAULT_COMPONENT_FORMAT,
    version: null, proposal: null, proposalStatus: 'idle', chosenBump: null, note: '', initialVersion: '1.0.0',
    infoKnown: false, proposalGeneration: 0, collectGeneration: 0, proposalSource: 'check',
  };
}

/** The local proposal for a library with no id: nothing to diff against. */
export function firstPublishProposal(): DryRunResult {
  return {
    currentVersion: null, unchanged: false, minimumBump: null, proposedVersion: '1.0.0',
    counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
  };
}

/** The proposal right after a publish: unchanged since the assigned version.
 *  Not null, so `versionBlock` never shows PROPOSAL_FAILED_MESSAGE under a
 *  publish that just succeeded. */
export function publishedProposal(version: string): DryRunResult {
  return {
    currentVersion: version, unchanged: true, minimumBump: null, proposedVersion: null,
    counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
  };
}

export const PROPOSAL_FAILED_MESSAGE =
  'Couldn’t check what changed, so there’s no version to preview. '
  + 'If you publish, Spec Layer picks the smallest version change the edits need.';
export const BELOW_MINIMUM_MESSAGE = (minimum: Bump): string => `These edits need at least a ${minimum} version change.`;
const INVALID_FIRST_VERSION = 'The first version needs three numbers, like 1.0.0.';

/** The bump the publish will send: the choice when it is at or above the
 *  minimum, else none (the proxy applies the minimum). */
export function effectiveBump(s: Readonly<PublishState>): Bump | null {
  if (!s.chosenBump) return null;
  const minimum = s.proposal?.minimumBump ?? 'patch';
  return compareBump(s.chosenBump, minimum) >= 0 ? s.chosenBump : null;
}

/** The proxy's answer is the authority; the stored version is a fallback until
 *  it replies. */
export function currentVersionOf(s: Readonly<PublishState>): string | null {
  return s.proposal?.currentVersion ?? s.version;
}

/**
 * The version a publish would produce now, or null with nothing to propose.
 * The catch keeps a corrupt stored version, which `nextVersion` throws on,
 * from taking the screen down.
 */
export function nextVersionFor(s: Readonly<PublishState>): string | null {
  if (!s.proposal || s.proposal.unchanged || !s.libraryId) return null;
  const current = currentVersionOf(s);
  if (current === null) return s.proposal.proposedVersion;
  const minimum: Bump = s.proposal.minimumBump ?? 'patch';
  const applied = effectiveBump(s) ?? minimum;
  try {
    return nextVersion(current, applied);
  } catch {
    return s.proposal.proposedVersion ?? null;
  }
}

let state: PublishState = createPublishState();

export interface PublishHost {
  repaint(): void;
  send(msg: UiToMain): void;
  /** A publish allowance the proxy just stated. The quota lives in the panel's
   *  state, so the controller cannot repaint the meter itself. */
  onPublishQuota(snapshot: PublishQuotaSnapshot): void;
  /** A success, as a toast. Errors stay in `state.message`, on view. */
  notify(message: string): void;
}

const noopPublishHost: PublishHost = {
  repaint: () => {}, send: () => {}, onPublishQuota: () => {}, notify: () => {},
};
let host: PublishHost = noopPublishHost;

export function setPublishHost(nextHost: PublishHost): void {
  host = nextHost;
}

export function publishState(): Readonly<PublishState> {
  return state;
}

/**
 * Start a publish: ask main to collect this file's sources. `_auth` is unused;
 * onPublishSources recomputes auth when it runs, since a license can change
 * mid-session.
 */
export function onPublishClick(_auth: ProxyAuth): void {
  if (state.status === 'collecting' || state.status === 'uploading') return;
  // Never start a publish that has not decided create or update.
  if (!state.infoKnown) return;
  state = {
    ...state, status: 'collecting', message: null, intent: 'publish',
    // See startDryRun.
    collectGeneration: state.proposalGeneration,
  };
  host.repaint();
  host.send({ type: 'requestPublishSources' });
}

/** The same collect a publish starts, but the reply writes a zip. A snapshot
 *  needs no identity, license or pull key. */
export function onDownloadSkillClick(format: ComponentFormat): void {
  if (state.status === 'collecting' || state.status === 'uploading') return;
  state = { ...state, status: 'collecting', message: null, intent: 'download', downloadFormat: format };
  host.repaint();
  host.send({ type: 'requestPublishSources' });
}

/**
 * Open the publish screen. A library with no id gets the 1.0.0 proposal
 * locally. A known library gets one dry run per session; the proposal stands
 * until a recheck or a publish, so reopening re-extracts nothing.
 */
export function onPublishOpen(): void {
  if (state.status === 'collecting' || state.status === 'uploading') return;
  if (!state.infoKnown) {
    // No proposal and no dry run until the identity is known; re-entered when
    // publishInfo lands. Ask again in case the reply was lost: it is idempotent.
    host.repaint();
    host.send({ type: 'requestPublishInfo' });
    return;
  }
  if (!state.libraryId) {
    state = { ...state, proposal: firstPublishProposal(), proposalStatus: 'idle' };
    host.repaint();
    return;
  }
  if (state.proposal && state.proposalStatus === 'idle') {
    host.repaint();
    return;
  }
  startDryRun();
}

/** "Check again": a fresh dry run replacing the held proposal. */
export function onPublishRecheck(): void {
  if (state.status === 'collecting' || state.status === 'uploading' || !state.libraryId) return;
  startDryRun();
}

function startDryRun(): void {
  state = {
    ...state, status: 'collecting', intent: 'dryRun', proposalStatus: 'loading', message: null,
    // Stamped so onPublishSources can tell whether anything invalidated the
    // proposal while this collect was in flight.
    collectGeneration: state.proposalGeneration,
  };
  host.repaint();
  host.send({ type: 'requestPublishSources' });
}

/**
 * Called wherever the session may have changed what a publish would contain:
 * a doc created, updated, rebuilt, detached or removed, a Foundation build, or
 * a Library update batch finishing.
 *
 * The generation bump always runs, so an in-flight collect is caught by its
 * `collectGeneration` check. The proposal is cleared only while idle: a busy
 * publish or dry run ends with its own true answer.
 */
export function invalidatePublishProposal(): void {
  state = { ...state, proposalGeneration: state.proposalGeneration + 1 };
  if (state.status === 'collecting' || state.status === 'uploading') return;
  if (!state.proposal && state.proposalStatus === 'idle') return;
  state = { ...state, proposal: null, proposalStatus: 'idle', chosenBump: null };
  host.repaint();
}

export function onBumpChoice(bump: Bump): void {
  state = { ...state, chosenBump: bump };
  host.repaint();
}

export function onNoteInput(text: string): void {
  state = { ...state, note: text.slice(0, 500) };
  // No repaint: it would move the caret.
}

export function onInitialVersionInput(text: string): void {
  state = { ...state, initialVersion: text.trim() };
}

/** All intents share this guard but not its wording: a download that stops
 *  here never touched the proxy, so "published" would be a false claim. */
function skippedMessage(skipped: Array<{ name: string; reason: string }>, intent: PublishState['intent']): string {
  const names = skipped.map((s) => s.name).join(', ');
  const count = skipped.length;
  const found = `${count} component${count === 1 ? '' : 's'} couldn’t be read: ${names}.`;
  return intent === 'download'
    ? `Nothing was downloaded. ${found} Fix or remove those docs, then download again.`
    : `Nothing was published. ${found} Fix or remove those docs, then publish again.`;
}

/**
 * Why a publish or download would carry nothing, or null. The proxy accepts an
 * empty bundle, which would spend the free library or wipe what developers
 * pull. A failed variable read (`unavailable`, or null) is not "add variables".
 */
export function emptyBundleMessage(
  msg: Pick<PublishSourcesMsg, 'components' | 'foundation'>,
  intent: PublishState['intent'],
): string | null {
  if (msg.components.length > 0) return null;
  const f = msg.foundation;
  if (f && (f.collections.length > 0 || f.textStyles.length > 0 || f.effectStyles.length > 0)) return null;
  const verb = intent === 'download' ? 'downloaded' : 'published';
  if (!f || f.unavailable) {
    return `Nothing was ${verb}. Couldn’t read this file’s variables and styles, and it has no component docs. Try again.`;
  }
  return `Nothing was ${verb}. This file has no local variables or styles and no component docs yet. Add a variable or style, or create a doc, then try again.`;
}

/** When the download branch throws, so the controller lands in `error` rather
 *  than stuck in `collecting`. Names what failed without inventing why. */
const DOWNLOAD_FAILED_MESSAGE =
  'Couldn’t create the download. Nothing was saved. Try again, or reopen the plugin if it keeps happening.';

/** When building the bundle throws. The error's text is detail, so it goes
 *  last in parentheses, as in `sourcesErrorMessage`. */
function buildFailedMessage(err: unknown): string {
  const sentence = 'Couldn’t build the library from this file’s docs. Nothing was published. '
    + 'Try again, or reopen the plugin if it keeps happening.';
  const detail = (err instanceof Error ? err.message : String(err ?? '')).trim().replace(/\.$/, '');
  return detail ? `${sentence} (${detail})` : sentence;
}

const GONE_MESSAGE =
  'Couldn’t publish. Spec Layer no longer has this library. '
  + 'Publish again to create a new one, then share its new setup command with your developers.';

/** Stamp only when the proxy named a version; otherwise record the date, so
 *  no pill claims a version nobody assigned. */
function stamp(libraryId: string, version: string | null, publishedAt: string, stamps: PublishStamps): void {
  if (version === null) {
    host.send({ type: 'setPublishedAt', libraryId, publishedAt });
    return;
  }
  host.send({
    type: 'stampPublished', libraryId, version, publishedAt,
    components: stamps.components, foundation: stamps.foundation,
  });
}

export async function onPublishSources(
  msg: PublishSourcesMsg,
  auth: ProxyAuth,
  fetcher?: typeof fetch,
): Promise<void> {
  // The reply carries the file's identity; take it rather than mark it known
  // with no id, which would read as "Not published". Only a download can get
  // here before the identity is known.
  state = state.infoKnown
    ? state
    : {
      ...state, infoKnown: true,
      libraryId: msg.publishInfo.libraryId, pullKey: msg.publishInfo.pullKey,
      lastPublishedAt: msg.publishInfo.publishedAt, version: msg.publishInfo.version,
    };
  if (state.intent === 'dryRun' && state.collectGeneration !== state.proposalGeneration) {
    // Invalidated after this collect was sent: its sources are stale. Ask again.
    startDryRun();
    return;
  }
  if (msg.skipped.length > 0) {
    if (state.intent === 'dryRun') {
      state = { ...state, status: 'idle', proposalStatus: 'failed', message: null };
    } else {
      state = { ...state, status: 'error', message: skippedMessage(msg.skipped, state.intent) };
    }
    host.repaint();
    return;
  }

  // A dry run is left alone: it only diffs, and an empty answer is honest.
  const empty = state.intent === 'dryRun' ? null : emptyBundleMessage(msg, state.intent);
  if (empty) {
    state = { ...state, status: 'error', message: empty };
    host.repaint();
    return;
  }

  if (state.intent === 'download') {
    try {
      const generatedAt = new Date().toISOString();
      const bundle = buildPublishBundle(msg, generatedAt);
      downloadBytes(
        zipFiles(buildSkillFiles(bundle, generatedAt, state.downloadFormat)),
        skillZipFilename(bundle.fileName),
        'application/zip',
      );
    } catch {
      state = { ...state, status: 'error', message: DOWNLOAD_FAILED_MESSAGE };
      host.repaint();
      return;
    }
    // No completion message comes back from a download, so return to idle
    // here. A snapshot is not a publish: the identity is unchanged.
    state = { ...state, status: 'idle', message: null };
    host.repaint();
    // The browser can still refuse to save, so claim only that it started.
    host.notify('Snapshot download started.');
    return;
  }

  if (state.intent === 'dryRun') {
    const libraryId = state.libraryId ?? msg.publishInfo.libraryId;
    const pullKey = state.pullKey ?? msg.publishInfo.pullKey;
    if (!libraryId) {
      state = { ...state, status: 'idle', proposal: firstPublishProposal(), proposalStatus: 'idle' };
      host.repaint();
      return;
    }
    let bundle: PublishBundleV1;
    try {
      ({ bundle } = buildPublishArtifacts(msg, new Date().toISOString()));
    } catch {
      // Staying in `collecting` would block Publish for the session; a failed
      // check is honest, and the proxy still applies the minimum.
      state = { ...state, status: 'idle', proposal: null, proposalStatus: 'failed', message: null };
      host.repaint();
      return;
    }
    const answer = await dryRunBundle(bundle, { auth, libraryId, pullKey, fetcher });
    if (state.collectGeneration !== state.proposalGeneration) {
      // Invalidated while the dry-run POST was in flight. Ask again.
      startDryRun();
      return;
    }
    state = answer.kind === 'ok'
      ? { ...state, status: 'idle', proposal: answer.result, proposalStatus: 'idle', proposalSource: 'check' }
      : { ...state, status: 'idle', proposal: null, proposalStatus: 'failed' };
    host.repaint();
    return;
  }

  // Session state wins; otherwise the identity main read in this round trip,
  // so a late publishInfo reply cannot cause a duplicate create.
  const libraryId = state.libraryId ?? msg.publishInfo.libraryId;
  const pullKey = state.pullKey ?? msg.publishInfo.pullKey;
  const lastPublishedAt = state.lastPublishedAt ?? msg.publishInfo.publishedAt;

  // A pre-versioning library gets 1.0.0 from the proxy (the spec's rule), so
  // only a create needs a valid first version.
  if (!libraryId && !isSemver(state.initialVersion)) {
    state = { ...state, status: 'error', message: INVALID_FIRST_VERSION };
    host.repaint();
    return;
  }

  state = { ...state, status: 'uploading', libraryId, pullKey, lastPublishedAt };
  host.repaint();

  let artifacts: { bundle: PublishBundleV1; stamps: PublishStamps };
  try {
    artifacts = buildPublishArtifacts(msg, new Date().toISOString());
  } catch (err) {
    // Staying in `uploading` would block Publish for the session.
    state = { ...state, status: 'error', message: buildFailedMessage(err) };
    host.repaint();
    return;
  }
  const { bundle, stamps } = artifacts;
  const { outcome, quota } = await publishBundle(bundle, {
    auth, libraryId, pullKey, fetcher,
    bump: effectiveBump(state),
    note: state.note.trim() || null,
    initialVersion: libraryId ? null : state.initialVersion,
  });
  // Before the repaint, so one paint shows the result and the new count.
  if (quota) host.onPublishQuota(quota);

  // Invalidated mid-upload: the id, version and stamps are still the proxy's
  // real answer, but "nothing changed since <version>" is not, so the cases
  // below keep no proposal rather than guess.
  const collectStale = state.collectGeneration !== state.proposalGeneration;

  switch (outcome.kind) {
    case 'created':
      state = {
        ...state,
        status: 'done',
        libraryId: outcome.libraryId,
        pullKey: outcome.pullKey,
        lastPublishedAt: outcome.publishedAt,
        version: outcome.version ?? state.version,
        message: null,
        chosenBump: null,
        note: '',
        // See publishedProposal. With no version named there is nothing to
        // propose against; the next open dry-runs afresh.
        proposal: !collectStale && outcome.version ? publishedProposal(outcome.version) : null,
        proposalStatus: 'idle',
        proposalSource: 'publish',
      };
      host.send({ type: 'setPublishInfo', libraryId: outcome.libraryId, pullKey: outcome.pullKey });
      stamp(outcome.libraryId, outcome.version, outcome.publishedAt, stamps);
      host.notify(
        outcome.version
          ? `Published ${outcome.version}. Anyone with the pull key can pull this version.`
          : 'Published. Anyone with the pull key can pull this version.',
      );
      break;
    case 'updated':
      state = {
        ...state,
        status: 'done',
        libraryId: outcome.libraryId,
        lastPublishedAt: outcome.publishedAt,
        version: outcome.version ?? state.version,
        message: null,
        chosenBump: null,
        note: '',
        // See the 'created' case.
        proposal: !collectStale && outcome.version ? publishedProposal(outcome.version) : null,
        proposalStatus: 'idle',
        proposalSource: 'publish',
      };
      stamp(outcome.libraryId, outcome.version, outcome.publishedAt, stamps);
      host.notify(
        outcome.version
          ? `Published ${outcome.version}. Developers get this version on their next pull.`
          : 'Published. Developers get this version on their next pull.',
      );
      break;
    case 'unchanged': {
      // The answer carries the true last-published date. No doc gets a fresh
      // stamp, and the proposal settles to "nothing changed" so the screen
      // stops offering a version the proxy will not assign.
      const version = outcome.version ?? state.version;
      state = {
        ...state,
        status: 'done',
        libraryId: outcome.libraryId,
        lastPublishedAt: outcome.publishedAt,
        version,
        message: null,
        chosenBump: null,
        proposal: !collectStale && version ? publishedProposal(version) : null,
        proposalStatus: 'idle',
        proposalSource: 'publish',
      };
      host.send({ type: 'setPublishedAt', libraryId: outcome.libraryId, publishedAt: outcome.publishedAt });
      host.notify('Nothing changed since the last publish.');
      break;
    }
    case 'below_minimum':
      // Show the server's floor without a second dry run. Nothing was
      // published, so the source is 'check'. If the collect went stale, that
      // floor describes a bundle that no longer matches, so none is kept.
      state = {
        ...state,
        status: 'error',
        chosenBump: null,
        message: BELOW_MINIMUM_MESSAGE(outcome.minimumBump),
        proposal: collectStale ? null : {
          ...(state.proposal ?? firstPublishProposal()),
          currentVersion: state.proposal?.currentVersion ?? state.version,
          unchanged: false,
          minimumBump: outcome.minimumBump,
          proposedVersion: outcome.proposedVersion,
        },
        proposalStatus: 'idle',
        proposalSource: 'check',
      };
      break;
    case 'gone':
      // Never recreate silently: developers pulling the old id would be
      // stranded. Drop the identity here and in the file so the next click is
      // a deliberate create, and its version, proposal and bump with it.
      state = {
        ...state,
        status: 'error',
        libraryId: null,
        pullKey: null,
        lastPublishedAt: null,
        message: GONE_MESSAGE,
        version: null,
        proposal: null,
        proposalStatus: 'idle',
        chosenBump: null,
      };
      host.send({ type: 'clearPublishInfo' });
      break;
    case 'error':
      state = { ...state, status: 'error', message: outcome.message };
      break;
  }
  host.repaint();
}

/** Reached on every intent, so worded per intent as in skippedMessage. */
function sourcesErrorMessage(message: string, intent: PublishState['intent']): string {
  const outcome = intent === 'download' ? 'downloaded' : 'published';
  const sentence = `Couldn’t read this file’s docs. Nothing was ${outcome}. `
    + 'Try again, or reopen the plugin if it keeps happening.';
  // `message` is the caught error's text: detail, last, in parentheses, with
  // its own trailing period dropped and nothing added when empty.
  const detail = message.trim().replace(/\.$/, '');
  return detail ? `${sentence} (${detail})` : sentence;
}

export function onPublishSourcesError(message: string): void {
  if (state.intent === 'dryRun') {
    state = { ...state, status: 'idle', proposalStatus: 'failed', message: null };
  } else {
    state = { ...state, status: 'error', message: sourcesErrorMessage(message, state.intent) };
  }
  host.repaint();
}

/**
 * Seed the identity from what was persisted for this file. Only while idle:
 * once a publish or rotate has run, its in-memory result is the truth, and a
 * slow reply must not clobber it.
 */
export function onPublishInfo(msg: PublishInfoMsg): void {
  if (state.status !== 'idle') {
    if (!state.infoKnown) {
      // Before the identity is known only a download can be running, which
      // never touches it, so take the reply's.
      state = {
        ...state, infoKnown: true,
        libraryId: msg.libraryId, pullKey: msg.pullKey, lastPublishedAt: msg.publishedAt, version: msg.version,
      };
      host.repaint();
      return;
    }
    // A publish or rotate owns the identity now; only `infoKnown` may land.
    state = { ...state, infoKnown: true };
    host.repaint();
    return;
  }
  // A new library id: a proposal or bump computed for the old one is void.
  const identityChanged = msg.libraryId !== state.libraryId;
  state = {
    ...state, infoKnown: true,
    libraryId: msg.libraryId, pullKey: msg.pullKey, lastPublishedAt: msg.publishedAt, version: msg.version,
    ...(identityChanged ? { proposal: null, proposalStatus: 'idle' as const, chosenBump: null } : {}),
  };
  host.repaint();
}

export const isPublishBusy = (s: Readonly<PublishState>): boolean =>
  s.status === 'collecting' || s.status === 'uploading';

/** A `data-publish-bump` value is one of the three bumps, or it is ignored. */
export function isBump(value: string): value is Bump {
  return value === 'patch' || value === 'minor' || value === 'major';
}

export async function onRotateClick(auth: ProxyAuth, fetcher?: typeof fetch): Promise<void> {
  const libraryId = state.libraryId;
  // A rotate racing an upload would overwrite each other's result on the
  // server, and a failed rotate mid-upload would re-enable Publish.
  if (!libraryId || isPublishBusy(state)) return;
  const outcome = await rotatePullKey(libraryId, auth, fetcher, state.pullKey);
  if (outcome.kind === 'rotated') {
    state = {
      ...state,
      status: 'done',
      pullKey: outcome.pullKey,
      message: null,
    };
    host.send({ type: 'setPublishInfo', libraryId, pullKey: outcome.pullKey });
    host.notify('Pull key rotated. The old key stops working within about a minute. Share the new setup command.');
  } else {
    state = { ...state, status: 'error', message: outcome.message };
  }
  host.repaint();
}
