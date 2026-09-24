/**
 * actions.ts — the action handlers (runExtract / runDownload / runCreateDocFrame)
 * plus the module-scoped UI state.
 *
 * Logic only — DOM reads/writes that are view concerns live in screens/*; these
 * handlers call into render for banners/phase updates.
 */

import {
  extract, ProseProxyError, specContentHash, specHashProjection, buildFoundation,
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
  ALL_SECTIONS, buildDocModel, proseKeysForSections,
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
  /** The selection message's file NAME, when it carried one. Empty string when
   *  it did not, in which case the brief simply omits `file_name`. */
  currentFileName: string;
  currentSpec: IntermediateSpec | null;
  currentExtractedAt: string;
  // Proxy-routed AI flow: a pro license key (mirrored to clientStorage via
  // main) and/or the Figma user id (free-tier identity), the global "Write
  // with AI" preference, and the most recent generated prose drafts that fill
  // AI sections.
  licenseKey: string | null;
  licenseInstanceId: string | null;
  // Session-only view of whether the stored key is granting Pro: null = not yet
  // probed (re-probe each session), true = active, false = known inactive (drop
  // to the free identity). Never persisted, so a renewal reactivates on reload.
  licenseActive: boolean | null;
  figmaUserId: string | null;
  // Latest quota snapshot from the proxy (null until a request completes), and
  // whether the free-tier monthly quota is currently exhausted.
  quota: ProxyQuota | null;
  quotaExhausted: boolean;
  aiEnabled: boolean;
  // How Copy for AI and the snapshot write a component. Per user, stored by
  // the main thread; YAML until the boot message says otherwise.
  componentFormat: ComponentFormat;
  generatedProse: ProseV2 | null;
  // The prose-key set the current draft was generated for. A checkbox change
  // that requests a key not in this set triggers exactly one regeneration;
  // unchecking never does. Null whenever generatedProse is null.
  generatedProseKeys: Set<ProseV2Key> | null;
  // What the last build left out, and why, so the result message can say so.
  // Set by every assembled build and cleared once it has been reported.
  lastOmitted: OmittedSection[];
  // Set when an AI generation attempt fails so the next frame-build can note it
  // ("the AI sections were left out") instead of aborting the whole frame.
  pendingAiNote: string;
  // User-customized brand theme for the generated frame (null fields = default).
  brandTheme: BrandTheme;
  // Captured logo (base64 PNG), or null if none set.
  logoBase64: string | null;
  // Which measurement lenses the Measure section renders (each as its own
  // focused mini-diagram). Empty falls back to all three in the model.
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

// ---------------------------------------------------------------------------
// Message helper
// ---------------------------------------------------------------------------

export function send(msg: UiToMain): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

// ---------------------------------------------------------------------------
// renderOne — shared extraction helper used by the extract paths.
// ---------------------------------------------------------------------------

export function renderOne(
  node: SerializedNode,
  fileKey: string,
  /** Optional: a caller that has no file name omits it, and the brief omits
   *  `file_name` rather than inventing a placeholder. */
  fileName?: string,
): { name: string; spec: IntermediateSpec; extractedAt: string } {
  const extractedAt = new Date().toISOString();
  const spec = extract(node, { figmaFile: fileKey, ...(fileName ? { figmaFileName: fileName } : {}) });
  return { name: spec.name, spec, extractedAt };
}

// ---------------------------------------------------------------------------
// Implicit extraction — make the AI and frame
// actions work without a visible Extract button. If a spec is already present it
// is reused; otherwise we extract the current node on demand.
// ---------------------------------------------------------------------------

export function ensureExtracted(state: UiState): boolean {
  if (state.currentSpec) return true;
  if (!state.currentNode) return false;
  const { spec, extractedAt } = renderOne(state.currentNode, state.currentFileKey, state.currentFileName);
  state.currentSpec = spec;
  state.currentExtractedAt = extractedAt;
  return true;
}

// ---------------------------------------------------------------------------
// Auto-extract on selection — keeps the spec always-ready so the AI actions and
// the frame never block on a missing spec. The (synchronous) extract is deferred
// one frame so the panel paints identity + sections first; a "Reading…" chip
// shows meanwhile and clears when the spec is ready.
// ---------------------------------------------------------------------------

/**
 * Extract the current selection off the critical path.
 *
 * `onReading` brackets the synchronous extraction so a UI can show that it is
 * busy: extraction blocks the thread, so the caller has to paint before it
 * starts and again when it ends.
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

// ---------------------------------------------------------------------------
// Write with AI — when the global toggle is on (and a key + AI section exist),
// draft guideline prose once and cache it on state. A no-op when AI is off, no
// key is set, or no AI-flagged section is checked. Reuses prior drafts so a
// second action in the same selection doesn't re-bill the API.
// ---------------------------------------------------------------------------

/** The prose keys the currently-checked sections need. */
/** True when a fresh draft is needed: no draft yet, or the cached draft was
 *  generated for a key set that does not cover everything now requested. */
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
 * Whether a Foundations build asks the model for group descriptions.
 *
 * The AI writing switch governs every AI call, this one included: its help
 * text says a draft costs a free AI use, so a build with the switch off must
 * not spend one. Identity is required as for a component build (canGenerate).
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
 * Note + state effect for a failed license during generation. Pure for tests.
 *
 * `unreachable` means Spec Layer answered but could not reach the license
 * check behind it, so the key is kept and the check can simply run again. A
 * rebuild drops that retry, for the reason `aiNote` gives.
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
 * Turn a failed AI request into a note and its effect on state: the quota
 * fork, a lapsed license, a typed proxy code, an unreachable Spec Layer, or
 * anything else. One function for Create, the rebuild top-up, and the
 * Foundations build, so the three never explain the same failure differently;
 * `kind` only changes what the failure cost.
 *
 * The raw error goes to the console, never into the note. "Failed to fetch"
 * or a JSON parse message tells a designer nothing they can act on.
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

  // The generating loader (started by runCreateDocFrame) surfaces progress; this
  // path is best-effort. AI is an enhancement, never a blocker. If generation fails
  // (rate limit, network, unexpected response), leave the sections AI would have
  // written out and let the frame build anyway — the note surfaces on the
  // success banner.
  try {
    // willGenerateProse guarantees a non-null identity, spec, and node. A key
    // known-inactive drops to the free identity (effectiveAuth) rather than 401ing.
    const draft = await generateProse(
      state.currentSpec!,
      effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, state.licenseActive),
      state.currentNode!.id,
      requested,
      (q) => { state.quota = q; },
    );
    if (draft) {
      // The extractor already validated every name against the spec; what is
      // left is exactly what the canvas may draw. `dropped` is the count of
      // what the model invented, logged so a prompt regression is visible.
      const { prose, dropped } = draft;
      const droppedCount = Object.values(dropped).reduce((a, b) => a + (b ?? 0), 0);
      if (droppedCount > 0) console.warn('[Spec Layer] prose items dropped by validation', dropped);
      state.generatedProse = hasProseContent(prose) ? prose : null;
    } else {
      state.generatedProse = null;
    }
    // Record the covered key set only when a draft actually came back, so a
    // null result (degraded mode) leaves the reuse guard forcing a retry.
    state.generatedProseKeys = state.generatedProse ? requested : null;
  } catch (err) {
    state.generatedProse = null;
    state.generatedProseKeys = null;
    noteGenerationError(state, err);
  }
}

// ---------------------------------------------------------------------------
// Create doc frame — optionally write AI prose, then assemble a DocFrameModel
// from the checked sections and ask the main thread to build/place the frame.
// Success/failure banners arrive via the docFrameDone/docFrameError handlers.
// ---------------------------------------------------------------------------

/**
 * What the user picked, passed in rather than read from the DOM.
 *
 * The screen keeps this in module state, so the build path never reaches into
 * the DOM to recover it. Threading it through as a value is what keeps the
 * build logic testable without a rendered screen.
 */
export interface DocSelection {
  sections: Set<SectionId>;
  variantIds: Set<string>;
}

/**
 * How a build reports itself. The component screen writes to its status row and
 * footer button; the foundations screen to its own. Keeping this an interface is
 * what lets one build path serve every caller.
 */
export interface BuildPresenter {
  /** Clear any status left over from a previous run. */
  clear(): void;
  /** Show a failure the user needs to read. */
  error(message: string): void;
  /** Report an outcome that is not a failure. */
  info(message: string): void;
  /** Disable or re-enable the action that started this build. */
  setBusy(busy: boolean): void;
  /** Begin the "working on it" narration with the given lines. */
  startProgress(messages: string[]): void;
  stopProgress(): void;
}

/**
 * Build the doc frame and send it to the main thread.
 *
 * On success the progress narration deliberately keeps running: it stops when
 * docFrameDone or docFrameError comes back, which is what makes the canvas work
 * feel connected to the button that started it.
 */
export async function createDocFrame(
  state: UiState,
  selection: DocSelection,
  ui: BuildPresenter,
): Promise<void> {
  ui.clear();

  // No component, no build. The screen only offers Create once a component
  // is on it, so there is nothing here to tell the user.
  if (!ensureExtracted(state)) return;

  // Guard against a double-click sending two renderDocFrame messages (and
  // building two frames). Re-enabled by docFrameDone/docFrameError, or here on
  // an early failure (e.g. AI generation throwing before we dispatch).
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
    send({
      type: 'renderDocFrame',
      model: built.model,
      nodeId: state.currentNode!.id,
      contentHash: specContentHash(state.currentSpec!, { includeHidden: state.includeHidden }),
      baseline: specHashProjection(state.currentSpec!, { includeHidden: state.includeHidden }),
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
 * Shared prep for the two "build the doc" actions (Create frame / Download):
 * write AI prose if needed, gather the checked sections and ticked variants,
 * and assemble the DocFrameModel + its persisted config. Both actions build
 * from the SAME model so the frame and the downloaded markdown always match.
 *
 * Returns null (after showing the "select a section" banner) when nothing is
 * checked. Assumes the caller already ensured extraction and started the
 * loader; the caller owns loader/button teardown for the empty-selection case.
 */
async function assembleDocFor(
  state: UiState,
  { sections: selected, variantIds }: DocSelection,
): Promise<{ model: DocFrameModel; config: DocConfig } | null> {
  await ensureProseFor(state, selected);

  // Null rather than a banner: the caller owns how an empty selection reads,
  // because the two UIs put that message in different places.
  if (selected.size === 0) return null;

  const model = buildDocModel(state.currentSpec!, state.generatedProse, selected, variantIds, {
    measureViews: state.measureViews, includeHidden: state.includeHidden, aiEnabled: canGenerate(state),
  });
  state.lastOmitted = model.omitted;
  const config: DocConfig = {
    sections: [...selected],
    variantIds: [...variantIds],
    // The SAME flag the model was built with, not the raw checkbox. Update
    // feeds this back into buildDocModel, and that is what decides whether an
    // empty AI section reads "AI writing is off" or "nothing to show"; storing
    // `state.aiEnabled` here let a user with the box ticked but no licence or
    // Figma identity get one classification on Create and the other on Update.
    aiEnabled: canGenerate(state),
    anatomyView: 'diagram',
    measureViews: state.measureViews,
    includeHidden: state.includeHidden,
  };
  return { model, config };
}

const OMISSION_REASON: Record<OmittedSection['reason'], string> = {
  nothingToShow: 'nothing to show',
  aiOff: 'AI writing is off',
};

/**
 * The first sentence of the result message: `Docs created.` No frame count.
 * A frame is how a doc is stored, not what the user came for.
 */
export function resultOutcome(replaced: boolean): string {
  return `Docs ${replaced ? 'updated' : 'created'}.`;
}

/** The result line: the outcome, then one sentence per omitted section. */
export function omissionsMessage(outcome: string, omitted: OmittedSection[]): string {
  const parts = [outcome, ...omitted.map((o) => `Left out ${o.label}: ${OMISSION_REASON[o.reason]}.`)];
  return parts.join(' ');
}

/** Status lines for the generating loader. The AI path narrates the slow
 *  network round-trip; the no-AI path is near-instant so it stays terse. */
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

/**
 * The loader line after `index`, or null to stay put. A loader holds on its
 * last line instead of wrapping: a slow AI build that cycled from "Placing
 * docs on the canvas" back to its first line would read as starting over.
 */
export function nextPhaseIndex(index: number, count: number): number | null {
  return index + 1 < count ? index + 1 : null;
}

// ---------------------------------------------------------------------------
// AI plumbing — update state + persist via the main thread. The state mutations
// live here for testability; ui-vnext.ts wires the input/toggle events to them.
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
// Update from source (My Library) — regenerate the doc from its live source.
//
// The generated lane is rebuilt from a fresh extraction. The editorial lane
// comes from `src.prose`, which the main thread read back from the canvas, so
// hand edits survive and the model is never asked again. An Update is a
// source refresh, not a reason to re-bill the quota, the same rule the
// foundation Update follows. Fresh AI prose is what Create is for.
// ---------------------------------------------------------------------------
/** A library row's stored source: what it was built from, and how. */
export type DocSource = {
  docId: string;
  node: SerializedNode;
  fileKey: string;
  /** The file NAME the main thread sent alongside the key, when it had one.
   *  Optional so a caller without one compiles and the brief simply omits
   *  `file_name`. */
  fileName?: string;
  config: DocConfig;
  /** What the doc's writing sections currently say, read off the canvas by the
   *  main thread with the stored blob filling anything the canvas does not
   *  show. Null when the doc has never had guidelines. */
  prose: ProseV2 | null;
};

export async function updateFromSource(
  state: UiState,
  src: DocSource,
  ui: BuildPresenter,
): Promise<boolean> {
  // The caller acquires the shared build lock before requesting this source.
  // Success deliberately leaves progress running until docFrameDone or
  // docFrameError releases that lock; only a synchronous failure tears down
  // here. The vNext Library must preserve that caller-owned lifecycle.
  ui.clear();
  // No lines: the Library shows its own "Updating" label, and its presenter
  // uses this call only to repaint.
  ui.startProgress([]);
  try {
    const spec = extract(src.node, { figmaFile: src.fileKey, ...(src.fileName ? { figmaFileName: src.fileName } : {}) });
    const selected = new Set<SectionId>(src.config.sections);
    const variantIds = new Set<string>(src.config.variantIds);
    const model = buildDocModel(spec, src.prose, selected, variantIds, {
      measureViews: src.config.measureViews,
      includeHidden: src.config.includeHidden,
      aiEnabled: src.config.aiEnabled,
    });
    // Same record the Create path keeps, so the Library's completion message
    // can name the sections it left out instead of staying silent about them.
    state.lastOmitted = model.omitted;
    send({
      type: 'renderDocFrame',
      model,
      nodeId: src.node.id,
      contentHash: specContentHash(spec, { includeHidden: src.config.includeHidden }),
      baseline: specHashProjection(spec, { includeHidden: src.config.includeHidden }),
      extractorVersion: EXTRACTOR_VERSION,
      config: src.config,
      ...(src.prose ? { prose: src.prose } : {}),
    });
    // Loader stops on docFrameDone/docFrameError (ui-vnext.ts).
    return true;
  } catch (err) {
    ui.stopProgress();
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Couldn’t update this doc. (${msg})`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stale-version rebuild top-up — a document built by an earlier extractor
// version upgrades losslessly where v1 has a source, but several v2 keys have
// none and land empty. When AI writing is on, a rebuild asks the model only
// for those empty keys (plus keyboard, upgraded lossily from v1 bullets) and
// merges the answer under the stored prose. Stored prose always wins except
// keyboard, which the rebuild note promises to rewrite.
// ---------------------------------------------------------------------------

/** True when the stored prose has something to show for `key`. */
function hasKeyContent(prose: ProseV2 | null, key: ProseV2Key): boolean {
  const value = prose?.[key];
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  const overview = value as { lede?: string; body?: string[] };
  return Boolean(overview.lede?.trim()) || (overview.body?.length ?? 0) > 0;
}

/**
 * The keys a stale-version rebuild asks the model for: every requested key the
 * upgraded prose left empty, plus `keyboard` whenever it is requested, because
 * the v1 keyboard bullets upgrade lossily (a bullet that did not open with a
 * key was dropped). This is what the rebuild note promises.
 */
export function missingProseKeys(prose: ProseV2 | null, requested: ReadonlySet<ProseV2Key>): Set<ProseV2Key> {
  const out = new Set<ProseV2Key>();
  for (const key of requested) {
    if (key === 'keyboard' || !hasKeyContent(prose, key)) out.add(key);
  }
  return out;
}

/** Stored prose wins wherever it has content; the fresh draft fills the rest
 *  and always replaces keyboard. Null when the result has nothing to show. */
export function mergeTopUp(stored: ProseV2 | null, generated: ProseV2 | null): ProseV2 | null {
  if (!generated) return stored;
  const out: ProseV2 = { ...(stored ?? {}), v: 2 };
  for (const key of PROSE_V2_KEYS) {
    const fresh = generated[key];
    if (fresh === undefined) continue;
    if (key === 'keyboard' || !hasKeyContent(stored, key)) {
      (out as unknown as Record<string, unknown>)[key] = fresh;
    }
  }
  return hasProseContent(out) ? out : null;
}

/**
 * What a build says when the AI allowance ran out: that the uses are gone,
 * what that cost this document, and when they come back. It replaces the
 * per-section "Left out Overview: nothing to show." lines for the sections AI
 * would have written (see withoutAiOmissions), which blamed the component for
 * what was really the allowance.
 *
 * Only facts the proxy reported: the limit and the reset date come from the
 * last quota snapshot, and each is left out when that snapshot lacks it
 * rather than guessed. "Free" only for the free tier, because a Pro plan has
 * its own ceiling. What running out cost, per kind of build, is the same
 * AI_CONSEQUENCE every other AI note names.
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

const AI_SECTION_IDS: ReadonlySet<SectionId> = new Set(
  ALL_SECTIONS.filter((section) => section.ai).map((section) => section.id),
);

/**
 * The omissions still worth listing once an AI note (the quota, or any other
 * failed request) has explained the AI ones. An AI section left empty because
 * no model answered is not "nothing to show", and listing it that way under
 * the note says the same thing twice, the second time wrongly.
 */
export function withoutAiOmissions(omitted: readonly OmittedSection[]): OmittedSection[] {
  return omitted.filter((o) => !(o.reason === 'nothingToShow' && AI_SECTION_IDS.has(o.id)));
}

/**
 * The AI half of a stale-version rebuild (spec 8.3): when AI writing is on,
 * ask for the selected keys the stored prose leaves empty (and keyboard), and
 * merge the answer under the stored prose. A failure keeps the stored prose
 * and records the same note Create would; the rebuild goes ahead either way.
 *
 * Gated on the document's own `aiEnabled` as well as the panel toggle. A doc
 * built without AI writing is rebuilt without it: topping it up because the
 * toggle happens to be on now would put AI text into a document whose stored
 * config still reads `aiEnabled: false`, and a later empty AI section on it
 * would then be reported as "AI writing is off" when AI had just written into
 * it.
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
 * Drain whatever note a `topUpProseForRebuild` call just left on
 * `state.pendingAiNote`, clearing the slot in the same step.
 *
 * The slot is shared, mutable UI state, so it must be read exactly once,
 * right where the caller knows which document's top-up just finished, and
 * cleared immediately, never left for some later, unrelated completion to
 * read. A caller that awaits `topUpProseForRebuild` should call this before
 * doing anything else, so a failure can never survive to be misattributed to
 * a document whose dispatch never ran the top-up at all.
 */
export function takeTopUpNote(state: UiState): string | null {
  const note = state.pendingAiNote;
  state.pendingAiNote = '';
  return note || null;
}

// ---------------------------------------------------------------------------
// Copy for AI (My Library): put a brief on the clipboard. A component copies
// as Component Context v5 YAML; a foundation copies as the DTCG resolver
// document (see foundationDtcgJson below).
//
// Deliberately unlike the doc-building actions: it re-extracts the source the
// way Update does, but it never generates prose, never touches quota, and
// never mutates the canvas or any stored metadata. Guidelines come from the
// caller, which read them from DOC_PROSE_KEY.
// ---------------------------------------------------------------------------
/** What a copy needs from a source: the live node and where it came from.
 *  A Library row passes its DocSource; the component screen passes the
 *  current selection, which has no doc id or config. */
export type CopySource = Pick<DocSource, 'node' | 'fileKey' | 'fileName'>;

export interface CopyBriefOptions {
  /** Say "This doc has no saved guidelines" when prose is null. True for
   *  a Library row, where a document exists and could have had them. False
   *  from the component screen, where there is no document to speak of. */
  guidelinesNote?: boolean;
}

/** Above this, a copy warns that some chat windows will not take it whole. */
export const LARGE_COPY_BYTES = 200 * 1024;

/**
 * Size caveat for a copied payload, in kilobytes.
 *
 * Bytes, not lines: the DTCG clipboard is compact JSON on one line, and what
 * a chat window or an agent's context actually pays for is bytes. Leading
 * space so it appends to "Copied." the way the line-count string did.
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
          exportId: `foundation:${foundationSpec.fileKey && foundationSpec.fileKey !== 'unknown'
            ? foundationSpec.fileKey
            : 'local'}:${generatedAt}`,
          generatedAt,
          build: pluginBuild(),
        }).artifact
      : undefined;
    const artifact = buildComponentArtifactV5(spec, {
      exportId: `component:${src.node.id}:${generatedAt}`,
      generatedAt,
      build: pluginBuild(),
      ...(foundation ? { foundation } : {}),
      // The v5 artifact still reads the v1 shape, so the structured prose is
      // flattened at the extractor call rather than carried as v1 anywhere.
      prose: prose ? proseToLegacy(prose) : null,
    });
    // One artifact, two renderings. The page comes from the same projection
    // `spec-layer pull --component-format md` runs, so nothing is re-derived.
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
// Foundations — the file-wide (selection-independent) variables/text-styles tab.
// State lives at module scope like the AI plumbing above: the spec/selection
// persist across paints within a session but never touch UiState, since they
// have nothing to do with the current Figma selection.
// ---------------------------------------------------------------------------

let foundationSpec: FoundationSpec | null = null;
let foundationSelection: FoundationSelection = { collections: [], textStyles: false, effectStyles: false };
// AI-written group descriptions merged from every foundation doc link on
// canvas, keyed by collection name then folder path. Read-only pass-through
// for copyFoundationBrief; never generated here.
//
// Set initially by onFoundationMessage, alongside foundationSpec (never by
// onSelectionFoundation, whose dump carries no descriptions). But that first
// population goes stale the moment the user generates or changes
// descriptions in the SAME session: creating or
// rebuilding a foundation doc, or detaching/removing one, all change what is
// on canvas without re-sending 'foundation'. setFoundationGroupDescriptions
// is the one place every one of those replies (foundationDone, docDetached,
// docRemoved) refreshes this cache from the main thread's own re-derived,
// whole-canvas truth, so the very next Copy always reflects what was last
// actually persisted rather than what the UI believed at tab-open time.
let foundationGroupDescriptions: Record<string, Record<string, string>> = {};

/**
 * Refresh the group-descriptions cache from a main-thread reply that just
 * changed what is on canvas (a build, an Update, a detach, or a remove).
 * Always overwrites, including with `{}`: an empty map here is not "no new
 * information", it is the reply's own truthful answer, and a doc whose
 * descriptions just vanished from canvas must not keep offering them to the
 * next Copy.
 */
export function setFoundationGroupDescriptions(
  groupDescriptions: Record<string, Record<string, string>>,
): void {
  foundationGroupDescriptions = groupDescriptions;
}

/**
 * How foundation state reaches a UI.
 *
 * The handlers below mutate module state and then need something repainted.
 * Registering a host lets either UI receive that instead of reaching for one
 * specific set of DOM nodes.
 */
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
 * Render, copy, and report a foundation brief.
 *
 * Shared tail of copyFoundationBrief and copyFoundationBriefForScope: the two
 * differ only in how they build the artifact scope (whole file vs. one
 * Library row), and were otherwise identical down to the size
 * threshold and the error string. `buildText` is a thunk rather than an
 * already-built string so this can keep wrapping the brief construction
 * itself in the same try/catch the duplicated code used — a failure in
 * artifact/document construction is reported with the same "could not read"
 * way a copy failure is, exactly as before the extraction.
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
    exportId: `foundation:${spec.fileKey && spec.fileKey !== 'unknown' ? spec.fileKey : 'local'}:${generatedAt}`,
    generatedAt,
    build: pluginBuild(),
    ...(scope ? { scope } : {}),
  });
  const guidelines = generatedGuidelines(descriptions);
  if (guidelines) artifact.guidelines = guidelines;
  // The canonical artifact stays the validated source of truth and owns the
  // semantic hash. The clipboard carries a Design Tokens Format Module 2025.10
  // resolver document projected from it, which Style Dictionary and Tokens
  // Studio read and an agent needs no dialect for. What DTCG cannot express is
  // listed under $extensions["com.spec-layer"].report, never approximated.
  // Compact on purpose. Indented, a 360-variable file is 12,000 lines and
  // 424 KB; compact is roughly half the bytes and the same document. Files on
  // disk stay two-space through dtcgExportFiles, which is what the CLI writes.
  return `${JSON.stringify(foundationDtcgDocument(artifact))}\n`;
}

/**
 * Copy the whole file as a DTCG resolver document, projected from the
 * canonical Foundation Context v5 artifact.
 *
 * Deliberately ignores the scope selection that foundation DOCUMENT generation
 * respects: the artifact gives an agent a complete token vocabulary, and
 * a partial one produces exactly the invented token names the brief is meant
 * to prevent.
 */
export async function copyFoundationBrief(ui: BuildPresenter): Promise<void> {
  ui.clear();
  const spec = currentFoundationSpec();
  // The Foundations footer only draws this button once the file has been read,
  // so there is no spec-less click to explain.
  if (!spec) return;
  const generatedAt = new Date().toISOString();
  await deliverBrief(
    () => foundationDtcgJson(spec, generatedAt, foundationGroupDescriptions),
    ui,
  );
}

/**
 * Copy one library row's foundation.
 *
 * The sibling of copyFoundationBrief, which covers the whole file. Two
 * functions rather than one with a flag: the whole-file path's "deliberately
 * ignores the scope selection" reasoning is a doctrine for a file-wide screen,
 * and it should not acquire an escape hatch.
 *
 * Every row kind, a collection as well as text styles and effect styles, uses
 * direct v5 and includes the complete local token dependency closure the
 * requested scope needs.
 */
export async function copyFoundationBriefForScope(
  scope: FoundationScope,
  ui: BuildPresenter,
): Promise<void> {
  ui.clear();
  const spec = currentFoundationSpec();
  if (!spec) {
    // No remedy on another screen: the Library view asks for the dump on
    // entry, so this is a sub-second race or a read that failed, and both
    // resolve by retrying.
    ui.error('Still reading this file’s variables. Try again in a moment.');
    return;
  }
  if (scope.target === 'collection'
    && !spec.collections.some((collection) => collection.id === scope.collectionId)) {
    ui.error('That collection is no longer in this file. Nothing was copied.');
    return;
  }
  // Filtered, not passed whole: group descriptions are keyed by collection
  // name, and a brief covering one collection must not carry another's
  // guidelines. A text styles copy gets none, since these describe variable
  // folders.
  const groupDescriptions = scope.target === 'collection'
    ? Object.fromEntries(
        Object.entries(foundationGroupDescriptions)
          .filter(([name]) => name === scope.collectionName),
      )
    : {};
  const generatedAt = new Date().toISOString();
  if (scope.target === 'collection') {
    // `group` and `modeIds` are frame-only split/column limits. Passing only
    // the stable collection id gives Copy the full collection plus the direct
    // exporter's dependency closure instead of silently hiding rows or modes.
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

/** Set by ui-vnext.ts around the renderFoundation round-trip: true on click, false on
 *  both foundationDone and foundationFrameError. Repaints immediately so the
 *  button's disabled state is correct without waiting for an unrelated event.
 *
 *  Also mirrors onto createFrameBtn, which is the in-flight signal the component
 *  Create-frame button and My Library's row Update both read. The main thread
 *  has ONE guard covering every foundation build, so the UI must present one
 *  lock too: three entry points behind two independent flags meant the main
 *  thread rejected whichever request lost, and the UI had no way to tell that
 *  rejection apart from the winner's own reply. */
export function setFoundationGenerating(value: boolean): void {
  foundationHost.setBusy(value);
  // The loader lives with the flag rather than at the call sites, so a build
  // cannot end up running with no loader (or a loader with no build): both
  // callers set the flag, and there are three ways a build can finish.
  if (value) {
    foundationHost.startProgress(foundationBuildMessages());
  } else {
    foundationHost.stopProgress();
  }
  foundationHost.repaint();
}

/**
 * What the build loader says while docs are produced. These phases are real:
 * the main thread re-reads the file, lays out each table, then places the
 * Sections. The last line names docs, not frames, so it holds for one doc or
 * many and matches the component loader's last line.
 */
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
 * Set from the 'selection' message's optional `foundation` dump, so the
 * Selected-component path (Copy for AI's brief) can resolve token values
 * without the user ever having opened the Foundations tab. Deliberately does
 * NOT touch `foundationSelection` or repaint `foundationHost`: unlike
 * `onFoundationMessage` above, this fires on every selection change, and
 * resetting the Foundations tab's own checkbox selection (or repainting a tab
 * the user isn't looking at) on every click elsewhere in the panel would be a
 * visible regression for that tab. Both setters write the same module-level
 * `foundationSpec`, which is exactly the point: the Selected-component and
 * Foundations tabs share one parsed instance rather than each fetching (and
 * parsing) their own.
 */
export function onSelectionFoundation(dump: SerializedFoundation): void {
  foundationSpec = buildFoundation(dump);
}

/**
 * The head link: select everything, or clear everything.
 *
 * Reads its direction from the same predicate the link's label does, so the
 * label can never describe the opposite of what the click will do.
 */
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
  // Repaint from the model rather than trusting the DOM: toggleMode returns the
  // selection UNCHANGED when the mode cap is hit, so a checkbox the user just
  // clicked has to be painted back to unchecked. Mutating in place would leave
  // the DOM claiming five modes while the model holds four.
  foundationHost.repaint();
}

/** Read by the create-frames button; exported so ui-vnext.ts can post it. */
export function currentFoundationSelection(): FoundationSelection {
  return foundationSelection;
}

/**
 * The group briefs for the current selection, or null before the file is read.
 *
 * Lives here because the spec and selection do, and it keys the briefs the same
 * way the renderer keys its lookups.
 */
export function currentGroupBriefs(): GroupDraftInput | null {
  if (!foundationSpec) return null;
  return groupBriefs(foundationSpec, foundationSelection);
}
