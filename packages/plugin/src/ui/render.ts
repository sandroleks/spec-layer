/**
 * render.ts — view updates only. No business logic, no fetch.
 *
 * Owns: phase rendering, info/error banners, tab switching, and applying an
 * incoming selection to the DOM. All functions take the `Refs` (and the small
 * `UiState`) so there are no module globals to reach for.
 */

import type { Refs } from './dom';
import type { UiState } from './actions';
import type { LibraryEntry } from '../messages';
import { isAtomComponentName } from '../collectComponents';
import { resolveTheme } from '../brandColors';
import { resolveStatus, type DocStatus } from '../docLink';
import { defaultVariantId } from './docModel';
import { detectStateMatrix, MAX_MODE_COLUMNS, type FoundationSelection } from '@spec-layer/extractor';
import { quotaMeterModel, upsellText, resolveLicenseView, licenseStatusCopy } from './proxy';
import { canGenerate, type FoundationSummary } from './foundationState';

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
// Quota meter + upsell fork
// ---------------------------------------------------------------------------

/**
 * License status line + renew link, derived from the live quota (single source
 * of truth). The renew link shows only when the stored key is definitely
 * inactive — never on an offline/unknown read, so a blip can't cry "cancelled".
 * Transient states (Checking…, activation errors) are set directly by ui.ts.
 */
export function renderLicense(refs: Refs, state: UiState): void {
  const view = resolveLicenseView(Boolean(state.licenseKey), state.quota);
  refs.licenseStatus.textContent = licenseStatusCopy(view, state.quota?.licenseReason);
  refs.licenseRenewRow.hidden = !(view === 'inactive' && state.quota?.licenseReason === 'expired');
  refs.licenseRemoveRow.hidden = !state.licenseKey;
  // "Get Pro" points a free, keyless user at the store. Hidden once a key is
  // stored — the expired case gets "Renew Pro" instead, active/unknown need no buy link.
  refs.licenseGetProRow.hidden = view !== 'none';
}

/** Quota meter + upsell visibility. The model owns all state branching. */
export function renderQuota(refs: Refs, state: UiState): void {
  const m = quotaMeterModel(state.quota, state.aiEnabled);
  refs.quotaMeter.hidden = m.state === 'hidden';
  refs.quotaMeter.classList.toggle('pro', m.state === 'pro');
  refs.quotaMeter.classList.toggle('low', m.state === 'low');
  // 'exhausted', not 'empty': a bare `empty` class collides with the global
  // .empty placeholder rule (padding: 32px) and balloons the card height.
  refs.quotaMeter.classList.toggle('exhausted', m.state === 'empty');
  refs.quotaBarFill.style.width = `${m.fillPct}%`;
  refs.quotaCount.textContent = m.countText;
  refs.quotaUpgrade.hidden = m.linkText === '';
  refs.quotaUpgrade.textContent = m.linkText;
  // "Activate license" rides alongside the upgrade link on the free tier —
  // buying Pro and connecting an existing key are different doors. Hidden in
  // the pro/hidden states, exactly like the upgrade link.
  refs.quotaActivate.hidden = m.linkText === '';

  const showUpsell = state.aiEnabled && state.quotaExhausted;
  refs.upsell.hidden = !showUpsell;
  // Fold the default Download/Create-frame row away while the upsell owns the
  // footer, so there's a single set of actions instead of a confusing double
  // footer. "Continue without AI" is the create-frame path here; toggling AI
  // off (or continuing) restores the default row.
  refs.primaryActions.hidden = showUpsell;
  if (showUpsell) refs.upsellText.textContent = upsellText(state.quota?.resetsAt);
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
 * Populate + show the "Variants to document" card. Visible whenever the
 * extracted spec has variant instances — no longer gated on the Tokens
 * checkbox for visibility, since the card is forward-compatible with other
 * variant-driven sections. Tokens gating instead mutes the card + collapses
 * its body + swaps the hint for an actionable link, so toggling Tokens off
 * never hides a card the user just opened.
 *
 * List rows rebuild only when the component changes, so a Tokens toggle (or
 * any other re-render) never clobbers the user's current variant selection.
 */
export function renderVariantPicker(refs: Refs, state: UiState): void {
  const spec = state.currentSpec;
  const instances = spec?.variantInstances ?? [];
  const show = instances.length > 0;
  refs.variantPicker.style.display = show ? 'block' : 'none';
  if (!show || !spec) return;

  const tokensChecked = refs.sectionChecks['tokens']?.checked ?? false;
  refs.variantPicker.classList.toggle('disabled', !tokensChecked);
  if (tokensChecked) {
    refs.variantHint.textContent = 'Applies to the Tokens section';
  } else {
    refs.variantBody.hidden = true;
    refs.variantToggle.setAttribute('aria-expanded', 'false');
    const link = document.createElement('a');
    link.className = 'vp-hint-link';
    link.textContent = 'Tokens used';
    refs.variantHint.textContent = '';
    refs.variantHint.append('Turn on ', link, ' to apply');
  }

  const nodeId = state.currentNode?.id ?? '';
  if (refs.variantList.dataset.nodeId === nodeId && refs.variantList.childElementCount > 0) return;
  refs.variantList.dataset.nodeId = nodeId;
  refs.variantList.textContent = '';

  const defId = defaultVariantId(spec);
  for (const inst of instances) {
    const row = document.createElement('div');
    row.className = 'sec-row variant-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `var-${inst.nodeId.replace(/[^a-z0-9]/gi, '-')}`;
    input.dataset.nodeId = inst.nodeId;
    input.checked = inst.nodeId === defId;
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.className = 'variant-label';
    label.appendChild(buildVariantChips(inst.values));
    row.appendChild(input);
    row.appendChild(label);
    refs.variantList.appendChild(row);
  }
  updateVariantCount(refs);
}

/**
 * Build the chip row for one variant's axis values. Enum values render as a
 * filled chip with a muted axis-name prefix then the value ("Size" + "Small"),
 * so values like "Default" stay attributed to their property. A boolean axis set
 * to true renders as an outlined flag chip named after the axis ("Disabled"),
 * since the value is implied; a false boolean is omitted as noise. A variant
 * with no chips at all shows a muted "Default" chip so the row is never empty.
 */
function buildVariantChips(values: Record<string, string>): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'variant-chips';
  let shown = 0;
  for (const [axis, value] of Object.entries(values)) {
    const low = value.toLowerCase();
    if (low === 'false') continue;
    const chip = document.createElement('span');
    chip.title = `${axis}: ${value}`;
    if (low === 'true') {
      chip.className = 'variant-chip flag';
      chip.textContent = axis;
    } else {
      chip.className = 'variant-chip';
      const ax = document.createElement('span');
      ax.className = 'vc-axis';
      ax.textContent = axis;
      chip.appendChild(ax);
      chip.appendChild(document.createTextNode(value));
    }
    wrap.appendChild(chip);
    shown++;
  }
  if (shown === 0) {
    const chip = document.createElement('span');
    chip.className = 'variant-chip muted';
    chip.textContent = 'Default';
    wrap.appendChild(chip);
  }
  return wrap;
}

/**
 * Disable + uncheck the States row when the component has no state-like axis,
 * so the UI never silently accepts a checked box it can't act on. The label
 * text stays "States" — detection status renders as a muted suffix span
 * instead of replacing the label outright. Restores checked + enabled (and
 * removes the suffix) once a selection with states arrives.
 */
export function renderStatesHint(refs: Refs, state: UiState): void {
  const check = refs.sectionChecks['states'];
  if (!check) return;
  const row = check.closest('.sec-row') as HTMLElement | null;
  const label = row?.querySelector('label');
  const hasStates = Boolean(state.currentSpec && detectStateMatrix(state.currentSpec.variants));

  label?.querySelector('.sec-note')?.remove();
  if (!hasStates && label) {
    const note = document.createElement('span');
    note.className = 'sec-note';
    note.textContent = '· none detected';
    label.appendChild(note);
  }
  check.disabled = !hasStates;
  check.checked = hasStates;
}

/** Reflect "N of M selected" in the variant-picker header. */
export function updateVariantCount(refs: Refs): void {
  const inputs = Array.from(refs.variantList.querySelectorAll('input')) as HTMLInputElement[];
  const total = inputs.length;
  const selected = inputs.filter((i) => i.checked).length;
  refs.variantCount.textContent = total ? `· ${selected} of ${total} selected` : '';
}

// ---------------------------------------------------------------------------
// Frame brand theme (Settings)
// ---------------------------------------------------------------------------

/**
 * Reflect the stored brand theme into the Settings fields: each input shows
 * the override (empty when unset, so the placeholder surfaces the default), each
 * swatch shows the *effective* color (override or default), and the logo preview
 * reflects whether a logo has been captured.
 */
export function renderBrandTheme(refs: Refs, state: UiState): void {
  const effective = resolveTheme(state.brandTheme);
  refs.headerColorInput.value = state.brandTheme.headerBg ?? '';
  refs.accentColorInput.value = state.brandTheme.accent ?? '';
  refs.bodyColorInput.value = state.brandTheme.bodyText ?? '';
  refs.tableheadColorInput.value = state.brandTheme.tableHeadBg ?? '';
  refs.headingFontInput.value = state.brandTheme.headingFont ?? '';
  refs.bodyFontInput.value = state.brandTheme.bodyFont ?? '';
  refs.headerColorSwatch.style.background = effective.headerBg;
  refs.accentColorSwatch.style.background = effective.accent;
  refs.bodyColorSwatch.style.background = effective.bodyText;
  refs.tableheadColorSwatch.style.background = effective.tableHeadBg;
  refs.logoPreview.style.display = state.logoBase64 ? 'inline-block' : 'none';
  refs.clearLogoBtn.style.display = state.logoBase64 ? 'inline-block' : 'none';
  if (state.logoBase64) refs.logoPreview.src = `data:image/png;base64,${state.logoBase64}`;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export type TabId = 'selected' | 'foundations' | 'library' | 'settings';

export function switchTab(refs: Refs, tab: TabId): void {
  const tabs: Array<[TabId, HTMLButtonElement, HTMLElement]> = [
    ['selected', refs.tabSelected, refs.panelSelected],
    ['foundations', refs.tabFoundations, refs.panelFoundations],
    ['library', refs.tabLibrary, refs.panelLibrary],
    ['settings', refs.tabSettings, refs.panelSettings],
  ];
  for (const [id, btn, panel] of tabs) {
    const active = id === tab;
    btn.setAttribute('aria-selected', String(active));
    panel.classList.toggle('active', active);
  }
  syncFooter(refs);
}

// ---------------------------------------------------------------------------
// My Library
// ---------------------------------------------------------------------------

/** Per-doc drift, computed progressively after enumerate. `pending` shows a
 *  "checking" chip; once known it feeds resolveStatus. */
export type DriftState = 'pending' | 'inSync' | 'drifted';

const BADGE: Record<DocStatus, { cls: string; label: string }> = {
  inSync: { cls: 'insync', label: 'In sync' },
  updateAvailable: { cls: 'update', label: 'Update available' },
  edited: { cls: 'edited', label: 'Manually edited' },
  orphaned: { cls: 'orphaned', label: 'Source missing' },
};

/** The status to show. Orphaned needs no drift; otherwise a pending drift keeps
 *  the row in a neutral "checking" state so we never flash a wrong badge. */
function rowStatus(e: LibraryEntry, drift: DriftState | undefined): DocStatus | 'checking' {
  if (!e.sourceExists) return 'orphaned';
  if (drift === undefined || drift === 'pending') return 'checking';
  return resolveStatus({ sourceExists: true, sourceDrifted: drift === 'drifted', selfEdited: e.selfEdited });
}

export function renderLibrary(
  refs: Refs,
  entries: LibraryEntry[],
  drift: Map<string, DriftState>,
): void {
  refs.libraryList.textContent = '';
  refs.libraryEmpty.style.display = entries.length ? 'none' : 'block';

  const updatable = entries.filter((e) => e.sourceExists && drift.get(e.docId) === 'drifted').length;
  refs.librarySummary.textContent = entries.length
    ? `${entries.length} connected ${entries.length === 1 ? 'doc' : 'docs'}${updatable ? ` · ${updatable} to update` : ''}`
    : '';

  for (const e of entries) {
    const st = rowStatus(e, drift.get(e.docId));
    const badge = st === 'checking'
      ? { cls: 'checking', label: 'Checking…' }
      : BADGE[st];

    const row = document.createElement('div');
    row.className = 'lib-row';
    row.dataset.docId = e.docId;
    row.dataset.sourceId = e.sourceNodeId;
    // Row click goes to the doc (wired in ui.ts). The inline "Update" shows only
    // when the doc is out of date; every other action lives in the ⋯ overflow
    // menu. User-controlled strings are set via textContent below, never in this
    // innerHTML; the only interpolated value is the safe-charset node id.
    row.innerHTML = `
      <div class="lib-row-main">
        <div class="lib-row-title"></div>
        <div class="lib-row-sub"><span class="lib-page"></span> <span class="lib-badge ${badge.cls}"></span></div>
      </div>
      ${st === 'updateAvailable' ? `<button class="btn btn-secondary lib-update-inline" data-act="update" data-doc-id="${e.docId}">Update</button>` : ''}
      <button class="lib-menu-btn" data-act="menu" data-doc-id="${e.docId}" aria-label="Actions" aria-haspopup="menu">⋯</button>`;
    (row.querySelector('.lib-row-title') as HTMLElement).textContent = e.label;
    (row.querySelector('.lib-page') as HTMLElement).textContent = e.pageName ? `${e.pageName}` : '';
    (row.querySelector('.lib-badge') as HTMLElement).textContent = badge.label;
    refs.libraryList.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Foundations
// ---------------------------------------------------------------------------

/**
 * Paint the Foundations panel from the pure model in foundationState.ts.
 *
 * Every user-controlled string (collection name, mode name) is set via
 * textContent and never interpolated into innerHTML, matching renderLibrary.
 */
export function renderFoundationPanel(
  refs: Refs,
  summary: FoundationSummary,
  selection: FoundationSelection,
  notes: string[],
  generating: boolean,
): void {
  refs.foundationSummary.textContent = [
    `${summary.collectionCount} ${summary.collectionCount === 1 ? 'collection' : 'collections'}`,
    `${summary.maxModeCount} ${summary.maxModeCount === 1 ? 'mode' : 'modes'}`,
    `${summary.textStyleCount} text styles`,
  ].join(' · ');

  refs.foundationNotes.textContent = '';
  for (const note of notes) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = note;
    refs.foundationNotes.appendChild(p);
  }

  refs.foundationList.textContent = '';

  for (const c of summary.collections) {
    const chosen = selection.collections.find((s) => s.collectionId === c.id);

    const row = document.createElement('div');
    row.className = 'foundation-row';

    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(chosen);
    box.dataset.act = 'toggle-collection';
    box.dataset.collectionId = c.id;
    label.appendChild(box);
    const text = document.createElement('span');
    text.textContent = ` ${c.name} · ${c.variableCount} variables · `
      + `${c.modes.length} ${c.modes.length === 1 ? 'mode' : 'modes'}`;
    label.appendChild(text);
    row.appendChild(label);

    // Mode checkboxes appear only when a collection has more modes than can be
    // rendered, so the user picks which four rather than getting the first four
    // by accident.
    if (c.modes.length > MAX_MODE_COLUMNS) {
      const modes = document.createElement('div');
      modes.className = 'foundation-modes';
      for (const m of c.modes) {
        const ml = document.createElement('label');
        const mb = document.createElement('input');
        mb.type = 'checkbox';
        mb.checked = Boolean(chosen?.modeIds.includes(m.modeId));
        mb.disabled = !chosen;
        mb.dataset.act = 'toggle-mode';
        mb.dataset.collectionId = c.id;
        mb.dataset.modeId = m.modeId;
        ml.appendChild(mb);
        const mt = document.createElement('span');
        mt.textContent = ` ${m.name}`;
        ml.appendChild(mt);
        modes.appendChild(ml);
      }
      const cap = document.createElement('p');
      cap.className = 'muted';
      cap.textContent = 'Showing 4 modes. Uncheck one to swap in another.';
      modes.appendChild(cap);
      row.appendChild(modes);
    }

    refs.foundationList.appendChild(row);
  }

  if (summary.textStyleCount > 0) {
    const row = document.createElement('div');
    row.className = 'foundation-row';
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = selection.textStyles;
    box.dataset.act = 'toggle-text-styles';
    label.appendChild(box);
    const text = document.createElement('span');
    text.textContent = ` Text styles · ${summary.textStyleCount} styles`;
    label.appendChild(text);
    row.appendChild(label);
    refs.foundationList.appendChild(row);
  }

  // Disabled while a generation is in flight, regardless of what repaints in
  // the meantime (e.g. a checkbox toggle) — otherwise the button re-enables
  // mid-generation since every repaint recomputes this from the current
  // selection alone. The main thread's `foundationRendering` guard still backs
  // this up as defence in depth.
  refs.foundationCreate.disabled = generating || !canGenerate(selection);
}
