/**
 * render.ts — view updates only. No business logic, no fetch.
 *
 * Owns: phase rendering, info/error banners, tab switching, and applying an
 * incoming selection to the DOM. All functions take the `Refs` (and the small
 * `UiState`) so there are no module globals to reach for.
 */

import type { Refs } from './dom';
import type { UiState } from './actions';
import type { FileKeySource } from '../fileKey';
import { isAtomComponentName } from '../collectComponents';

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

export function showBanner(refs: Refs, type: 'info' | 'error' | null, text: string): void {
  refs.bannerInfo.style.display = type === 'info' ? 'flex' : 'none';
  refs.bannerError.style.display = type === 'error' ? 'flex' : 'none';
  if (type === 'info') refs.bannerInfo.textContent = text;
  if (type === 'error') refs.bannerError.textContent = text;
}

export function clearBanners(refs: Refs): void {
  showBanner(refs, null, '');
}

// ---------------------------------------------------------------------------
// Phase rendering
// ---------------------------------------------------------------------------

export function renderPhase(refs: Refs, state: UiState): void {
  // Extraction is now automatic on selection with its own "Reading…" chip
  // (see runAutoExtract), so phase rendering only gates the (hidden) extract
  // and send controls while a legacy 'extracting' phase is in flight.
  refs.extractBtn.disabled = state.phase === 'extracting';
  refs.sendBtn.disabled = state.phase === 'extracting';
}

// ---------------------------------------------------------------------------
// Selection — apply an incoming selection to the DOM
// ---------------------------------------------------------------------------

export function renderSelection(refs: Refs, state: UiState): void {
  // A fresh selection starts a new cycle — drop any inline send-time prompt
  // left over from a previous component's failed send.
  showInlineFileKeyPrompt(refs, false);
  if (state.currentNode) {
    refs.noSelection.style.display = 'none';
    refs.mainArea.style.display = 'block';
    refs.componentName.textContent = state.currentNode.name;
    refs.atomNotice.style.display = isAtomComponentName(state.currentNode.name) ? 'block' : 'none';
    clearBanners(refs);
    renderPhase(refs, state);
  } else {
    refs.noSelection.style.display = 'block';
    refs.mainArea.style.display = 'none';
    refs.atomNotice.style.display = 'none';
  }
}

export function renderFigmaConnection(
  refs: Refs,
  source: FileKeySource,
  fileKey: string,
  override: string | null,
): void {
  refs.fileKeyStatus.className = `figma-source ${source}`;
  refs.fileKeyField.style.display = source === 'figma' ? 'none' : 'block';

  // A resolved source (auto-detected or pasted) clears any inline send-time
  // prompt that was nagging the user in the component panel.
  if (source !== 'missing') showInlineFileKeyPrompt(refs, false);

  if (source === 'figma') {
    refs.fileKeyStatusTitle.textContent = 'Connected automatically';
    refs.fileKeyStatusDetail.textContent = 'The current Figma file will be included with every spec you send.';
    refs.fileKeyInput.value = '';
    refs.fileKeyHint.textContent = '';
    return;
  }

  if (source === 'override') {
    refs.fileKeyStatusTitle.textContent = 'Connected with a pasted file';
    refs.fileKeyStatusDetail.textContent = `Using ${fileKey}. New exports will include this source.`;
    refs.fileKeyLabel.textContent = 'Change Figma file URL or key';
    refs.fileKeyInput.value = override ?? fileKey;
    refs.fileKeyHint.textContent = 'Saved for this plugin until you remove it.';
    return;
  }

  refs.fileKeyStatusTitle.textContent = 'Figma file not detected';
  refs.fileKeyStatusDetail.textContent = 'Paste this file\'s URL once so previews work after import.';
  refs.fileKeyLabel.textContent = 'Figma file URL';
  refs.fileKeyInput.value = '';
  refs.fileKeyHint.textContent = '';
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export type TabId = 'selected' | 'all' | 'settings';

export function switchTab(refs: Refs, tab: TabId): void {
  const tabs: Array<[TabId, HTMLButtonElement, HTMLElement]> = [
    ['selected', refs.tabSelected, refs.panelSelected],
    ['all', refs.tabAll, refs.panelAll],
    ['settings', refs.tabSettings, refs.panelSettings],
  ];
  for (const [id, btn, panel] of tabs) {
    const active = id === tab;
    btn.setAttribute('aria-selected', String(active));
    panel.classList.toggle('active', active);
  }
}

/**
 * Reveal or hide the inline "paste this file's URL" prompt in the component
 * panel. Shown only when a send is blocked by a missing Figma file key, so the
 * user can fix it without leaving the component for the Settings tab.
 */
export function showInlineFileKeyPrompt(refs: Refs, show: boolean): void {
  refs.inlineFileKey.style.display = show ? 'block' : 'none';
}

// ---------------------------------------------------------------------------
// Export-all progress + completion
// ---------------------------------------------------------------------------

/**
 * Show the enumeration phase, which on the main thread runs before any
 * progress count is known (loadAllPagesAsync + findAllWithCriteria). Without
 * this the panel would sit empty during a potentially long scan on large files.
 */
export function renderExportScanning(refs: Refs): void {
  refs.exportStatus.style.color = '';
  refs.exportStatus.textContent = 'Scanning the file for components… (large files can take a while)';
}

/**
 * Update the export-status element during a bulk export.
 *
 * When `errorMsg` is provided the status shows an error instead of progress.
 * `failed` (optional) appends a "(N failed)" note while progress streams.
 */
export function renderExportProgress(
  refs: Refs,
  index: number,
  total: number,
  errorMsg?: string,
  failed = 0,
): void {
  if (errorMsg) {
    refs.exportStatus.style.color = 'var(--figma-color-bg-danger)';
    refs.exportStatus.textContent = `Export failed: ${errorMsg}`;
    return;
  }
  refs.exportStatus.style.color = '';
  if (total === 0) {
    refs.exportStatus.textContent = 'Starting export…';
  } else {
    const failedNote = failed > 0 ? ` (${failed} failed)` : '';
    refs.exportStatus.textContent = `Rendering ${index} / ${total}…${failedNote}`;
  }
}

/**
 * Render the success state after exportAllDone fires.
 * Uses `count` (actual items zipped) which may be < total (skipped/failed
 * nodes). `failed` (optional) is reported so silent drops are visible.
 */
export function renderExportDone(
  refs: Refs,
  count: number,
  folderName: string,
  failed = 0,
  skippedAtoms = 0,
): void {
  refs.exportStatus.style.color = '';
  if (count === 0) {
    if (skippedAtoms > 0 && failed === 0) {
      refs.exportStatus.textContent = exportDoneMessage(count, folderName, failed, skippedAtoms);
      return;
    }
    refs.exportStatus.style.color = 'var(--figma-color-bg-danger)';
    refs.exportStatus.textContent =
      failed > 0
        ? `No components exported — all ${failed} failed to render. See the console for details.`
        : 'No components found to export in this file.';
    return;
  }
  refs.exportStatus.textContent = exportDoneMessage(count, folderName, failed, skippedAtoms);
}

export function exportDoneMessage(
  count: number,
  folderName: string,
  failed = 0,
  skippedAtoms = 0,
): string {
  if (count === 0 && skippedAtoms > 0 && failed === 0) {
    return `No standard components found. Skipped ${skippedAtoms} atom component${skippedAtoms === 1 ? '' : 's'}; enable Include atom components to export them.`;
  }
  const failedNote = failed > 0 ? `, ${failed} failed` : '';
  const atomNote = skippedAtoms > 0
    ? `, skipped ${skippedAtoms} atom component${skippedAtoms === 1 ? '' : 's'}`
    : '';
  return `Exported ${count} component${count === 1 ? '' : 's'}${failedNote}${atomNote} → ${folderName}.zip`;
}
