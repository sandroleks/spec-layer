/**
 * render.ts — view updates only. No business logic, no fetch.
 *
 * Owns: phase rendering, info/error banners, tab switching, and applying an
 * incoming selection to the DOM. All functions take the `Refs` (and the small
 * `UiState`) so there are no module globals to reach for.
 */

import type { Refs } from './dom';
import type { UiState } from './actions';
import { isAtomComponentName } from '../collectComponents';
import { resolveBrand } from '../brandColors';
import { defaultVariantId, variantLabel } from './docModel';

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
// Generating loader — a pulsing sparkle + shimmering status text that cycles
// through a few messages while the frame is built (and prose optionally drafted).
// Replaces the old static "Building frame…" banner with something livelier.
// ---------------------------------------------------------------------------

// Single in-flight cycle. Module-scoped so stopLoader can always clear it, even
// if startLoader is called twice (the second run cancels the first).
let loaderTimer: ReturnType<typeof setInterval> | null = null;

/** Show the loader and cycle `messages` every ~2.6s. The shimmer + dots carry
 *  the motion, so the title is swapped in place (no fade-to-blank — that left a
 *  visibly empty pill mid-transition). Loops, so a long job keeps cycling rather
 *  than parking on the last line. A single message just stays put. */
export function startLoader(refs: Refs, messages: string[]): void {
  stopLoader(refs);
  const msgs = messages.length ? messages : ['Working…'];
  refs.loader.classList.add('show');
  refs.loaderText.textContent = msgs[0];
  if (msgs.length === 1) return;

  let i = 0;
  loaderTimer = setInterval(() => {
    i = (i + 1) % msgs.length;
    refs.loaderText.textContent = msgs[i];
  }, 2600);
}

/** Hide the loader and stop cycling. Safe to call when already stopped. */
export function stopLoader(refs: Refs): void {
  if (loaderTimer) { clearInterval(loaderTimer); loaderTimer = null; }
  refs.loader.classList.remove('show');
}

// ---------------------------------------------------------------------------
// Phase rendering
// ---------------------------------------------------------------------------

export function renderPhase(refs: Refs, state: UiState): void {
  // Extraction is now automatic on selection with its own "Reading…" chip
  // (see runAutoExtract), so phase rendering only gates the (hidden) extract
  // control while a legacy 'extracting' phase is in flight.
  refs.extractBtn.disabled = state.phase === 'extracting';
}

// ---------------------------------------------------------------------------
// Selection — apply an incoming selection to the DOM
// ---------------------------------------------------------------------------

/**
 * Show the sticky action footer only on the Selected-component tab and only when
 * a component is actually selected (otherwise there's nothing to act on).
 */
export function syncFooter(refs: Refs): void {
  const onSelected = refs.panelSelected.classList.contains('active');
  const hasComponent = refs.mainArea.style.display !== 'none';
  refs.actionFooter.style.display = onSelected && hasComponent ? 'block' : 'none';
}

export function renderSelection(refs: Refs, state: UiState): void {
  if (state.currentNode) {
    refs.noSelection.style.display = 'none';
    refs.mainArea.style.display = 'block';
    refs.componentName.textContent = state.currentNode.name;
    refs.atomNotice.style.display = isAtomComponentName(state.currentNode.name) ? 'block' : 'none';
    // Hide the variant picker until the new spec is extracted (renderVariantPicker
    // re-populates it once ready).
    refs.variantPicker.style.display = 'none';
    clearBanners(refs);
    renderPhase(refs, state);
  } else {
    refs.noSelection.style.display = 'block';
    refs.mainArea.style.display = 'none';
    refs.atomNotice.style.display = 'none';
  }
  syncFooter(refs);
}

/**
 * Populate + show the "Variants to document" picker. Visible only when the
 * Tokens section is checked and the selection is a component set with variants.
 * Rebuilds the list only when the component changes, so it never clobbers the
 * user's current variant selection (e.g. on a Tokens toggle).
 */
export function renderVariantPicker(refs: Refs, state: UiState): void {
  const spec = state.currentSpec;
  const tokensChecked = refs.sectionChecks['tokens']?.checked ?? false;
  const instances = spec?.variantInstances ?? [];
  const show = Boolean(tokensChecked && instances.length > 0);
  refs.variantPicker.style.display = show ? 'block' : 'none';
  if (!show || !spec) return;

  const nodeId = state.currentNode?.id ?? '';
  if (refs.variantList.dataset.nodeId === nodeId && refs.variantList.childElementCount > 0) return;
  refs.variantList.dataset.nodeId = nodeId;
  refs.variantList.textContent = '';

  const defId = defaultVariantId(spec);
  for (const inst of instances) {
    const row = document.createElement('div');
    row.className = 'sec-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `var-${inst.nodeId.replace(/[^a-z0-9]/gi, '-')}`;
    input.dataset.nodeId = inst.nodeId;
    input.checked = inst.nodeId === defId;
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = variantLabel(inst);
    row.appendChild(input);
    row.appendChild(label);
    refs.variantList.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Frame brand colors (Settings)
// ---------------------------------------------------------------------------

/**
 * Reflect the stored brand colors into the Settings fields: each input shows
 * the override (empty when unset, so the placeholder surfaces the default), and
 * each swatch shows the *effective* color (override or default).
 */
export function renderBrandColors(refs: Refs, state: UiState): void {
  const effective = resolveBrand(state.brandColors);
  refs.headerColorInput.value = state.brandColors.headerBg ?? '';
  refs.accentColorInput.value = state.brandColors.accent ?? '';
  refs.headerColorSwatch.style.background = effective.headerBg;
  refs.accentColorSwatch.style.background = effective.accent;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export type TabId = 'selected' | 'settings';

export function switchTab(refs: Refs, tab: TabId): void {
  const tabs: Array<[TabId, HTMLButtonElement, HTMLElement]> = [
    ['selected', refs.tabSelected, refs.panelSelected],
    ['settings', refs.tabSettings, refs.panelSettings],
  ];
  for (const [id, btn, panel] of tabs) {
    const active = id === tab;
    btn.setAttribute('aria-selected', String(active));
    panel.classList.toggle('active', active);
  }
  syncFooter(refs);
}
