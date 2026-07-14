/**
 * actions.ts — the action handlers (runExtract / runDownload / runCreateDocFrame)
 * plus the module-scoped UI state.
 *
 * Logic only — DOM reads/writes that are view concerns live in render.ts; these
 * handlers call into render for banners/phase updates.
 */

import { extract, renderSpec, ProseProxyError, specContentHash } from '@spec-layer/extractor';
import type { SerializedNode, IntermediateSpec, ProseDrafts, ProseKey, ProxyQuota } from '@spec-layer/extractor';
import type { UiToMain } from '../messages';
import type { DocConfig } from '../docLink';
import { nextStatus, resetToIdle, toKebab, type UiPhase } from './state';
import { generateProse } from './ai';
import { effectiveAuth, generationErrorCopy } from './proxy';
import { emptyBrandTheme, type BrandTheme } from '../brandColors';
import { buildDocModel, ALL_SECTIONS, proseKeysForSections, type SectionId, type MeasureView, type DocFrameModel } from './docModel';
import { modelToMarkdown } from './modelMarkdown';
import type { Refs } from './dom';
import {
  showBanner,
  clearBanners,
  renderPhase,
  startLoader,
  stopLoader,
} from './render';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface UiState {
  phase: UiPhase;
  currentNode: SerializedNode | null;
  currentFileKey: string;
  currentSpec: IntermediateSpec | null;
  currentExtractedAt: string;
  renderedMd: string;
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
  // How the anatomy section renders: numbered diagram, tabular list, or both.
  anatomyView: 'diagram' | 'table' | 'both';
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
    renderedMd: '',
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
    anatomyView: 'diagram',
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
// renderOne — shared extraction helper (used by runExtract and runExportAll).
// ---------------------------------------------------------------------------

export function renderOne(
  node: SerializedNode,
  fileKey: string,
): { name: string; markdown: string; spec: IntermediateSpec; extractedAt: string } {
  const extractedAt = new Date().toISOString();
  const spec = extract(node, { figmaFile: fileKey });
  const markdown = renderSpec(spec, { prose: null, extractedAt });
  return { name: spec.name, markdown, spec, extractedAt };
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

  const { name, markdown, spec, extractedAt } = renderOne(state.currentNode, state.currentFileKey);
  state.renderedMd = markdown;
  state.currentSpec = spec;
  state.currentExtractedAt = extractedAt;

  state.phase = nextStatus(state.phase, 'rendered');
  renderPhase(refs, state);

  send({ type: 'notify', message: `Spec extracted for ${name}` });
}

// ---------------------------------------------------------------------------
// Implicit extraction — make the legacy Download/Send and the new AI/frame
// actions work without a visible Extract button. If a spec is already present it
// is reused; otherwise we extract the current node on demand.
// ---------------------------------------------------------------------------

export function ensureExtracted(state: UiState): boolean {
  if (state.currentSpec) return true;
  if (!state.currentNode) return false;
  const { spec, markdown, extractedAt } = renderOne(state.currentNode, state.currentFileKey);
  state.currentSpec = spec;
  state.renderedMd = markdown;
  state.currentExtractedAt = extractedAt;
  return true;
}

// ---------------------------------------------------------------------------
// Auto-extract on selection — keeps the spec always-ready so Export/Download and
// the frame never block on a missing spec. The (synchronous) extract is deferred
// one frame so the panel paints identity + sections first; a "Reading…" chip
// shows meanwhile and clears when the spec is ready.
// ---------------------------------------------------------------------------

export function runAutoExtract(refs: Refs, state: UiState, onReady?: () => void): void {
  if (!state.currentNode) return;
  if (state.currentSpec) { onReady?.(); return; }
  refs.phaseLabel.className = 'chip';
  refs.phaseLabel.textContent = 'Reading…';
  requestAnimationFrame(() => {
    try {
      ensureExtracted(state);
    } catch {
      /* errors surface when an action actually runs */
    }
    refs.phaseLabel.className = 'phase-label';
    refs.phaseLabel.textContent = '';
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
function requestedProseKeys(refs: Refs): Set<ProseKey> {
  const checked = new Set<SectionId>();
  for (const { id } of ALL_SECTIONS) if (refs.sectionChecks[id]?.checked) checked.add(id);
  return proseKeysForSections(checked);
}

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

function willGenerateProse(refs: Refs, state: UiState): boolean {
  if (!canGenerate(state)) return false;
  const requested = requestedProseKeys(refs);
  if (requested.size === 0) return false;
  return proseNeedsRegen(state, requested);
}

async function ensureProse(refs: Refs, state: UiState): Promise<void> {
  state.pendingAiNote = '';
  if (!willGenerateProse(refs, state)) return;
  const requested = requestedProseKeys(refs);

  // The generating loader (started by runCreateDocFrame) surfaces progress; this
  // path is best-effort. AI is an enhancement, never a blocker. If generation fails
  // (rate limit, network, unexpected response), fall back to placeholders and
  // let the frame build anyway — the note surfaces on the success banner.
  try {
    // willGenerateProse guarantees a non-null identity, spec, and node. A key
    // known-inactive drops to the free identity (effectiveAuth) rather than 401ing.
    state.generatedProse = await generateProse(
      state.currentSpec!,
      effectiveAuth(state.licenseKey, state.figmaUserId, state.licenseActive),
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
        // Key lapsed mid-session: drop to the free identity for the next run and
        // explain it. This frame builds with placeholders; the next generation
        // authenticates as free. Settings reflects the lapse on its next refresh.
        state.licenseActive = false;
        state.pendingAiNote = "Your Pro subscription isn't active, so AI didn't run this time. You're back on the free tier, and the renew option is in Settings.";
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

export async function runCreateDocFrame(refs: Refs, state: UiState): Promise<void> {
  clearBanners(refs);

  if (!ensureExtracted(state)) {
    showBanner(refs, 'error', 'Select a component first.');
    return;
  }

  // Guard against a double-click sending two renderDocFrame messages (and
  // building two frames). Re-enabled by docFrameDone/docFrameError, or here on
  // an early failure (e.g. AI generation throwing before we dispatch).
  refs.createFrameBtn.disabled = true;

  // Livelier than a static banner: cycle status messages while we work. The AI
  // path is slow (network) and deserves the richer narration; the no-AI path is
  // fast, so it gets a shorter set. stopLoader runs on done/error (ui.ts) or in
  // the catch below.
  startLoader(refs, generatingMessages(willGenerateProse(refs, state)));

  try {
    const built = await assembleDoc(refs, state);
    if (!built) {
      // No sections checked: assembleDoc showed the banner. Reset the frame UI.
      refs.createFrameBtn.disabled = false;
      stopLoader(refs);
      return;
    }
    send({
      type: 'renderDocFrame',
      model: built.model,
      nodeId: state.currentNode!.id,
      contentHash: specContentHash(state.currentSpec!),
      config: built.config,
    });
    // Keep the loader running — it stops on docFrameDone/docFrameError (ui.ts).
  } catch (err) {
    stopLoader(refs);
    const msg = err instanceof Error ? err.message : String(err);
    showBanner(refs, 'error', `Frame failed: ${msg}`);
    refs.createFrameBtn.disabled = false;
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
async function assembleDoc(
  refs: Refs,
  state: UiState,
): Promise<{ model: DocFrameModel; config: DocConfig } | null> {
  await ensureProse(refs, state);

  const selected = new Set<SectionId>();
  for (const { id } of ALL_SECTIONS) {
    if (refs.sectionChecks[id]?.checked) selected.add(id);
  }
  if (selected.size === 0) {
    showBanner(refs, 'error', 'Select at least one section.');
    return null;
  }

  // Per-variant tokens: which variants the user ticked in the picker.
  const variantIds = new Set<string>();
  refs.variantList.querySelectorAll('input:checked').forEach((el) => {
    const id = (el as HTMLInputElement).dataset.nodeId;
    if (id) variantIds.add(id);
  });

  const model = buildDocModel(
    state.currentSpec!,
    state.generatedProse,
    selected,
    variantIds,
    { anatomyView: state.anatomyView, measureViews: state.measureViews },
  );
  const config: DocConfig = {
    sections: [...selected],
    variantIds: [...variantIds],
    aiEnabled: state.aiEnabled,
    anatomyView: state.anatomyView,
    measureViews: state.measureViews,
  };
  return { model, config };
}

/** Status lines for the generating loader. The AI path narrates the slow
 *  network round-trip; the no-AI path is near-instant so it stays terse. */
function generatingMessages(withAi: boolean): string[] {
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
  state.licenseKey = value || null;
  state.licenseInstanceId = instanceId;
  send({ type: 'setLicenseKey', value, instanceId });
}

export function setAiEnabled(state: UiState, value: boolean): void {
  state.aiEnabled = value;
  send({ type: 'setAiEnabled', value });
}

export function setBrandTheme(state: UiState, value: BrandTheme): void {
  state.brandTheme = value;
  send({ type: 'setBrandTheme', value });
}

function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  // Copy into a plain ArrayBuffer to satisfy Blob constructor typings for
  // byte sources whose buffer may be an ArrayBufferLike (e.g. SharedArrayBuffer).
  const buffer: ArrayBuffer = bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    : new Uint8Array(bytes).buffer as ArrayBuffer;
  const blob = new Blob([buffer], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Download — saves the rendered spec as a bare markdown file, so it drops
// straight into an AI tool. Local Blob; no docs endpoint and no network.
// ---------------------------------------------------------------------------

/** Filename for a downloaded single-component spec: "<slug>.spec.md".
 *  Mirrors the export slug rules: kebab-case, trim dashes, fall back to
 *  "component" when the name reduces to nothing. */
export function specMarkdownFilename(spec: IntermediateSpec, fallbackName = 'component'): string {
  const name = spec.name || fallbackName;
  const slug = toKebab(name).replace(/^-+|-+$/g, '') || 'component';
  return `${slug}.spec.md`;
}

export async function runDownload(refs: Refs, state: UiState): Promise<void> {
  clearBanners(refs);

  if (!ensureExtracted(state)) {
    showBanner(refs, 'error', 'Select a component first.');
    return;
  }

  // Same prep as Create frame (AI prose + section/variant selection), so the
  // downloaded markdown matches the frame. Disable the button and narrate while
  // any generation runs.
  refs.downloadBtn.disabled = true;
  startLoader(refs, generatingMessages(willGenerateProse(refs, state)));

  try {
    const built = await assembleDoc(refs, state);
    if (!built) {
      stopLoader(refs);
      refs.downloadBtn.disabled = false;
      return;
    }

    const markdown = modelToMarkdown(built.model);
    const filename = specMarkdownFilename(state.currentSpec!, state.currentNode?.name ?? 'component');
    downloadBytes(new TextEncoder().encode(markdown), filename, 'text/markdown');

    stopLoader(refs);
    refs.downloadBtn.disabled = false;
    // Surface any AI note (quota exhausted, lapsed key, generation error) the
    // same way the frame does via its success banner.
    if (state.pendingAiNote) {
      showBanner(refs, 'error', state.pendingAiNote);
      state.pendingAiNote = '';
    }
  } catch (err) {
    stopLoader(refs);
    const msg = err instanceof Error ? err.message : String(err);
    showBanner(refs, 'error', `Download failed: ${msg}`);
    refs.downloadBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Update from source (My Library) — regenerate a doc in place using its stored
// config, WITHOUT touching the Selected-component tab's live state. Extraction
// is deterministic; prose runs only when the stored config had AI on. Dispatches
// renderDocFrame, which replaces the existing doc (matched by sourceNodeId).
// ---------------------------------------------------------------------------
export async function runUpdateFromSource(
  refs: Refs,
  state: UiState,
  src: { docId: string; node: SerializedNode; fileKey: string; config: DocConfig },
): Promise<boolean> {
  clearBanners(refs);
  startLoader(refs, ['Reading the component', 'Composing sections', 'Placing the frame on the canvas']);
  try {
    const spec = extract(src.node, { figmaFile: src.fileKey });
    const selected = new Set<SectionId>(src.config.sections);

    let prose = null as Awaited<ReturnType<typeof generateProse>>;
    const requested = proseKeysForSections(selected);
    if (src.config.aiEnabled && requested.size > 0 && (state.licenseKey || state.figmaUserId)) {
      try {
        prose = await generateProse(
          spec,
          effectiveAuth(state.licenseKey, state.figmaUserId, state.licenseActive),
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
      anatomyView: src.config.anatomyView,
      measureViews: src.config.measureViews,
    });
    send({
      type: 'renderDocFrame',
      model,
      nodeId: src.node.id,
      contentHash: specContentHash(spec),
      config: src.config,
    });
    // Loader stops on docFrameDone/docFrameError (ui.ts).
    return true;
  } catch (err) {
    stopLoader(refs);
    const msg = err instanceof Error ? err.message : String(err);
    showBanner(refs, 'error', `Update failed: ${msg}`);
    return false;
  }
}
