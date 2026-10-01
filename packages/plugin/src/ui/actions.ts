/**
 * The UI's action handlers and module-scoped state. Logic only: view DOM work
 * lives in screens/*.
 */

import {
  extract, ProseProxyError, contentHash, specHashProjection, buildFoundation, knownFileKey,
  buildFoundationArtifactV5, foundationDtcgDocument,
  buildComponentArtifactV5, componentAiContext, toYaml, componentMarkdown,
  proseToLegacy, hasProseContent,
} from '@spec-layer/extractor';
import type {
  SerializedNode, IntermediateSpec, ProseV2Key, ProseV2, ProxyQuota,
  SerializedFoundation, FoundationSpec, FoundationSelection,
  FoundationScope, FoundationGuidelinesV5, YamlValue, GroupDraftInput,
} from '@spec-layer/extractor';
import { EXTRACTOR_VERSION, PROSE_V2_KEYS } from '@spec-layer/extractor';
import type { UiToMain } from '../messages';
import type { DocConfig } from '../docLink';
import { generateProse } from './ai';
import {
  AI_CONSEQUENCE, aiFailedCopy, effectiveAuth, generationErrorCopy, isNetworkFailure,
  unreachableCopy, type AiBuildKind,
} from './proxy';
import { formatResetDate } from './viewModel/allowance';
import { emptyBrandTheme, type BrandTheme } from '../brandColors';
import { DEFAULT_COMPONENT_FORMAT, COMPONENT_FORMAT_NAME, type ComponentFormat } from '../componentFormat';
import {
  buildDocModel, proseKeysForSections,
  type SectionId, type MeasureView, type DocFrameModel, type OmittedSection,
} from './docModel';
import {
  defaultSelection, toggleCollection, toggleMode, toggleTextStyles, toggleEffectStyles,
  selectAll, clearAll, allSelected, groupBriefs,
} from './foundationState';
import { copyText, renderManualCopyModal } from './clipboard';

declare const __PLUGIN_VERSION__: string;

export const pluginBuild = (): string | null =>
  typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : null;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface UiState {
  currentNode: SerializedNode | null;
  currentFileKey: string;
  /** Empty when the selection message carried no file name; the brief then
   *  omits `file_name`. */
  currentFileName: string;
  currentSpec: IntermediateSpec | null;
  currentExtractedAt: string;
  // Pro license key, mirrored to clientStorage by main. figmaUserId is the
  // free-tier identity.
  licenseKey: string | null;
  licenseInstanceId: string | null;
  // Session only: null = not probed yet, true = active, false = known inactive
  // (use the free identity). Never persisted, so a renewal reactivates on reload.
  licenseActive: boolean | null;
  figmaUserId: string | null;
  // Last proxy quota snapshot, null until a request completes.
  quota: ProxyQuota | null;
  quotaExhausted: boolean;
  aiEnabled: boolean;
  // Per user, stored by main; YAML until the boot message says otherwise.
  componentFormat: ComponentFormat;
  generatedProse: ProseV2 | null;
  // Keys the current draft covers. Requesting a key outside it regenerates
  // once; unchecking never does. Null whenever generatedProse is null.
  generatedProseKeys: Set<ProseV2Key> | null;
  // What the last build left out or drew as a placeholder, for the result
  // message. Cleared once reported.
  lastOmitted: OmittedSection[];
  // Set when AI generation fails, so the build notes it instead of aborting.
  pendingAiNote: string;
  // Null fields mean the default.
  brandTheme: BrandTheme;
  // Base64 PNG.
  logoBase64: string | null;
  // Empty falls back to all three in the model.
  measureViews: MeasureView[];
  // Draw the parts a boolean property hides by default, and set those
  // properties on every placed instance. Per component; the screen resets it.
  includeHidden: boolean;
}

export function createState(): UiState {
  return {
    currentNode: null,
    currentFileKey: '',
    currentFileName: '',
    currentSpec: null,
    currentExtractedAt: '',
    licenseKey: null,
    licenseInstanceId: null,
    licenseActive: null,
    figmaUserId: null,
    quota: null,
    quotaExhausted: false,
    aiEnabled: false,
    componentFormat: DEFAULT_COMPONENT_FORMAT,
    generatedProse: null,
    generatedProseKeys: null,
    lastOmitted: [],
    pendingAiNote: '',
    brandTheme: emptyBrandTheme(),
    logoBase64: null,
    measureViews: ['size', 'padding', 'spacing'],
    includeHidden: false,
  };
}

export function send(msg: UiToMain): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

export function renderOne(
  node: SerializedNode,
  fileKey: string,
  /** Absent means the brief omits `file_name` rather than inventing one. */
  fileName?: string,
): { name: string; spec: IntermediateSpec; extractedAt: string } {
  const extractedAt = new Date().toISOString();
  const spec = extract(node, { figmaFile: fileKey, ...(fileName ? { figmaFileName: fileName } : {}) });
  return { name: spec.name, spec, extractedAt };
}

export function ensureExtracted(state: UiState): boolean {
  if (state.currentSpec) return true;
  if (!state.currentNode) return false;
  const { spec, extractedAt } = renderOne(state.currentNode, state.currentFileKey, state.currentFileName);
  state.currentSpec = spec;
  state.currentExtractedAt = extractedAt;
  return true;
}

/**
 * Extract the current selection one frame later, so the panel paints first.
 * `onReading` brackets the synchronous, thread-blocking extraction so a UI can
 * paint a busy state before it starts and after it ends.
 */
export function autoExtract(
  state: UiState,
  onReading: (reading: boolean) => void,
  onReady?: () => void,
): void {
  if (!state.currentNode) return;
  if (state.currentSpec) { onReady?.(); return; }
  onReading(true);
  requestAnimationFrame(() => {
    try {
      ensureExtracted(state);
    } catch {
      /* errors surface when an action actually runs */
    }
    onReading(false);
    onReady?.();
  });
}

/** An AI draft held across a reselection; see draftToKeep. */
export interface KeptDraft {
  specHash: string;
  prose: ProseV2;
  keys: Set<ProseV2Key>;
}

/**
 * Keep the draft only for the component it was written for; restoreDraft
 * restores it only if the spec is unchanged. A reclick spends no AI use, and
 * an edited component is drafted afresh.
 */
export function draftToKeep(state: UiState, nextNodeId: string | undefined): KeptDraft | null {
  if (!nextNodeId || state.currentNode?.id !== nextNodeId) return null;
  if (!state.generatedProse || !state.generatedProseKeys || !state.currentSpec) return null;
  return { specHash: contentHash(state.currentSpec), prose: state.generatedProse, keys: state.generatedProseKeys };
}

/** After the new selection is extracted: keep the draft if the spec is unchanged. */
export function restoreDraft(state: UiState, kept: KeptDraft | null): void {
  if (!kept || !state.currentSpec || contentHash(state.currentSpec) !== kept.specHash) return;
  state.generatedProse = kept.prose;
  state.generatedProseKeys = kept.keys;
}

// ---------------------------------------------------------------------------
// Write with AI
// ---------------------------------------------------------------------------

/** True when there is no draft, or the cached one does not cover every
 *  requested key. Reuse is what keeps a second action from re-billing. */
export function proseNeedsRegen(state: UiState, requested: Set<ProseV2Key>): boolean {
  if (!state.generatedProse || !state.generatedProseKeys) return true;
  for (const k of requested) if (!state.generatedProseKeys.has(k)) return true;
  return false;
}

/** AI runs when the toggle is on and any identity exists — free tier needs no key. */
export function canGenerate(state: UiState): boolean {
  return state.aiEnabled && Boolean(state.licenseKey || state.figmaUserId);
}

/**
 * Whether a Foundations build asks for group descriptions. The AI switch
 * governs every AI call: with it off, a build must not spend a free use.
 */
export function foundationAiRequested(state: UiState, briefs: GroupDraftInput | null): boolean {
  return canGenerate(state) && briefs !== null && briefs.collections.length > 0;
}

export function willGenerateProseFor(state: UiState, sections: Set<SectionId>): boolean {
  if (!canGenerate(state)) return false;
  const requested = proseKeysForSections(sections);
  if (requested.size === 0) return false;
  return proseNeedsRegen(state, requested);
}

/**
 * Note and state effect for a license failure during generation.
 * `unreachable` means the proxy could not reach the license check, so the key
 * is kept and a retry can work; a rebuild's note leaves the retry out.
 */
export function licenseFailureNote(
  reason: string | undefined,
  kind: AiBuildKind = 'component',
): { note: string; markInactive: boolean } {
  const consequence = AI_CONSEQUENCE[kind];
  if (reason === 'unreachable') {
    const note = `Spec Layer couldn’t check your license key, so ${consequence}. Your key is still saved.`;
    return {
      note: kind === 'rebuild' ? note : `${note} Try again in a minute.`,
      markInactive: false,
    };
  }
  return {
    note: `Your Pro subscription isn’t active, so ${consequence}. You’re on the free plan now. Renew Pro on the License screen.`,
    markInactive: true,
  };
}

/**
 * Turn a failed AI request into a note and its effect on state. Create, the
 * rebuild top-up and Foundations all use it, so they explain a failure the
 * same way; `kind` only changes what it cost. The raw error goes to the
 * console, never into the note.
 */
export function aiFailureNote(state: UiState, err: unknown, kind: AiBuildKind): string {
  if (err instanceof ProseProxyError) {
    if (err.code === 'quota_exhausted') {
      state.quotaExhausted = true;
      return quotaExhaustedNote(state.quota, kind);
    }
    if (err.code === 'license_not_active') {
      const { note, markInactive } = licenseFailureNote(err.reason, kind);
      if (markInactive) state.licenseActive = false;
      return note;
    }
    return generationErrorCopy(err.code, kind);
  }
  console.warn('[Spec Layer] AI writing failed:', err);
  return isNetworkFailure(err) ? unreachableCopy(kind) : aiFailedCopy(kind);
}

/** Record a failed generation for the build that asked for it. */
export function noteGenerationError(state: UiState, err: unknown, kind: AiBuildKind = 'component'): void {
  state.pendingAiNote = aiFailureNote(state, err, kind);
}

async function ensureProseFor(state: UiState, sections: Set<SectionId>): Promise<void> {
  state.pendingAiNote = '';
  if (!willGenerateProseFor(state, sections)) return;
  const requested = proseKeysForSections(sections);

  // AI is an enhancement, never a blocker: on failure the frame builds without
  // the AI sections and the note goes on the result.
  try {
    // willGenerateProseFor guarantees identity, spec and node. A known-inactive
    // key drops to the free identity (effectiveAuth) rather than 401ing.
    const draft = await generateProse(
      state.currentSpec!,
      effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, state.licenseActive),
      state.currentNode!.id,
      requested,
      (q) => { state.quota = q; },
    );
    if (draft) {
      // The extractor validated every name against the spec. `dropped` counts
      // what the model invented, logged so a prompt regression is visible.
      const { prose, dropped } = draft;
      const droppedCount = Object.values(dropped).reduce((a, b) => a + (b ?? 0), 0);
      if (droppedCount > 0) console.warn('[Spec Layer] prose items dropped by validation', dropped);
      state.generatedProse = hasProseContent(prose) ? prose : null;
    } else {
      state.generatedProse = null;
    }
    // Only a returned draft records keys, so a null result forces a retry.
    state.generatedProseKeys = state.generatedProse ? requested : null;
  } catch (err) {
    state.generatedProse = null;
    state.generatedProseKeys = null;
    noteGenerationError(state, err);
  }
}

// ---------------------------------------------------------------------------
// Create doc frame
// ---------------------------------------------------------------------------

/** What the user picked, passed as a value so the build never reads the DOM. */
export interface DocSelection {
  sections: Set<SectionId>;
  variantIds: Set<string>;
}

/** How a build reports itself, so one build path serves every screen. */
export interface BuildPresenter {
  clear(): void;
  /** Show a failure the user needs to read. */
  error(message: string): void;
  /** Report an outcome that is not a failure. */
  info(message: string): void;
  /** Disable or re-enable the action that started this build. */
  setBusy(busy: boolean): void;
  startProgress(messages: string[]): void;
  stopProgress(): void;
}

/**
 * Build the doc frame and send it to main. On success progress keeps running
 * until docFrameDone or docFrameError comes back.
 */
export async function createDocFrame(
  state: UiState,
  selection: DocSelection,
  ui: BuildPresenter,
): Promise<void> {
  ui.clear();

  // The screen only offers Create once a component is on it.
  if (!ensureExtracted(state)) return;

  // Stops a double-click building two frames. docFrameDone/docFrameError
  // re-enable it, or the early failures below.
  ui.setBusy(true);
  ui.startProgress(generatingMessages(willGenerateProseFor(state, selection.sections)));

  try {
    const built = await assembleDocFor(state, selection);
    if (!built) {
      ui.error('Select at least one section.');
      ui.setBusy(false);
      ui.stopProgress();
      return;
    }
    const baseline = specHashProjection(state.currentSpec!, { includeHidden: state.includeHidden });
    send({
      type: 'renderDocFrame',
      model: built.model,
      nodeId: state.currentNode!.id,
      contentHash: contentHash(baseline),
      baseline,
      extractorVersion: EXTRACTOR_VERSION,
      config: built.config,
      ...(state.generatedProse ? { prose: state.generatedProse } : {}),
    });
  } catch (err) {
    ui.stopProgress();
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Couldn’t create the docs. Nothing changed on the canvas. (${msg})`);
    ui.setBusy(false);
  }
}

/**
 * Write AI prose if needed, then assemble the DocFrameModel and its stored
 * config. Null when no section is checked: the caller owns how that reads and
 * the loader teardown. Assumes extraction already ran.
 */
async function assembleDocFor(
  state: UiState,
  { sections: selected, variantIds }: DocSelection,
): Promise<{ model: DocFrameModel; config: DocConfig } | null> {
  await ensureProseFor(state, selected);

  if (selected.size === 0) return null;

  const model = buildDocModel(state.currentSpec!, state.generatedProse, selected, variantIds, {
    measureViews: state.measureViews, includeHidden: state.includeHidden,
  });
  state.lastOmitted = model.omitted;
  const config: DocConfig = {
    sections: [...selected],
    variantIds: [...variantIds],
    // What the build ran with, not the checkbox: the rebuild top-up reads it,
    // and a ticked box with no identity got no AI.
    aiEnabled: canGenerate(state),
    anatomyView: 'diagram',
    measureViews: state.measureViews,
    includeHidden: state.includeHidden,
  };
  return { model, config };
}

/** The result message's first sentence. No frame count: a frame is how a doc
 *  is stored, not what the user came for. */
export function resultOutcome(replaced: boolean): string {
  return `Docs ${replaced ? 'updated' : 'created'}.`;
}

/**
 * The result line: the outcome, then one sentence per section left out, then
 * one sentence naming every section drawn as a placeholder.
 */
export function omissionsMessage(outcome: string, omitted: OmittedSection[]): string {
  const parts = [outcome];
  for (const o of omitted) if (o.reason === 'nothingToShow') parts.push(`Left out ${o.label}: nothing to show.`);
  const placeholders = omitted.filter((o) => o.reason === 'placeholder').map((o) => o.label);
  if (placeholders.length) parts.push(`Added placeholders for ${placeholders.join(', ')}. Fill them in on the canvas.`);
  return parts.join(' ');
}

/** Loader lines. The AI path narrates the slow round trip; the no-AI path is
 *  near-instant. */
export function generatingMessages(withAi: boolean): string[] {
  return withAi
    ? [
        'Looking at the component',
        'Writing the guidelines',
        'Composing sections',
        'Placing docs on the canvas',
      ]
    : [
        'Reading the component',
        'Composing sections',
        'Laying out the content',
        'Placing docs on the canvas',
      ];
}

/** The next loader line, or null to hold on the last: wrapping back to the
 *  first line would read as starting over. */
export function nextPhaseIndex(index: number, count: number): number | null {
  return index + 1 < count ? index + 1 : null;
}

// ---------------------------------------------------------------------------
// Settings: update state and persist through main
// ---------------------------------------------------------------------------

export function setLicenseKey(state: UiState, value: string, instanceId: string | null): void {
  const key = value.trim() || null;
  state.licenseKey = key;
  state.licenseInstanceId = key ? instanceId : null;
  send({ type: 'setLicenseKey', value: key ?? '', instanceId: key ? instanceId : null });
}

export function setAiEnabled(state: UiState, value: boolean): void {
  state.aiEnabled = value;
  send({ type: 'setAiEnabled', value });
}

export function setComponentFormat(state: UiState, value: ComponentFormat): void {
  state.componentFormat = value;
  send({ type: 'setComponentFormat', value });
}

export function setBrandTheme(state: UiState, value: BrandTheme): void {
  state.brandTheme = value;
  send({ type: 'setBrandTheme', value });
}

// ---------------------------------------------------------------------------
// Update from source (My Library)
// ---------------------------------------------------------------------------
/** A library row's stored source: what it was built from, and how. */
export type DocSource = {
  docId: string;
  node: SerializedNode;
  fileKey: string;
  /** Absent means the brief omits `file_name`. */
  fileName?: string;
  config: DocConfig;
  /** The writing sections as read off the canvas, the stored blob filling
   *  gaps. Null when the doc has never had guidelines. */
  prose: ProseV2 | null;
};

export async function updateFromSource(
  state: UiState,
  src: DocSource,
  ui: BuildPresenter,
): Promise<boolean> {
  // A fresh extraction plus `src.prose` from the canvas: hand edits survive
  // and an Update never calls the model. The caller holds the build lock;
  // success leaves progress running until docFrameDone/docFrameError
  // releases it, and only a synchronous failure tears down here.
  ui.clear();
  // No lines: the Library shows its own label and uses this only to repaint.
  ui.startProgress([]);
  try {
    const spec = extract(src.node, { figmaFile: src.fileKey, ...(src.fileName ? { figmaFileName: src.fileName } : {}) });
    const selected = new Set<SectionId>(src.config.sections);
    const variantIds = new Set<string>(src.config.variantIds);
    const model = buildDocModel(spec, src.prose, selected, variantIds, {
      measureViews: src.config.measureViews,
      includeHidden: src.config.includeHidden,
    });
    // As in Create, so the Library can name what it left out.
    state.lastOmitted = model.omitted;
    const baseline = specHashProjection(spec, { includeHidden: src.config.includeHidden });
    send({
      type: 'renderDocFrame',
      model,
      nodeId: src.node.id,
      contentHash: contentHash(baseline),
      baseline,
      extractorVersion: EXTRACTOR_VERSION,
      config: src.config,
      ...(src.prose ? { prose: src.prose } : {}),
      docId: src.docId,
    });
    return true;
  } catch (err) {
    ui.stopProgress();
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Couldn’t update this doc. (${msg})`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stale-version rebuild top-up: v2 keys with no v1 source land empty
// ---------------------------------------------------------------------------

function hasKeyContent(prose: ProseV2 | null, key: ProseV2Key): boolean {
  const value = prose?.[key];
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  const overview = value as { lede?: string; body?: string[] };
  return Boolean(overview.lede?.trim()) || (overview.body?.length ?? 0) > 0;
}

/** A person typed `key` on the canvas: never asked of the model or replaced. */
function isAuthored(prose: ProseV2 | null, key: ProseV2Key): boolean {
  return Array.isArray(prose?.authored) && prose.authored.includes(key);
}

/**
 * Keys a stale-version rebuild asks for: every requested key left empty, plus
 * `keyboard`, because v1 keyboard bullets upgrade lossily. Never a key a
 * person wrote.
 */
export function missingProseKeys(prose: ProseV2 | null, requested: ReadonlySet<ProseV2Key>): Set<ProseV2Key> {
  const out = new Set<ProseV2Key>();
  for (const key of requested) {
    if (isAuthored(prose, key)) continue;
    if (key === 'keyboard' || !hasKeyContent(prose, key)) out.add(key);
  }
  return out;
}

/** Stored prose wins where it has content; the draft fills the rest and
 *  replaces keyboard, unless a person wrote it. Null when nothing is left. */
export function mergeTopUp(stored: ProseV2 | null, generated: ProseV2 | null): ProseV2 | null {
  if (!generated) return stored;
  const out: ProseV2 = { ...(stored ?? {}), v: 2 };
  for (const key of PROSE_V2_KEYS) {
    const fresh = generated[key];
    if (fresh === undefined || isAuthored(stored, key)) continue;
    if (key === 'keyboard' || !hasKeyContent(stored, key)) {
      (out as unknown as Record<string, unknown>)[key] = fresh;
    }
  }
  return hasProseContent(out) ? out : null;
}

/**
 * The note when the AI allowance ran out. Only facts the proxy reported: the
 * limit and reset date come from the last quota snapshot and are left out,
 * not guessed, when it lacks them. "Free" only on the free tier, since Pro has
 * its own ceiling.
 */
export function quotaExhaustedNote(
  quota: ProxyQuota | null,
  kind: AiBuildKind = 'component',
): string {
  const free = quota?.tier !== 'pro';
  const limit = quota?.limit;
  const uses = typeof limit === 'number' && limit > 0
    ? `all ${limit} ${free ? 'free ' : ''}AI writing uses`
    : `all your ${free ? 'free ' : ''}AI writing uses`;
  const reset = formatResetDate(quota?.resetsAt ?? '');
  return (
    `You’ve used ${uses} this month, so ${AI_CONSEQUENCE[kind]}.` +
    (reset ? ` Your uses reset on ${reset}.` : '')
  );
}

/**
 * The AI half of a stale-version rebuild (spec 8.3): ask for the missing keys
 * and merge the answer under the stored prose. A failure keeps the stored
 * prose and notes it as Create would; the rebuild goes ahead either way.
 * Gated on the doc's own `aiEnabled` too: a doc built without AI may be filled
 * in by hand, and must not get AI text because the toggle is on now.
 */
export async function topUpProseForRebuild(state: UiState, src: DocSource): Promise<ProseV2 | null> {
  if (!src.config.aiEnabled || !canGenerate(state)) return src.prose;
  const requested = proseKeysForSections(new Set<SectionId>(src.config.sections));
  const missing = missingProseKeys(src.prose, requested);
  if (missing.size === 0) return src.prose;
  try {
    const spec = extract(src.node, { figmaFile: src.fileKey, ...(src.fileName ? { figmaFileName: src.fileName } : {}) });
    const draft = await generateProse(
      spec,
      effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, state.licenseActive),
      src.node.id,
      missing,
      (q) => { state.quota = q; },
    );
    return mergeTopUp(src.prose, draft?.prose ?? null);
  } catch (err) {
    noteGenerationError(state, err, 'rebuild');
    return src.prose;
  }
}

/**
 * Read and clear the note `topUpProseForRebuild` left on `state.pendingAiNote`.
 * The slot is shared: call this right after awaiting the top-up, before
 * anything else, or a failure can be misattributed to another document.
 */
export function takeTopUpNote(state: UiState): string | null {
  const note = state.pendingAiNote;
  state.pendingAiNote = '';
  return note || null;
}

// ---------------------------------------------------------------------------
// Copy for AI. Re-extracts like Update, but never generates prose, touches
// quota, or mutates the canvas or stored metadata.
// ---------------------------------------------------------------------------
/** A Library row passes its DocSource; the component screen passes the
 *  current selection, which has no doc id or config. */
export type CopySource = Pick<DocSource, 'node' | 'fileKey' | 'fileName'>;

export interface CopyBriefOptions {
  /** Say "This doc has no saved guidelines" when prose is null. False on the
   *  component screen, where there is no document. */
  guidelinesNote?: boolean;
}

/** Above this, a copy warns that some chat windows will not take it whole. */
export const LARGE_COPY_BYTES = 200 * 1024;

/**
 * Size caveat in KB. Bytes, not lines: the DTCG copy is one line of compact
 * JSON, and a chat window pays in bytes. Leading space so it appends to
 * "Copied.".
 */
export function sizeCaveat(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes <= LARGE_COPY_BYTES) return '';
  return ` It’s ${Math.round(bytes / 1024)} KB, which some chat windows can’t take in one paste.`;
}

export async function copyBriefFromSource(
  state: UiState,
  src: CopySource,
  prose: ProseV2 | null,
  ui: BuildPresenter,
  options: CopyBriefOptions = {},
): Promise<void> {
  ui.clear();
  try {
    const spec = extract(src.node, { figmaFile: src.fileKey, ...(src.fileName ? { figmaFileName: src.fileName } : {}) });
    const generatedAt = new Date().toISOString();
    const foundation = foundationSpec
      ? buildFoundationArtifactV5(foundationSpec, {
          exportId: `foundation:${knownFileKey(foundationSpec.fileKey) ?? 'local'}:${generatedAt}`,
          generatedAt,
          build: pluginBuild(),
        }).artifact
      : undefined;
    const artifact = buildComponentArtifactV5(spec, {
      exportId: `component:${src.node.id}:${generatedAt}`,
      generatedAt,
      build: pluginBuild(),
      ...(foundation ? { foundation } : {}),
      // The v5 artifact reads the v1 prose shape, so it is flattened here.
      prose: prose ? proseToLegacy(prose) : null,
    });
    // One artifact, two renderings; the page is the same projection
    // `spec-layer pull --component-format md` runs.
    const format = state.componentFormat;
    const text = format === 'md'
      ? componentMarkdown(artifact)
      : toYaml(componentAiContext(artifact) as unknown as YamlValue);
    const size = sizeCaveat(text);
    const missing = foundationSpec
      ? ''
      : ' Token values are missing because this file’s variables haven’t loaded yet. Open Foundations, then copy again.';
    const noProse = prose || options.guidelinesNote === false ? '' : ' This doc has no saved guidelines.';
    const caveat = `${size}${missing}${noProse}`.trim();
    const tier = await copyText(text);
    if (tier === 'manual') {
      renderManualCopyModal(text, caveat || undefined);
      return;
    }
    ui.info(`Copied as ${COMPONENT_FORMAT_NAME[format]}.${size}${missing}${noProse}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Couldn’t read that component. Nothing was copied. (${msg})`);
  }
}

// ---------------------------------------------------------------------------
// Foundations: module state, independent of the Figma selection
// ---------------------------------------------------------------------------

let foundationSpec: FoundationSpec | null = null;
let foundationSelection: FoundationSelection = { collections: [], textStyles: false, effectStyles: false };
// AI-written group descriptions from every foundation doc on canvas, keyed by
// collection name then folder path; passed through to Copy, never generated
// here. onFoundationMessage seeds it, and setFoundationGroupDescriptions
// refreshes it from every reply that changes the canvas (foundationDone,
// docDetached, docRemoved), so Copy reflects what was last persisted.
let foundationGroupDescriptions: Record<string, Record<string, string>> = {};

/**
 * Always overwrites, `{}` included: an empty map is the reply's truthful
 * answer, and descriptions gone from canvas must not reach the next Copy.
 */
export function setFoundationGroupDescriptions(
  groupDescriptions: Record<string, Record<string, string>>,
): void {
  foundationGroupDescriptions = groupDescriptions;
}

/** How foundation state reaches a UI: handlers mutate module state, then ask
 *  the host to repaint. */
export interface FoundationHost {
  repaint(): void;
  setBusy(busy: boolean): void;
  startProgress(messages: string[]): void;
  stopProgress(): void;
}

const noopFoundationHost: FoundationHost = {
  repaint: () => {},
  setBusy: () => {},
  startProgress: () => {},
  stopProgress: () => {},
};

let foundationHost: FoundationHost = noopFoundationHost;

export function setFoundationHost(host: FoundationHost): void {
  foundationHost = host;
}

/** The parsed file, for a UI that renders its own foundation rows. */
export function currentFoundationSpec(): FoundationSpec | null {
  return foundationSpec;
}

/**
 * Render, copy, and report a foundation brief. `buildText` is a thunk so a
 * failure building the artifact lands in the same catch as a copy failure.
 */
async function deliverBrief(buildText: () => string, ui: BuildPresenter): Promise<void> {
  try {
    const text = buildText();
    const size = sizeCaveat(text);
    const tier = await copyText(text);
    if (tier === 'manual') {
      renderManualCopyModal(text, size.trim() || undefined);
      return;
    }
    ui.info(`Copied.${size}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Couldn’t read this file’s variables and styles. Nothing was copied. (${msg})`);
  }
}

export function generatedGuidelines(
  descriptions: Record<string, Record<string, string>>,
): FoundationGuidelinesV5 | undefined {
  const nonEmpty = Object.fromEntries(
    Object.entries(descriptions)
      .map(([collection, folders]) => [collection, Object.fromEntries(
        Object.entries(folders).filter(([, description]) => description.length > 0),
      )])
      .filter(([, folders]) => Object.keys(folders).length > 0),
  );
  return Object.keys(nonEmpty).length > 0
    ? { origin: 'generated', group_descriptions: nonEmpty }
    : undefined;
}

function foundationDtcgJson(
  spec: FoundationSpec,
  generatedAt: string,
  descriptions: Record<string, Record<string, string>>,
  scope?:
    | { target: 'collection'; collectionId: string }
    | { target: 'textStyles' }
    | { target: 'effectStyles' },
): string {
  const { artifact } = buildFoundationArtifactV5(spec, {
    exportId: `foundation:${knownFileKey(spec.fileKey) ?? 'local'}:${generatedAt}`,
    generatedAt,
    build: pluginBuild(),
    ...(scope ? { scope } : {}),
  });
  const guidelines = generatedGuidelines(descriptions);
  if (guidelines) artifact.guidelines = guidelines;
  // The canonical artifact owns the semantic hash; the clipboard carries a
  // DTCG 2025.10 resolver document projected from it. What DTCG cannot express
  // goes to $extensions["com.spec-layer"].report, never approximated. Compact
  // is about half the bytes of indented; files on disk stay two-space through
  // dtcgExportFiles.
  return `${JSON.stringify(foundationDtcgDocument(artifact))}\n`;
}

/**
 * Copy the whole file as a DTCG resolver document. Ignores the doc scope
 * selection: a partial token vocabulary leads an agent to invent token names.
 */
export async function copyFoundationBrief(ui: BuildPresenter): Promise<void> {
  ui.clear();
  const spec = currentFoundationSpec();
  // The footer draws this button only once the file has been read.
  if (!spec) return;
  const generatedAt = new Date().toISOString();
  await deliverBrief(
    () => foundationDtcgJson(spec, generatedAt, foundationGroupDescriptions),
    ui,
  );
}

/**
 * Copy one Library row's foundation, with the full local token dependency
 * closure its scope needs. Separate from copyFoundationBrief so the
 * whole-file rule gets no escape hatch.
 */
export async function copyFoundationBriefForScope(
  scope: FoundationScope,
  ui: BuildPresenter,
): Promise<void> {
  ui.clear();
  const spec = currentFoundationSpec();
  if (!spec) {
    // The Library requests the dump on entry, so this is a brief race or a
    // failed read; a retry resolves both.
    ui.error('Still reading this file’s variables. Try again in a moment.');
    return;
  }
  if (scope.target === 'collection'
    && !spec.collections.some((collection) => collection.id === scope.collectionId)) {
    ui.error('That collection is no longer in this file. Nothing was copied.');
    return;
  }
  // Descriptions are keyed by collection name, and one collection's brief must
  // not carry another's. Style copies get none: these describe variable folders.
  const groupDescriptions = scope.target === 'collection'
    ? Object.fromEntries(
        Object.entries(foundationGroupDescriptions)
          .filter(([name]) => name === scope.collectionName),
      )
    : {};
  const generatedAt = new Date().toISOString();
  if (scope.target === 'collection') {
    // `group` and `modeIds` are frame-only limits; only the collection id
    // passes, so Copy gets the full collection plus its dependency closure.
    await deliverBrief(
      () => foundationDtcgJson(spec, generatedAt, groupDescriptions, {
        target: 'collection', collectionId: scope.collectionId,
      }),
      ui,
    );
    return;
  }

  if (scope.target === 'textStyles') {
    if (spec.textStyles.length === 0) {
      ui.error('This file has no text styles left. Nothing was copied.');
      return;
    }
    await deliverBrief(
      () => foundationDtcgJson(spec, generatedAt, groupDescriptions, { target: 'textStyles' }),
      ui,
    );
    return;
  }

  if (spec.effectStyles.length === 0) {
    ui.error('This file has no effect styles left. Nothing was copied.');
    return;
  }
  await deliverBrief(
    () => foundationDtcgJson(spec, generatedAt, {}, { target: 'effectStyles' }),
    ui,
  );
}

/** True on click, false on foundationDone and foundationFrameError. Main has
 *  one guard for every foundation build, so the host's busy state must be the
 *  one lock every build entry point reads: otherwise the losing request is
 *  rejected and the UI cannot tell that from the winner's reply. */
export function setFoundationGenerating(value: boolean): void {
  foundationHost.setBusy(value);
  // The loader lives with the flag, so a build never runs without one.
  if (value) {
    foundationHost.startProgress(foundationBuildMessages());
  } else {
    foundationHost.stopProgress();
  }
  foundationHost.repaint();
}

/** Real phases: main re-reads the file, lays out each table, then places the
 *  Sections. The last line matches the component loader's. */
function foundationBuildMessages(): string[] {
  return [
    'Reading this file’s variables and styles',
    'Laying out the tables',
    'Placing docs on the canvas',
  ];
}

export function onFoundationMessage(
  dump: SerializedFoundation,
  groupDescriptions?: Record<string, Record<string, string>>,
): void {
  foundationSpec = buildFoundation(dump);
  foundationSelection = defaultSelection(foundationSpec);
  foundationGroupDescriptions = groupDescriptions ?? {};
  foundationHost.repaint();
}

/**
 * From the 'selection' message's optional dump, so Copy for AI resolves token
 * values without Foundations ever opening. Fires on every selection change, so
 * it leaves `foundationSelection` and the host alone; it shares `foundationSpec`
 * with onFoundationMessage so both tabs use one parsed instance.
 */
export function onSelectionFoundation(dump: SerializedFoundation): void {
  foundationSpec = buildFoundation(dump);
}

/** Select or clear everything. Same predicate as the link's label, so the two
 *  never disagree. */
export function onFoundationToggleAll(): void {
  if (!foundationSpec) return;
  foundationSelection = allSelected(foundationSpec, foundationSelection)
    ? clearAll()
    : selectAll(foundationSpec);
  foundationHost.repaint();
}

/** A foundation choice expressed without depending on a particular UI's DOM. */
export type FoundationChange =
  | { kind: 'collection'; collectionId: string; checked: boolean }
  | { kind: 'mode'; collectionId: string; modeId: string; checked: boolean }
  | { kind: 'textStyles'; checked: boolean }
  | { kind: 'effectStyles'; checked: boolean };

export function onFoundationChange(change: FoundationChange): void {
  if (!foundationSpec) return;
  switch (change.kind) {
    case 'collection':
      foundationSelection = toggleCollection(
        foundationSelection, foundationSpec, change.collectionId, change.checked);
      break;
    case 'mode':
      foundationSelection = toggleMode(
        foundationSelection, foundationSpec, change.collectionId,
        change.modeId, change.checked);
      break;
    case 'textStyles':
      foundationSelection = toggleTextStyles(foundationSelection, change.checked);
      break;
    case 'effectStyles':
      foundationSelection = toggleEffectStyles(foundationSelection, change.checked);
      break;
    default: {
      const exhaustive: never = change;
      throw new Error(`Unhandled foundation change: ${String(exhaustive)}`);
    }
  }
  // Repaint from the model: at the mode cap toggleMode returns the selection
  // unchanged, so the just-clicked checkbox must be painted back.
  foundationHost.repaint();
}

/** Read by the create-frames button; exported so ui-vnext.ts can post it. */
export function currentFoundationSelection(): FoundationSelection {
  return foundationSelection;
}

/** Group briefs for the current selection, or null before the file is read. */
export function currentGroupBriefs(): GroupDraftInput | null {
  if (!foundationSpec) return null;
  return groupBriefs(foundationSpec, foundationSelection);
}
