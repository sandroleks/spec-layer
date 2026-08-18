/**
 * actions.ts — the action handlers (runExtract / runDownload / runCreateDocFrame)
 * plus the module-scoped UI state.
 *
 * Logic only — DOM reads/writes that are view concerns live in render.ts; these
 * handlers call into render for banners/phase updates.
 */

import { extract, ProseProxyError, specContentHash, buildFoundation, componentBrief, foundationBrief, toYaml } from '@spec-layer/extractor';
import type {
  SerializedNode, IntermediateSpec, ProseDrafts, ProseKey, ProxyQuota,
  SerializedFoundation, FoundationSpec, FoundationSelection, FoundationGroupBrief,
} from '@spec-layer/extractor';
import { EXTRACTOR_VERSION } from '@spec-layer/extractor';
import type { UiToMain } from '../messages';
import type { DocConfig } from '../docLink';
import { nextStatus, resetToIdle, type UiPhase } from './state';
import { generateProse } from './ai';
import { effectiveAuth, generationErrorCopy } from './proxy';
import { emptyBrandTheme, type BrandTheme } from '../brandColors';
import { buildDocModel, ALL_SECTIONS, proseKeysForSections, type SectionId, type MeasureView, type DocFrameModel } from './docModel';
import type { Refs } from './dom';
import {
  defaultSelection, toggleCollection, toggleMode, toggleTextStyles,
  frameCount, selectAll, clearAll, allSelected, groupBriefs,
} from './foundationState';
import {
  showBanner,
  clearBanners,
  renderPhase,
  startLoader,
  stopLoader,
} from './render';
import { copyText, renderManualCopyModal } from './clipboard';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface UiState {
  phase: UiPhase;
  currentNode: SerializedNode | null;
  currentFileKey: string;
  currentSpec: IntermediateSpec | null;
  currentExtractedAt: string;
  // Proxy-routed AI flow: a pro license key (mirrored to clientStorage via
  // main) and/or the Figma user id (free-tier identity), the global "Write
  // with AI" preference, and the most recent generated prose drafts used to
  // fill AI sections.
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
  generatedProse: ProseDrafts | null;
  // The prose-key set the current draft was generated for. A checkbox change
  // that requests a key not in this set triggers exactly one regeneration;
  // unchecking never does. Null whenever generatedProse is null.
  generatedProseKeys: Set<ProseKey> | null;
  // Set when an AI generation attempt fails so the next frame-build can note it
  // ("built with placeholders") instead of aborting the whole frame.
  pendingAiNote: string;
  // User-customized brand theme for the generated frame (null fields = default).
  brandTheme: BrandTheme;
  // Captured logo (base64 PNG), or null if none set.
  logoBase64: string | null;
  // Which measurement lenses the Measure section renders (each as its own
  // focused mini-diagram). Empty falls back to all three in the model.
  measureViews: MeasureView[];
}

export function createState(): UiState {
  return {
    phase: 'idle',
    currentNode: null,
    currentFileKey: '',
    currentSpec: null,
    currentExtractedAt: '',
    licenseKey: null,
    licenseInstanceId: null,
    licenseActive: null,
    figmaUserId: null,
    quota: null,
    quotaExhausted: false,
    aiEnabled: false,
    generatedProse: null,
    generatedProseKeys: null,
    pendingAiNote: '',
    brandTheme: emptyBrandTheme(),
    logoBase64: null,
    measureViews: ['size', 'padding', 'spacing'],
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
): { name: string; spec: IntermediateSpec; extractedAt: string } {
  const extractedAt = new Date().toISOString();
  const spec = extract(node, { figmaFile: fileKey });
  return { name: spec.name, spec, extractedAt };
}

// ---------------------------------------------------------------------------
// Extract — pure extractor pipeline; preview rendered into the textarea.
// ---------------------------------------------------------------------------

export async function runExtract(refs: Refs, state: UiState): Promise<void> {
  if (!state.currentNode) return;

  clearBanners(refs);
  state.phase = resetToIdle();
  state.phase = nextStatus(state.phase, 'selected');
  renderPhase(refs, state);

  const { name, spec, extractedAt } = renderOne(state.currentNode, state.currentFileKey);
  state.currentSpec = spec;
  state.currentExtractedAt = extractedAt;

  state.phase = nextStatus(state.phase, 'rendered');
  renderPhase(refs, state);

  send({ type: 'notify', message: `Spec extracted for ${name}` });
}

// ---------------------------------------------------------------------------
// Implicit extraction — make the AI and frame
// actions work without a visible Extract button. If a spec is already present it
// is reused; otherwise we extract the current node on demand.
// ---------------------------------------------------------------------------

export function ensureExtracted(state: UiState): boolean {
  if (state.currentSpec) return true;
  if (!state.currentNode) return false;
  const { spec, extractedAt } = renderOne(state.currentNode, state.currentFileKey);
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

/** Legacy adapter: drives the old phase-label chip. */
export function runAutoExtract(refs: Refs, state: UiState, onReady?: () => void): void {
  autoExtract(
    state,
    (reading) => {
      refs.phaseLabel.className = reading ? 'chip' : 'phase-label';
      refs.phaseLabel.textContent = reading ? 'Reading…' : '';
    },
    onReady,
  );
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
export function proseNeedsRegen(state: UiState, requested: Set<ProseKey>): boolean {
  if (!state.generatedProse || !state.generatedProseKeys) return true;
  for (const k of requested) if (!state.generatedProseKeys.has(k)) return true;
  return false;
}

/** AI runs when the toggle is on and any identity exists — free tier needs no key. */
export function canGenerate(state: UiState): boolean {
  return state.aiEnabled && Boolean(state.licenseKey || state.figmaUserId);
}

export function willGenerateProseFor(state: UiState, sections: Set<SectionId>): boolean {
  if (!canGenerate(state)) return false;
  const requested = proseKeysForSections(sections);
  if (requested.size === 0) return false;
  return proseNeedsRegen(state, requested);
}

/** Note + state effect for a failed license during generation. Pure for tests. */
export function licenseFailureNote(reason: string | undefined): { note: string; markInactive: boolean } {
  if (reason === 'unreachable') {
    return {
      note: "We couldn't check your Pro key this time, so AI didn't run. Your key is still saved. Try again in a minute.",
      markInactive: false,
    };
  }
  return {
    note: "Your Pro subscription isn't active, so AI didn't run this time. You're back on the free tier, and the renew option is in Settings.",
    markInactive: true,
  };
}

async function ensureProseFor(state: UiState, sections: Set<SectionId>): Promise<void> {
  state.pendingAiNote = '';
  if (!willGenerateProseFor(state, sections)) return;
  const requested = proseKeysForSections(sections);

  // The generating loader (started by runCreateDocFrame) surfaces progress; this
  // path is best-effort. AI is an enhancement, never a blocker. If generation fails
  // (rate limit, network, unexpected response), fall back to placeholders and
  // let the frame build anyway — the note surfaces on the success banner.
  try {
    // willGenerateProse guarantees a non-null identity, spec, and node. A key
    // known-inactive drops to the free identity (effectiveAuth) rather than 401ing.
    state.generatedProse = await generateProse(
      state.currentSpec!,
      effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, state.licenseActive),
      state.currentNode!.id,
      requested,
      (q) => { state.quota = q; },
    );
    // Record the covered key set only when a draft actually came back, so a
    // null result (degraded mode) leaves the reuse guard forcing a retry.
    state.generatedProseKeys = state.generatedProse ? requested : null;
  } catch (err) {
    state.generatedProse = null;
    state.generatedProseKeys = null;
    if (err instanceof ProseProxyError) {
      if (err.code === 'quota_exhausted') {
        state.quotaExhausted = true;
        return; // callers proceed without AI; the UI renders the upgrade fork
      }
      if (err.code === 'license_not_active') {
        // Key lapsed mid-session (or the license server was unreachable): drop to
        // the free identity ONLY on a definite lapse, never on a mere outage, and
        // explain it. This frame builds with placeholders; the next generation
        // re-probes. Settings reflects the lapse on its next refresh.
        const { note, markInactive } = licenseFailureNote(err.reason);
        if (markInactive) state.licenseActive = false;
        state.pendingAiNote = note;
        return;
      }
      state.pendingAiNote = generationErrorCopy(err.code);
      return;
    }
    const detail = err instanceof Error ? err.message : String(err);
    state.pendingAiNote = `AI didn't run (${detail}), so placeholders were used`;
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
 * The legacy UI keeps this in its checkboxes and the vNext screen keeps it in
 * module state, so the build path cannot read either one directly. Threading it
 * through as a value is what lets both UIs drive the same code.
 */
export interface DocSelection {
  sections: Set<SectionId>;
  variantIds: Set<string>;
}

/**
 * How a build reports itself. Each UI supplies its own: the legacy one writes
 * to its banner and loader, the vNext screen to its status row and footer
 * button. Keeping this an interface is what stops the build logic from being
 * copied once per UI.
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

  if (!ensureExtracted(state)) {
    ui.error('Select a component first.');
    return;
  }

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
      contentHash: specContentHash(state.currentSpec!),
      extractorVersion: EXTRACTOR_VERSION,
      config: built.config,
      ...(state.generatedProse ? { prose: state.generatedProse } : {}),
    });
  } catch (err) {
    ui.stopProgress();
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Frame failed: ${msg}`);
    ui.setBusy(false);
  }
}

/** Read the legacy UI's checkboxes into a selection value. */
export function selectionFromRefs(refs: Refs): DocSelection {
  const sections = new Set<SectionId>();
  for (const { id } of ALL_SECTIONS) {
    if (refs.sectionChecks[id]?.checked) sections.add(id);
  }
  const variantIds = new Set<string>();
  refs.variantList.querySelectorAll('input:checked').forEach((el) => {
    const id = (el as HTMLInputElement).dataset.nodeId;
    if (id) variantIds.add(id);
  });
  return { sections, variantIds };
}

/** Drive the legacy banner, loader, and Create-frame button. */
export function refsPresenter(refs: Refs, button: HTMLButtonElement): BuildPresenter {
  return {
    clear: () => clearBanners(refs),
    error: (message) => showBanner(refs, 'error', message),
    info: (message) => showBanner(refs, 'info', message),
    setBusy: (busy) => { button.disabled = busy; },
    startProgress: (messages) => startLoader(refs.loader, refs.loaderText, messages),
    stopProgress: () => stopLoader(refs.loader),
  };
}

export function runCreateDocFrame(refs: Refs, state: UiState): Promise<void> {
  return createDocFrame(state, selectionFromRefs(refs), refsPresenter(refs, refs.createFrameBtn));
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

  const model = buildDocModel(
    state.currentSpec!,
    state.generatedProse,
    selected,
    variantIds,
    { measureViews: state.measureViews },
  );
  const config: DocConfig = {
    sections: [...selected],
    variantIds: [...variantIds],
    aiEnabled: state.aiEnabled,
    anatomyView: 'diagram',
    measureViews: state.measureViews,
  };
  return { model, config };
}

/** Status lines for the generating loader. The AI path narrates the slow
 *  network round-trip; the no-AI path is near-instant so it stays terse. */
export function generatingMessages(withAi: boolean): string[] {
  return withAi
    ? [
        'Looking at the component',
        'Writing the guidelines',
        'Composing sections',
        'Placing the frame on the canvas',
      ]
    : [
        'Reading the component',
        'Composing sections',
        'Laying out the content',
        'Placing the frame on the canvas',
      ];
}

// ---------------------------------------------------------------------------
// AI plumbing — update state + persist via the main thread. The state mutations
// live here for testability; ui.ts wires the input/toggle events to them.
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

export function setBrandTheme(state: UiState, value: BrandTheme): void {
  state.brandTheme = value;
  send({ type: 'setBrandTheme', value });
}

// ---------------------------------------------------------------------------
// Update from source (My Library) — regenerate a doc in place using its stored
// config, WITHOUT touching the Selected-component tab's live state. Extraction
// is deterministic; prose runs only when the stored config had AI on. Dispatches
// renderDocFrame, which replaces the existing doc (matched by sourceNodeId).
// ---------------------------------------------------------------------------
/** A library row's stored source: what it was built from, and how. */
export type DocSource = {
  docId: string;
  node: SerializedNode;
  fileKey: string;
  config: DocConfig;
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
  ui.startProgress(['Reading the component', 'Composing sections', 'Placing the frame on the canvas']);
  try {
    const spec = extract(src.node, { figmaFile: src.fileKey });
    const selected = new Set<SectionId>(src.config.sections);

    let prose = null as Awaited<ReturnType<typeof generateProse>>;
    const requested = proseKeysForSections(selected);
    if (src.config.aiEnabled && requested.size > 0 && (state.licenseKey || state.figmaUserId)) {
      try {
        prose = await generateProse(
          spec,
          effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, state.licenseActive),
          src.node.id,
          requested,
          (q) => { state.quota = q; },
        );
      } catch {
        // AI is best-effort garnish: fall through to placeholders on any failure.
        prose = null;
      }
    }

    const variantIds = new Set<string>(src.config.variantIds);
    const model = buildDocModel(spec, prose, selected, variantIds, {
      measureViews: src.config.measureViews,
    });
    send({
      type: 'renderDocFrame',
      model,
      nodeId: src.node.id,
      contentHash: specContentHash(spec),
      extractorVersion: EXTRACTOR_VERSION,
      config: src.config,
      ...(prose ? { prose } : {}),
    });
    // Loader stops on docFrameDone/docFrameError (ui.ts).
    return true;
  } catch (err) {
    ui.stopProgress();
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Update failed: ${msg}`);
    return false;
  }
}

/** Legacy adapter for a Library row update. */
export function runUpdateFromSource(
  refs: Refs,
  state: UiState,
  src: DocSource,
): Promise<boolean> {
  return updateFromSource(state, src, refsPresenter(refs, refs.createFrameBtn));
}

// ---------------------------------------------------------------------------
// Copy for AI (My Library) — put a YAML brief on the clipboard.
//
// Deliberately unlike the doc-building actions: it re-extracts the source the
// way Update does, but it never generates prose, never touches quota, and
// never mutates the canvas or any stored metadata. Guidelines come from the
// caller, which read them from DOC_PROSE_KEY.
// ---------------------------------------------------------------------------
export async function copyBriefFromSource(
  state: UiState,
  src: DocSource,
  prose: ProseDrafts | null,
  ui: BuildPresenter,
): Promise<void> {
  ui.clear();
  try {
    const spec = extract(src.node, { figmaFile: src.fileKey });
    const yaml = toYaml(componentBrief(spec, {
      generatedAt: new Date().toISOString(),
      ...(foundationSpec ? { foundation: foundationSpec } : {}),
      prose,
    }));
    const lines = yaml.split('\n').length;
    const size = lines > 800 ? ` ${lines} lines, which is large for some chat windows.` : '';
    const missing = foundationSpec ? '' : ' Token values are missing because foundations have not been read yet.';
    const noProse = prose ? '' : ' This document was made before guidelines were saved, so it has none.';
    const caveat = `${size}${missing}${noProse}`.trim();
    const tier = await copyText(yaml);
    if (tier === 'manual') {
      renderManualCopyModal(yaml, caveat || undefined);
      return;
    }
    ui.info(`Copied.${size}${missing}${noProse}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Could not read that component. Nothing was copied. ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Foundations — the file-wide (selection-independent) variables/text-styles tab.
// State lives at module scope like the AI plumbing above: the spec/selection
// persist across paints within a session but never touch UiState, since they
// have nothing to do with the current Figma selection.
// ---------------------------------------------------------------------------

let foundationSpec: FoundationSpec | null = null;
let foundationSelection: FoundationSelection = { collections: [], textStyles: false };
// True from the moment the create-frames click handler sends its request until
// foundationDone/foundationFrameError comes back. Threaded into the disabled
// computation so a repaint mid-generation (e.g. the user toggling a checkbox)
// can't re-enable the button and let a second request through.
let foundationGenerating = false;

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
 * Copy the whole file's foundation as a YAML brief.
 *
 * Deliberately ignores the scope selection that foundation DOCUMENT generation
 * respects: the brief exists to give an agent a complete token vocabulary, and
 * a partial one produces exactly the invented token names the brief is meant
 * to prevent.
 */
export async function copyFoundationBrief(ui: BuildPresenter): Promise<void> {
  ui.clear();
  const spec = currentFoundationSpec();
  if (!spec) {
    ui.error('Read the foundations first, then copy.');
    return;
  }
  try {
    const yaml = toYaml(foundationBrief(spec, new Date().toISOString()));
    const lines = yaml.split('\n').length;
    const size = lines > 800 ? ` ${lines} lines, which is large for some chat windows.` : '';
    const tier = await copyText(yaml);
    if (tier === 'manual') {
      renderManualCopyModal(yaml, size.trim() || undefined);
      return;
    }
    ui.info(`Copied.${size}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ui.error(`Could not read the foundations. Nothing was copied. ${msg}`);
  }
}

/** Set by ui.ts around the renderFoundation round-trip: true on click, false on
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
  foundationGenerating = value;
  foundationHost.setBusy(value);
  // The loader lives with the flag rather than at the call sites, so a build
  // cannot end up running with no loader (or a loader with no build): both
  // callers set the flag, and there are three ways a build can finish.
  if (value) {
    foundationHost.startProgress(
      foundationBuildMessages(
        foundationSpec ? frameCount(foundationSpec, foundationSelection) : 0,
      ),
    );
  } else {
    foundationHost.stopProgress();
  }
  foundationHost.repaint();
}

/**
 * What the build loader says while frames are produced. These phases are real:
 * the main thread re-reads the file, lays out each table, then places the
 * Sections. The last line is singular for a one-frame build, since claiming
 * "frames" for one frame is the kind of small lie that makes a user distrust
 * the rest of the message.
 */
function foundationBuildMessages(frames: number): string[] {
  return [
    "Reading this file's variables and styles",
    'Laying out the tables',
    frames === 1 ? 'Placing the frame on the canvas' : 'Placing the frames on the canvas',
  ];
}

/** Whether the Foundations tab's bulk build is in flight. Read by ui.ts's
 *  shared build guard, so the other two entry points can see this one. */
export function isFoundationGenerating(): boolean {
  return foundationGenerating;
}

export function onFoundationMessage(dump: SerializedFoundation): void {
  foundationSpec = buildFoundation(dump);
  foundationSelection = defaultSelection(foundationSpec);
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
  | { kind: 'textStyles'; checked: boolean };

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

/** Legacy adapter: translate a rendered checkbox into a value for the action. */
export function onFoundationCheckboxChange(input: HTMLInputElement): void {
  const collectionId = input.dataset.collectionId ?? '';
  switch (input.dataset.act) {
    case 'toggle-collection':
      onFoundationChange({ kind: 'collection', collectionId, checked: input.checked });
      break;
    case 'toggle-mode':
      onFoundationChange({
        kind: 'mode',
        collectionId,
        modeId: input.dataset.modeId ?? '',
        checked: input.checked,
      });
      break;
    case 'toggle-text-styles':
      onFoundationChange({ kind: 'textStyles', checked: input.checked });
      break;
  }
}

/** Read by the create-frames button; exported so ui.ts can post it. */
export function currentFoundationSelection(): FoundationSelection {
  return foundationSelection;
}

/**
 * The group briefs for the current selection, or null before the file is read.
 *
 * Lives here because the spec and selection do, and it keys the briefs the same
 * way the renderer keys its lookups.
 */
export function currentGroupBriefs(): { collectionName: string; groups: FoundationGroupBrief[] } | null {
  if (!foundationSpec) return null;
  return groupBriefs(foundationSpec, foundationSelection);
}
