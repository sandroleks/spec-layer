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
  compareBump, isSemver, nextVersion, specContentHash, proseToLegacy,
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
    /** Every variant instance, name and axis values, so the proxy's diff can
     *  compare bindings per variant (libraryDiff.ts). */
    variants: Array<{ name: string; values: Record<string, string> }>;
  }>;
}

export interface PublishStamps {
  components: PublishStampComponent[];
  /** The Foundation dump the bundle was built from, or null when it carried
   *  none. Sent verbatim on `stampPublished` so foundation docs are stamped
   *  with the hash of exactly the published content, without a second live
   *  read of the file. */
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
      exportId: `foundation:${spec.fileKey && spec.fileKey !== 'unknown' ? spec.fileKey : 'local'}:${generatedAt}`,
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
      // The same extraction the doc's Generate ran (actions.ts passes the same
      // options), hashed both ways a doc can be configured, so the main thread
      // can stamp each doc with the hash its own includeHidden produces.
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
        // The v5 artifact still reads the v1 shape; the doc stores v2.
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
  /** The proxy refused because the chosen bump undercounts the actual changes.
   *  Carries the minimum it will accept and the version that bump produces, so
   *  the screen can re-render with both without a second round trip. */
  | { kind: 'below_minimum'; minimumBump: Bump; proposedVersion: string }
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

/** Bytes as "5.6 MB", with no decimal when it is whole, or the raw value when it is not a number. */
function megabytes(bytes: unknown): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return String(bytes);
  const mb = bytes / 1_000_000;
  return `${Number.isInteger(mb) ? String(mb) : mb.toFixed(1)} MB`;
}

const NOT_OWNER =
  'Couldn’t publish. This library belongs to another account, or this device doesn’t have its current pull key. '
  + 'Publish from the device that first published it or last rotated its key.';

/**
 * The spent allowance, in the server's own number. The 402 carries the
 * publish quota headers, so the count is read from them rather than written
 * here, where it could drift from the proxy's limit. A response without them
 * gets the sentence with no number, never a guessed one.
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
    // A bearer-only request with a key that is not buying Pro. Say what the
    // proxy said about the key rather than asking for one already entered.
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
      // count can exceed one; name the first and say how many there are.
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
 * The library's pull key travels with every write to it. A Figma identity is
 * not a secret, so for a library created on a free plan the proxy accepts an
 * update or a rotate only from a caller who also holds the key it handed out.
 */
const withPullKey = (headers: Record<string, string>, pullKey: string | null | undefined): Record<string, string> =>
  pullKey ? { ...headers, 'X-Pull-Key': pullKey } : headers;

export async function publishBundle(
  bundle: PublishBundleV1,
  opts: {
    auth: ProxyAuth; libraryId: string | null; pullKey?: string | null; fetcher?: typeof fetch;
    /** The publisher's raise. Omitted or null lets the proxy apply the
     *  minimum bump the changes require. */
    bump?: Bump | null;
    note?: string | null;
    /** Only meaningful on a create; the proxy ignores it on an update, since
     *  an existing library already has a version. */
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
  // Read the allowance off every answer that states one, refusals included: a
  // 402 is exactly when the screen's count matters most.
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
  // Only a library the proxy no longer has is gone. A 403 means it exists and
  // someone else owns it (or this device lacks its key): the id in the file
  // is still the one developers pull, so it must stay put.
  if (opts.libraryId && res.status === 404) return result({ kind: 'gone' });
  return result({ kind: 'error', message: publishErrorCopy(res.status, body, quota) });
}

/**
 * The screen shows no dry-run message (a failed dry run reads as
 * PROPOSAL_FAILED_MESSAGE in the version block), so a request that never
 * reached the proxy carries none. The refusals keep theirs for a caller that
 * wants to show one.
 */
export async function dryRunBundle(
  bundle: PublishBundleV1,
  opts: { auth: ProxyAuth; libraryId: string; pullKey?: string | null; fetcher?: typeof fetch },
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
  // Same guard as the history fetch: the id is interpolated into the path
  // while the caller's key rides in the header.
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
  // Ownership is proved by the identity that published (the license key, or
  // the Figma account together with the current pull key), so a teammate
  // looking at the file's id can reach the button and be refused. Say what
  // it takes, rather than quoting the status code.
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

/**
 * The flag a setup line carries for the component format. Empty for YAML, the
 * CLI's default, so the YAML command stays exactly what it always was. The
 * CLI's `setup` stores the flag in speclayer.json, so every later pull in that
 * repository writes the same format.
 */
function formatFlag(format: ComponentFormat): string {
  return format === 'md' ? ' --component-format md' : '';
}

export function setupCommand(libraryId: string, pullKey: string, format: ComponentFormat): string {
  return `npx spec-layer setup --id ${libraryId} --key ${pullKey}${formatFlag(format)}`;
}

/**
 * The same setup, phrased for a coding agent a developer pastes it to. It
 * carries `--yes` because an unattended npx run otherwise stops to ask before
 * downloading the package, and it ends with the command that writes the
 * agent's guide to the pulled files, since an agent that only receives the
 * setup line has no way to know what landed or how to read it.
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
  /** Which action the in-flight collect belongs to. All three actions share
   *  one round trip to the main thread, and only this says which reply
   *  handler should run. */
  intent: 'publish' | 'download' | 'dryRun';
  /** The component format the in-flight download was started with. Read at
   *  the click, so a change in Settings during the collect cannot change the
   *  zip. Only a download reads it. */
  downloadFormat: ComponentFormat;
  /** The library's current version as last reported; null before the first
   *  versioned publish. */
  version: string | null;
  /** The last dry-run answer, or the local first-publish proposal. Null while
   *  none is known. */
  proposal: DryRunResult | null;
  proposalStatus: 'idle' | 'loading' | 'failed';
  /** The publisher's raise. Null means "apply the minimum". */
  chosenBump: Bump | null;
  note: string;
  /** The editable first version, only sent on a create. */
  initialVersion: string;
  /**
   * Whether this session has heard the file's publish identity: a
   * `publishInfo` reply, or a `publishSources` reply (which carries it).
   * Until then the screen shows neither "Published" nor "Not published" and
   * proposes no version, since either would be a guess about the file.
   */
  infoKnown: boolean;
  /**
   * Bumped by `invalidatePublishProposal` every time something in this
   * session could have changed what a publish would contain: a doc created,
   * updated, or rebuilt; a Foundation build; a doc detached or removed; or a
   * Library update batch finishing. Compared against `collectGeneration` so a
   * collect already in flight when one of those lands can tell its own
   * answer is about to be stale (see `onPublishSources`).
   */
  proposalGeneration: number;
  /**
   * The `proposalGeneration` in effect when the current (or most recent)
   * collect for a dry run or a publish was sent (`requestPublishSources`).
   * Checked against `proposalGeneration` both when that collect's sources
   * reply lands and again after the proxy call it triggers resolves, so an
   * invalidation landing while sources were being gathered, or while the
   * network call was in flight, is caught rather than the stale answer it
   * produced landing as if it were still current. A download never reads
   * this: a snapshot is not a proposal and cannot go stale the same way.
   */
  collectGeneration: number;
  /**
   * Where the current `proposal` came from, so the version block can word
   * its "checked" note honestly. A dry run only ever answers for the moment
   * it ran; canvas edits since then are invisible to it. A publish's own
   * result is different: it reflects exactly what that publish just sent,
   * with nothing for "Check again" to add until something changes after it.
   */
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

/** The local proposal for a library with no id yet: no proxy round trip can
 *  answer this, since there is nothing published to diff against. */
export function firstPublishProposal(): DryRunResult {
  return {
    currentVersion: null, unchanged: false, minimumBump: null, proposedVersion: '1.0.0',
    counts: { major: 0, minor: 0, patch: 0 }, changes: [], changesTruncated: false,
  };
}

/**
 * The proposal to show right after a publish just landed: nothing changed
 * since the version the proxy just assigned, since no dry run has run since.
 * Used instead of a bare `proposal: null` so `versionBlock` never falls back
 * to `PROPOSAL_FAILED_MESSAGE` (a failure) under a publish that just
 * succeeded.
 */
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

/**
 * The version to show as "current". The proxy's own answer (the dry run or
 * the last publish's proposal) is the authority; the locally stored version
 * is only a fallback for a screen that has not heard back from the proxy yet.
 */
export function currentVersionOf(s: Readonly<PublishState>): string | null {
  return s.proposal?.currentVersion ?? s.version;
}

/**
 * The version a publish would produce right now, or null when there is
 * nothing to propose: no proposal known yet, the proposal says nothing
 * changed, or there is no library to version at all. `nextVersion` throws on
 * a current version it cannot parse; a version the proxy assigned is always a
 * semver, but the guard costs nothing and keeps a corrupt value from taking
 * the whole screen down with it.
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
  /**
   * A publish allowance the proxy just stated. The controller cannot repaint
   * the meter itself: the quota lives in the panel's state, and without this
   * the screen would keep showing the count from the last quota fetch after
   * spending an update.
   */
  onPublishQuota(snapshot: PublishQuotaSnapshot): void;
  /**
   * A success to announce as a toast. Successes leave the screen (a published
   * library shows its commands, a rotated key shows its new command), so the
   * confirmation is a passing notice, not a line that sits under the blocks
   * until the next action. Errors stay in `state.message` instead, where the
   * screen keeps them on view.
   */
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
  // The button is disabled until the identity is known (see
  // publishFooterMarkup), so this only guards a click that reached here some
  // other way; it must not start a publish that has not decided create or
  // update yet.
  if (!state.infoKnown) return;
  state = {
    ...state, status: 'collecting', message: null, intent: 'publish',
    // Stamped for the same reason startDryRun stamps it: so the outcome that
    // eventually lands (created/updated/unchanged, below) can tell whether
    // something invalidated the proposal while this publish's own network
    // call was in flight.
    collectGeneration: state.proposalGeneration,
  };
  host.repaint();
  host.send({ type: 'requestPublishSources' });
}

/**
 * Start a download: the same collect a publish starts, marked so the reply
 * writes a zip instead of contacting the proxy. Takes no auth because a
 * snapshot needs no identity, no license, and no pull key. The format is
 * taken now, from the caller, and held for the reply.
 */
export function onDownloadSkillClick(format: ComponentFormat): void {
  if (state.status === 'collecting' || state.status === 'uploading') return;
  state = { ...state, status: 'collecting', message: null, intent: 'download', downloadFormat: format };
  host.repaint();
  host.send({ type: 'requestPublishSources' });
}

/**
 * Open the publish screen. A library with no id yet has nothing to diff
 * against, so it gets the fixed 1.0.0 proposal locally, with no round trip.
 * A known library gets a dry run once per session: a proposal this session
 * already holds stands until the publisher asks again (onPublishRecheck) or
 * publishes. Every open used to re-extract every component and post a dry
 * run, for a screen that had not changed.
 */
export function onPublishOpen(): void {
  if (state.status === 'collecting' || state.status === 'uploading') return;
  if (!state.infoKnown) {
    // Nothing is known about this file yet: no first-publish proposal (it
    // would read as "not published" for a file that is) and no dry run
    // (there is no id to run it against). The controller re-enters here
    // when publishInfo lands. Ask again rather than leaving the pane
    // waiting forever on a reply that may have been lost: the request is
    // idempotent, and this is the one path that gets another try each time
    // the reader opens Publish.
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

/** The version block's "Check again": a dry run the publisher asked for,
 *  replacing whatever proposal this session holds. */
export function onPublishRecheck(): void {
  if (state.status === 'collecting' || state.status === 'uploading' || !state.libraryId) return;
  startDryRun();
}

function startDryRun(): void {
  state = {
    ...state, status: 'collecting', intent: 'dryRun', proposalStatus: 'loading', message: null,
    // The sources this collect is about to gather answer for the file as it
    // stands right now: stamp the request with the current generation so
    // onPublishSources can tell, when the reply lands, whether anything
    // invalidated the proposal in the meantime.
    collectGeneration: state.proposalGeneration,
  };
  host.repaint();
  host.send({ type: 'requestPublishSources' });
}

/**
 * Called wherever something in this session could have changed what a
 * publish would contain: a doc created, updated, or rebuilt; a Foundation
 * build; a doc detached or removed; or a Library update batch finishing (see
 * each call site in ui-vnext.ts). A proposal computed before any of these no
 * longer describes the file and must not keep being shown, or land, as if it
 * still did.
 *
 * The generation bump always runs, busy or not: a collect already in flight
 * (a dry run's sources request, or a publish's) was launched against the
 * file as it stood before this call, so its reply, and the proxy call it
 * makes, are each checked against the generation the collect was sent with
 * (`collectGeneration`, in `onPublishSources`, at both points) and discarded
 * or corrected in favor of the truth, if this has moved past it. Clearing the
 * proposal itself only happens while idle: a publish in flight, or a dry run
 * already loading, ends with its own true answer (the outcome branches in
 * `onPublishSources`), so clearing here first would only be overwritten a
 * moment later, or would blank a "Checking…" note that is already honest
 * about not having an answer yet.
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
  // No repaint: the textarea already shows the text, and a repaint would move
  // the caret.
}

export function onInitialVersionInput(text: string): void {
  state = { ...state, initialVersion: text.trim() };
}

/**
 * The publish, download and dry-run intents share this one guard (see
 * `onPublishSources`, first check), but they must not share its wording: a
 * download or a dry run that stops here never touched the proxy, and telling
 * that user something was "published" would be a fabricated claim about
 * their own action. Only the verb, its object, and the retry step vary; the
 * count and the component names are identical either way.
 */
function skippedMessage(skipped: Array<{ name: string; reason: string }>, intent: PublishState['intent']): string {
  const names = skipped.map((s) => s.name).join(', ');
  const count = skipped.length;
  const found = `${count} component${count === 1 ? '' : 's'} couldn’t be read: ${names}.`;
  return intent === 'download'
    ? `Nothing was downloaded. ${found} Fix or remove those docs, then download again.`
    : `Nothing was published. ${found} Fix or remove those docs, then publish again.`;
}

/**
 * Why a publish or download would carry nothing, or null when it would carry
 * something. The proxy accepts an empty bundle, so without this a first
 * publish of an empty file creates a library, a pull key, and spends the free
 * plan's one library; a republish would replace what developers pull with
 * nothing. A failed variable read also arrives empty (`unavailable`, or null
 * when the read threw), and asking that user to add variables would be wrong.
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

/** Shown when the download branch itself throws (a `Blob`/`URL`/`document`
 *  failure, or a bad zip), so the controller lands in `error` instead of
 *  staying in `collecting` with both entry points guard-blocked and no
 *  message on screen. Names what failed without inventing why. */
const DOWNLOAD_FAILED_MESSAGE =
  'Couldn’t create the download. Nothing was saved. Try again, or reopen the plugin if it keeps happening.';

/**
 * Shown when building the bundle for a publish throws (a source the extractor
 * cannot read). The fixed sentence says what happened; the caught error's own
 * text is technical detail, so it goes last, in parentheses, the way
 * `sourcesErrorMessage` places it.
 */
function buildFailedMessage(err: unknown): string {
  const sentence = 'Couldn’t build the library from this file’s docs. Nothing was published. '
    + 'Try again, or reopen the plugin if it keeps happening.';
  const detail = (err instanceof Error ? err.message : String(err ?? '')).trim().replace(/\.$/, '');
  return detail ? `${sentence} (${detail})` : sentence;
}

const GONE_MESSAGE =
  'Couldn’t publish. Spec Layer no longer has this library. '
  + 'Publish again to create a new one, then share its new setup command with your developers.';

/**
 * Stamp only when the proxy named a version. A proxy that predates
 * versioning answers without one; then the date is recorded as before and no
 * pill can claim a version nobody assigned.
 */
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
  // The reply carries the file's identity, so from here it is known whatever
  // else this reply says. Until now it was not known, so no publish or rotate
  // can have run (a publish waits for the identity, a rotate needs the id it
  // carries): take it from the reply rather than mark it known with no id,
  // which would read as "Not published" for a file that is. Only a download
  // can get here first, since it needs no identity.
  state = state.infoKnown
    ? state
    : {
      ...state, infoKnown: true,
      libraryId: msg.publishInfo.libraryId, pullKey: msg.publishInfo.pullKey,
      lastPublishedAt: msg.publishInfo.publishedAt, version: msg.publishInfo.version,
    };
  if (state.intent === 'dryRun' && state.collectGeneration !== state.proposalGeneration) {
    // Something invalidated the proposal (a doc changed, a library update
    // batch finished, ...) after this collect was sent: the sources it
    // carries answer for a file that no longer exists. Discard them and ask
    // again against the file as it stands now, rather than showing a
    // proposal computed from stale sources as if it were current.
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
      // No completion message comes back from a download either way, so a
      // throw here (a DOM failure, a bad zip) must recover the controller
      // itself rather than leaving `collecting` with both entry points
      // guard-blocked and nothing on screen.
      state = { ...state, status: 'error', message: DOWNLOAD_FAILED_MESSAGE };
      host.repaint();
      return;
    }
    // No completion message comes back from a download, so the presenter
    // returns to idle itself. Nothing about the library identity changes
    // (the file's stored one may have been learned above, which is not a
    // change): a snapshot is not a publish.
    state = { ...state, status: 'idle', message: null };
    host.repaint();
    // The file is handed to the browser, which can still refuse to save it,
    // so the toast claims only that the download started.
    host.notify('Snapshot download started.');
    return;
  }

  if (state.intent === 'dryRun') {
    const libraryId = state.libraryId ?? msg.publishInfo.libraryId;
    const pullKey = state.pullKey ?? msg.publishInfo.pullKey;
    if (!libraryId) {
      // Nothing published yet to diff against: the fixed local proposal
      // stands, and no round trip was ever needed.
      state = { ...state, status: 'idle', proposal: firstPublishProposal(), proposalStatus: 'idle' };
      host.repaint();
      return;
    }
    let bundle: PublishBundleV1;
    try {
      ({ bundle } = buildPublishArtifacts(msg, new Date().toISOString()));
    } catch {
      // A source the extractor cannot build from. Leaving `collecting` here
      // would block every Publish entry for the rest of the session; a failed
      // check is honest, and publishing stays possible (the proxy still
      // applies the minimum).
      state = { ...state, status: 'idle', proposal: null, proposalStatus: 'failed', message: null };
      host.repaint();
      return;
    }
    const answer = await dryRunBundle(bundle, { auth, libraryId, pullKey, fetcher });
    if (state.collectGeneration !== state.proposalGeneration) {
      // Invalidated while the dry-run POST itself was in flight (not just
      // between the collect being sent and its sources landing, which the
      // check above this branch already covers): what came back answers for
      // the file as it stood before that change. Discard it and ask again
      // against the file as it stands now.
      startDryRun();
      return;
    }
    state = answer.kind === 'ok'
      ? { ...state, status: 'idle', proposal: answer.result, proposalStatus: 'idle', proposalSource: 'check' }
      : { ...state, status: 'idle', proposal: null, proposalStatus: 'failed' };
    host.repaint();
    return;
  }

  // What this session already knows wins; otherwise the identity the main
  // thread read from the file in this same round trip. A publishInfo reply
  // that has not landed yet can no longer cost us a republish.
  const libraryId = state.libraryId ?? msg.publishInfo.libraryId;
  const pullKey = state.pullKey ?? msg.publishInfo.pullKey;
  const lastPublishedAt = state.lastPublishedAt ?? msg.publishInfo.publishedAt;

  // A pre-versioning library (one with an id) always gets 1.0.0 from the
  // proxy, which is the spec's rule, so only a true create needs a valid
  // first version before any network call.
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
    // Nothing reached the proxy, so nothing was published. Leaving
    // `uploading` here would block every Publish entry for the rest of the
    // session with nothing on screen to say why.
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
  // Before the repaint below, so one paint shows both the result and the count
  // it left behind.
  if (quota) host.onPublishQuota(quota);

  // Something invalidated the proposal while this publish's own network call
  // was in flight. The result below is still correct either way: the library
  // id, the version, and the stamps all come from the proxy's real answer to
  // the bundle that was actually sent. But "nothing changed since <version>"
  // would not be, since something has changed since the sources for that
  // bundle were collected, and this session no longer knows what: the
  // created, updated, unchanged and below_minimum cases below fall back to
  // no proposal at all (`Press Check again to see what changed.`) rather
  // than guess.
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
        // Nothing changed since the version this publish just assigned: no
        // dry run has run since, so the block must not read as a failed one.
        // A proxy that predates versioning names no version, and there is
        // nothing to propose against; the next Publish open dry-runs afresh.
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
        // See the 'created' case just above: an unchanged proposal for the
        // version just published, not null, so the block never reads as a
        // failed dry run under a publish that just succeeded, unless the
        // collect it was built from went stale mid-upload.
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
      // The unchanged answer carries the stored library's existing date, which
      // is the true last-published time, so it is recorded like the others.
      // Nothing changed, so no doc gets a fresh stamp, and the proposal
      // settles to "nothing changed" so the screen stops offering a next
      // version the proxy just said it would not assign (unless the collect
      // it was computed from went stale mid-upload, in which case that
      // "nothing changed" is exactly what can no longer be trusted).
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
      // Re-render with the server's own minimum and the version it would
      // produce, so the screen shows the real floor without a second dry run.
      // Nothing was actually published (the proxy refused this attempt), so
      // this is a fresh check, not "what you just published": 'check' is the
      // honest source label regardless of what an earlier publish this
      // session set it to. The refusal message stands either way (it is the
      // proxy's answer to what was sent), but if something changed while the
      // upload was in flight, that floor and its next version describe a
      // bundle that no longer matches the file, so no proposal is kept.
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
      // Never recreate on the user's behalf: the developers pulling the old id
      // would be stranded without anyone being told. Drop the stale identity
      // here and in the file so the next click is a deliberate new library.
      // The dead library's version, proposal and chosen bump go with it: the
      // next publish is a create, and none of the three may leak onto it
      // (a resurrected version, a stale minimum behind effectiveBump, or a
      // bump sent alongside initialVersion).
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

/**
 * `requestPublishSources`' outer catch (main.ts) reaches this on every
 * intent, exactly like the `skipped` guard above, so it needs the same
 * intent-aware treatment `skippedMessage` got: a download or a dry run that
 * never read a usable source never touched the proxy, and telling that user
 * something was "published" would be a fabricated claim about their own
 * action.
 */
function sourcesErrorMessage(message: string, intent: PublishState['intent']): string {
  const outcome = intent === 'download' ? 'downloaded' : 'published';
  const sentence = `Couldn’t read this file’s docs. Nothing was ${outcome}. `
    + 'Try again, or reopen the plugin if it keeps happening.';
  // `message` is a caught error's own text (main.ts forwards `err.message`
  // verbatim): technical detail, so it goes last, in parentheses. A trailing
  // period of its own is dropped so the parentheses close cleanly, and an
  // empty one adds nothing rather than a bare "()".
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
 * Seed libraryId, pullKey and lastPublishedAt from what was last persisted
 * for this file, so a fresh session's publish screen can show the setup
 * command, the Rotate action and the last publish date without waiting for a
 * publish. Only takes effect while idle: once a publish (or rotate) has run
 * this session, that in-memory result is the truth, and a slow publishInfo
 * reply landing afterward must not clobber it.
 */
export function onPublishInfo(msg: PublishInfoMsg): void {
  if (state.status !== 'idle') {
    if (!state.infoKnown) {
      // Busy or finished, but before the identity was known no publish or
      // rotate can have run (a publish waits for it, a rotate needs the id
      // it carries), so this is a download, running or failed, which never
      // touches the identity. Take it from the reply: marking it known
      // without it would read as "Not published" for a file that is.
      state = {
        ...state, infoKnown: true,
        libraryId: msg.libraryId, pullKey: msg.pullKey, lastPublishedAt: msg.publishedAt, version: msg.version,
      };
      host.repaint();
      return;
    }
    // A publish or rotate is the truth for the identity now; only the fact
    // that one is known may land.
    state = { ...state, infoKnown: true };
    host.repaint();
    return;
  }
  // A different library id than this (idle) session already holds means the
  // file's saved identity changed since: whatever this session computed
  // against the old one (a proposal, a chosen bump) can no longer answer for
  // the new one.
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
  // A rotate racing an upload would let the two overwrite each other's
  // result on the server, and a failed rotate flipping status mid-upload
  // would re-enable Publish. The button is disabled while busy; this is the
  // guard behind it.
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
