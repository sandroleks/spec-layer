/**
 * actions.ts — the action handlers (runExtract / runDownload / runCreateDocFrame)
 * plus the module-scoped UI state.
 *
 * Logic only — DOM reads/writes that are view concerns live in render.ts; these
 * handlers call into render for banners/phase updates.
 */

import { extract, renderSpec } from '@spec-layer/extractor';
import type { SerializedNode, IntermediateSpec, ProseDrafts } from '@spec-layer/extractor';
import type { UiToMain } from '../messages';
import { nextStatus, resetToIdle, toKebab, type UiPhase } from './state';
import { generateProse } from './ai';
import { emptyBrandColors, type BrandColors } from '../brandColors';
import { buildDocModel, ALL_SECTIONS, type SectionId } from './docModel';
import type { Refs } from './dom';
import {
  showBanner,
  clearBanners,
  renderPhase,
  startLoader,
  stopLoader,
} from './render';
import {
  buildSingleExportFiles,
  zipFiles,
} from '../exportFiles';

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
  // Standalone AI flow: BYO Anthropic key (mirrored to clientStorage via main),
  // the global "Write with AI" preference, and the most recent generated prose
  // drafts used to fill AI sections.
  anthropicKey: string | null;
  aiEnabled: boolean;
  generatedProse: ProseDrafts | null;
  // Set when an AI generation attempt fails so the next frame-build can note it
  // ("built with placeholders") instead of aborting the whole frame.
  pendingAiNote: string;
  // User-customized brand colors for the generated frame (null fields = default).
  brandColors: BrandColors;
}

export function createState(): UiState {
  return {
    phase: 'idle',
    currentNode: null,
    currentFileKey: '',
    currentSpec: null,
    currentExtractedAt: '',
    renderedMd: '',
    anthropicKey: null,
    aiEnabled: false,
    generatedProse: null,
    pendingAiNote: '',
    brandColors: emptyBrandColors(),
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

function willGenerateProse(refs: Refs, state: UiState): boolean {
  if (!state.aiEnabled || !state.anthropicKey) return false;
  if (state.generatedProse) return false;
  return ALL_SECTIONS.some((s) => s.ai && refs.sectionChecks[s.id]?.checked);
}

async function ensureProse(refs: Refs, state: UiState): Promise<void> {
  state.pendingAiNote = '';
  if (!willGenerateProse(refs, state)) return;

  // The generating loader (started by runCreateDocFrame) surfaces progress; this
  // path is best-effort. AI is an enhancement, never a blocker. If generation fails
  // (rate limit, network, unexpected response), fall back to placeholders and
  // let the frame build anyway — the note surfaces on the success banner.
  try {
    // willGenerateProse guarantees a non-null key, spec, and node.
    state.generatedProse = await generateProse(
      state.currentSpec!,
      state.anthropicKey!,
      state.currentNode!.id,
    );
  } catch (err) {
    state.generatedProse = null;
    const detail = err instanceof Error ? err.message : String(err);
    state.pendingAiNote = `AI skipped (${detail}) — placeholders used`;
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
    await ensureProse(refs, state);

    const selected = new Set<SectionId>();
    for (const { id } of ALL_SECTIONS) {
      if (refs.sectionChecks[id]?.checked) selected.add(id);
    }

    // Per-variant tokens: which variants the user ticked in the picker.
    const variantIds = new Set<string>();
    refs.variantList.querySelectorAll('input:checked').forEach((el) => {
      const id = (el as HTMLInputElement).dataset.nodeId;
      if (id) variantIds.add(id);
    });

    const model = buildDocModel(state.currentSpec!, state.generatedProse, selected, variantIds);
    send({ type: 'renderDocFrame', model, nodeId: state.currentNode!.id });
    // Keep the loader running — it stops on docFrameDone/docFrameError (ui.ts).
  } catch (err) {
    stopLoader(refs);
    const msg = err instanceof Error ? err.message : String(err);
    showBanner(refs, 'error', `Frame failed: ${msg}`);
    refs.createFrameBtn.disabled = false;
  }
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

export function setAnthropicKey(state: UiState, value: string): void {
  state.anthropicKey = value || null;
  send({ type: 'setAnthropicKey', value: state.anthropicKey });
}

export function setAiEnabled(state: UiState, value: boolean): void {
  state.aiEnabled = value;
  send({ type: 'setAiEnabled', value });
}

export function setBrandColors(state: UiState, value: BrandColors): void {
  state.brandColors = value;
  send({ type: 'setBrandColors', value });
}

function downloadBytes(bytes: Uint8Array, filename: string, type: string): void {
  // Copy into a plain ArrayBuffer to satisfy Blob constructor typings when
  // fflate's result carries ArrayBufferLike (may include SharedArrayBuffer).
  const zipped = bytes;
  const zipBuffer: ArrayBuffer = zipped.buffer instanceof ArrayBuffer
    ? zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
    : new Uint8Array(zipped).buffer as ArrayBuffer;
  const blob = new Blob([zipBuffer], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Download — local Blob; works with no docs endpoint and no network.
// ---------------------------------------------------------------------------

export function runDownload(refs: Refs, state: UiState): void {
  if (!ensureExtracted(state)) {
    showBanner(refs, 'error', 'Select a component first.');
    return;
  }

  const bundle = buildSingleExportBundle(
    state.renderedMd,
    state.currentSpec!,
    state.currentNode?.name ?? 'component',
  );
  downloadBytes(bundle.bytes, bundle.filename, 'application/zip');
}

export function buildSingleExportBundle(
  markdown: string,
  spec: IntermediateSpec,
  fallbackName = 'component',
): { filename: string; bytes: Uint8Array } {
  const name = spec.name || fallbackName;
  const slug = toKebab(name).replace(/^-+|-+$/g, '') || 'component';
  const files = buildSingleExportFiles({ name, markdown, spec });
  return {
    filename: `${slug}.spec-layer.zip`,
    bytes: zipFiles(files),
  };
}
