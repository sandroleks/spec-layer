/**
 * ui.ts — thin entry point for the plugin iframe.
 *
 * Responsibilities only: mount the DOM, build the UI state, wire DOM events to
 * the action handlers, run the window.onmessage switch (delegating to
 * render/actions), and boot by requesting the initial selection.
 *
 * All markup/styles live in dom.ts, all logic in actions.ts, all view updates
 * in render.ts.
 */

import { extract, specContentHash } from '@spec-layer/extractor';
import type { MainToUi, LibraryEntry } from '../messages';
import type { DocConfig } from '../docLink';
import type { MeasureView } from './docModel';
import { ALL_SECTIONS, GROUPS } from './docModel';
import { mount } from './dom';
import {
  createState,
  send,
  runExtract,
  runDownload,
  runCreateDocFrame,
  runAutoExtract,
  runUpdateFromSource,
  runDownloadFromSource,
  setLicenseKey,
  setAiEnabled,
  setBrandTheme,
  onFoundationMessage,
  onFoundationCheckboxChange,
  currentFoundationSelection,
  setFoundationGenerating,
} from './actions';
import {
  activateLicense, deactivateLicense, fetchQuota, effectiveAuth, activationErrorCopy,
  isQuotaExhausted, CHECKOUT_URL, MANAGE_SUB_URL, STOREFRONT_URL, SITE_URL, LINKEDIN_URL,
} from './proxy';
import { resolveComponentImage } from './ai';
import { parseBrandHex, emptyBrandTheme, THEME_PRESETS, matchPreset } from '../brandColors';
import { createFontPicker } from './fontPicker';
import { applyThemeMode, toggleThemeMode, detectFigmaTheme, type ThemeMode } from './theme';
import {
  renderSelection,
  renderVariantPicker,
  renderStatesHint,
  renderBrandTheme,
  renderQuota,
  renderLicense,
  updateVariantCount,
  switchTab,
  clearBanners,
  showBanner,
  stopLoader,
  renderLibrary,
  type DriftState,
} from './render';

// ---------------------------------------------------------------------------
// Mount + state
// ---------------------------------------------------------------------------

const refs = mount();
const state = createState();

// ---------------------------------------------------------------------------
// Quota — fetched whenever identity changes (license key or Figma user id
// arriving via the 'licenseKey'/'userInfo' messages) and re-rendered after
// each generation attempt so the meter/upsell always reflect the latest quota.
// ---------------------------------------------------------------------------

// Monotonic token guarding against stale overwrites. On boot the `userInfo` and
// `licenseKey` messages each kick off a refresh; `userInfo` arrives first (it's
// posted synchronously, while `licenseKey` waits on clientStorage), so its probe
// runs against the *free* Figma identity before the key is known. Without this
// guard, if that free probe resolves last it clobbers the Pro quota and the
// demotion branch below flips an active key to "not activated". Only the latest
// refresh is allowed to commit.
let quotaSeq = 0;

async function refreshQuota(): Promise<void> {
  const seq = ++quotaSeq;
  let quota = await fetchQuota(effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, state.licenseActive));
  let nextActive = state.licenseActive;
  // Learn the key's real standing from the probe. Only a DEFINITE non-pro
  // verdict demotes the key; licenseReason 'unreachable' (and a null quota)
  // teach us nothing and leave the key in place for the next attempt.
  if (state.licenseKey && state.licenseActive !== false && quota) {
    if (quota.tier === 'pro') {
      nextActive = true;
    } else if (quota.licenseReason !== 'unreachable') {
      const reason = quota.licenseReason;
      nextActive = false;
      const free = await fetchQuota(effectiveAuth(state.licenseKey, state.licenseInstanceId, state.figmaUserId, false));
      // Keep the demotion reason either way. If there's no free identity to fall
      // back on (no Figma user id, so the free probe returns null), synthesize a
      // free quota carrying the reason so the license view still resolves to
      // `inactive` (Renew for an expired key) instead of the ambiguous
      // "Your Pro key is saved." — see B8. The 0-left meter is accurate: with no
      // free identity the user has no usable generations until they renew.
      quota = free
        ? { ...free, licenseReason: reason }
        : { tier: 'free', used: 0, limit: null, remaining: null, resetsAt: '', licenseReason: reason };
    }
  }
  // A newer refresh started while we awaited — its result supersedes ours, so
  // drop this one rather than racing it to the last write.
  if (seq !== quotaSeq) return;
  state.quota = quota;
  state.licenseActive = nextActive;
  // Reconcile the optimistic exhaustion flag (set when a generation returns
  // quota_exhausted) with the authoritative quota. Activating Pro or a monthly
  // reset refills the allowance; without this the upsell fork would strand a
  // user who is no longer out of generations. Only a definite quota clears it;
  // a null (offline) quota leaves the flag as-is.
  if (state.quota && !isQuotaExhausted(state.quota)) state.quotaExhausted = false;
  renderLicense(refs, state);
  renderQuota(refs, state);
}

// ---------------------------------------------------------------------------
// Theme switcher — light ↔ dark. Initial mode is detected from Figma's host
// theme synchronously (so the first paint is correct, no flash), and the button
// toggles it for the session. While the user hasn't overridden, a MutationObserver
// keeps us in sync if they change Figma's theme with the plugin open.
// ---------------------------------------------------------------------------

let themeMode: ThemeMode = detectFigmaTheme();
let themeOverridden = false;
applyThemeMode(refs.themeBtn, themeMode);

refs.themeBtn.addEventListener('click', () => {
  themeMode = toggleThemeMode(themeMode);
  themeOverridden = true;
  applyThemeMode(refs.themeBtn, themeMode);
});

new MutationObserver(() => {
  if (themeOverridden) return;
  const next = detectFigmaTheme();
  if (next !== themeMode) {
    themeMode = next;
    applyThemeMode(refs.themeBtn, themeMode);
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

refs.tabSelected.addEventListener('click', () => switchTab(refs, 'selected'));
refs.tabSettings.addEventListener('click', () => switchTab(refs, 'settings'));
refs.tabLibrary.addEventListener('click', () => {
  switchTab(refs, 'library');
  refreshLibrary();
});
refs.tabFoundations.addEventListener('click', () => {
  switchTab(refs, 'foundations');
  requestFoundationOnce();
});

// ---------------------------------------------------------------------------
// My Library
// ---------------------------------------------------------------------------

let libEntries: LibraryEntry[] = [];
const libDrift = new Map<string, DriftState>();
// docId → storedContentHash, so a driftSource reply can compare without a lookup.
const libBaseline = new Map<string, string>();
// The docId the shared overflow menu is currently open for (null = closed). The
// menu is one element outside the list, so a drift re-render never disturbs it.
let libMenuDocId: string | null = null;
// The docId a .md download is in flight for (null = none). Blocks a second
// Download from stacking; cleared when the docSource reply resolves or errors.
let downloadingDocId: string | null = null;
// The docId a foundation row's Update is in flight for (null = none). A
// foundation row has no source node, so its Update skips requestDocSource and
// goes straight to updateFoundationDoc, which replies on the same
// foundationDone message the Foundations tab's bulk build uses — this is how
// the foundationDone handler tells the two apart and re-enables createFrameBtn
// only for the row-update path (the bulk path re-enables its own button).
let updatingFoundationDocId: string | null = null;

function refreshLibrary(): void {
  closeRowMenu();
  send({ type: 'requestLibrary' });
}

/** Kick off a drift check for every doc whose source still exists. Foundation
 *  rows are resolved already, server-side, from a single live extraction
 *  (Task 13) — reuse that instead of sending a requestDrift that would never
 *  get a reply. */
function startDriftChecks(): void {
  libDrift.clear();
  libBaseline.clear();
  for (const e of libEntries) {
    if (!e.sourceExists) continue;
    if (e.kind === 'foundation') {
      // No live hash means extraction failed. The honest answer is "we do not
      // know", which must render as not-drifted rather than as an update we
      // never actually verified.
      const drifted = e.currentContentHash !== undefined && e.currentContentHash !== e.storedContentHash;
      libDrift.set(e.docId, drifted ? 'drifted' : 'inSync');
      continue;
    }
    libDrift.set(e.docId, 'pending');
    libBaseline.set(e.docId, e.storedContentHash);
    send({ type: 'requestDrift', docId: e.docId, sourceNodeId: e.sourceNodeId });
  }
}

function closeRowMenu(): void {
  refs.libraryMenu.hidden = true;
  libMenuDocId = null;
}

/** Open (or move) the shared overflow menu, anchored under the clicked ⋯. Menu
 *  contents depend on state: an orphan (missing source) can only be detached or
 *  removed. Remove sits below a divider as the one destructive action. */
function openRowMenu(docId: string, anchor: HTMLElement): void {
  const entry = libEntries.find((e) => e.docId === docId);
  if (!entry) return;
  const items: string[] = [];
  if (entry.sourceExists) {
    // A foundation row has no source node (sourceNodeId is always ''), so
    // "Go to source" would just fail to find anything, and there is no
    // markdown renderer yet for a foundation doc, so "Download .md" would just
    // fail with a confusing "no longer linked" error — both are component-only
    // until that renderer exists.
    const isComponent = entry.kind === 'component';
    if (isComponent) {
      items.push(`<button role="menuitem" data-act="source" data-doc-id="${docId}">Go to source</button>`);
    }
    items.push(`<button role="menuitem" data-act="update" data-doc-id="${docId}">Update</button>`);
    if (isComponent) {
      items.push(`<button role="menuitem" data-act="download" data-doc-id="${docId}">Download .md</button>`);
    }
  }
  items.push(`<button role="menuitem" data-act="detach" data-doc-id="${docId}">Detach</button>`);
  items.push('<hr>');
  items.push(`<button role="menuitem" class="danger" data-act="remove" data-doc-id="${docId}">Remove</button>`);
  refs.libraryMenu.innerHTML = items.join('');

  // Unhide first so height is measurable, then flip above the anchor if opening
  // below would overflow the plugin window. Right-aligned under the ⋯.
  refs.libraryMenu.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const menuH = refs.libraryMenu.offsetHeight;
  const below = rect.bottom + 4;
  const top = below + menuH > window.innerHeight ? Math.max(4, rect.top - 4 - menuH) : below;
  refs.libraryMenu.style.top = `${top}px`;
  refs.libraryMenu.style.right = `${Math.max(4, window.innerWidth - rect.right)}px`;
  libMenuDocId = docId;
}

/** Run a row action. Shared by the inline Update button and the menu items. */
function runRowAction(act: string, docId: string): void {
  const entry = libEntries.find((e) => e.docId === docId);
  switch (act) {
    case 'source': if (entry) send({ type: 'focusNode', nodeId: entry.sourceNodeId }); break;
    case 'update': {
      // One renderDocFrame build may be in flight at a time (main's remove->append
      // is non-atomic). Reuse the create-frame lock so this also blocks
      // Update-while-Create and Create-while-Update across tabs.
      if (refs.createFrameBtn.disabled) return;
      if (entry?.selfEdited && !confirm('You edited this frame by hand. Updating replaces those edits.')) return;
      refs.createFrameBtn.disabled = true;
      // A foundation row has no source node to ask requestDocSource for — it
      // rebuilds straight from the file's current collections/text styles, so
      // it posts updateFoundationDoc instead (routed by kind, not by intent).
      if (entry?.kind === 'foundation') {
        updatingFoundationDocId = docId;
        send({ type: 'updateFoundationDoc', docId });
      } else {
        send({ type: 'requestDocSource', docId, intent: 'update' });
      }
      break;
    }
    case 'download': {
      // Download re-extracts the source (like Update) but writes a .md instead
      // of rebuilding the frame. It never mutates the canvas, so no confirm and
      // no create-frame lock — just guard against stacking downloads.
      if (downloadingDocId) return;
      downloadingDocId = docId;
      send({ type: 'requestDocSource', docId, intent: 'download' });
      break;
    }
    case 'detach':
      if (confirm('Detach this doc? It stays on the canvas as a plain frame and stops tracking its component.')) send({ type: 'detachDoc', docId });
      break;
    case 'remove':
      if (confirm('Remove this doc? This deletes the frame from the canvas.')) send({ type: 'removeDoc', docId });
      break;
  }
}

// List interactions: row body → go to doc; inline Update → update; ⋯ → toggle menu.
refs.libraryList.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  const btn = t.closest('button') as HTMLButtonElement | null;
  if (!btn) {
    const row = t.closest('.lib-row') as HTMLElement | null;
    if (row?.dataset.docId) send({ type: 'focusNode', nodeId: row.dataset.docId });
    return;
  }
  const docId = btn.dataset.docId;
  if (!docId) return;
  if (btn.dataset.act === 'menu') {
    if (libMenuDocId === docId) closeRowMenu();
    else openRowMenu(docId, btn);
    return;
  }
  runRowAction(btn.dataset.act ?? '', docId);
});

// Menu item click: dispatch then close.
refs.libraryMenu.addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest('button') as HTMLButtonElement | null;
  if (!btn?.dataset.docId) return;
  const act = btn.dataset.act ?? '';
  const docId = btn.dataset.docId;
  closeRowMenu();
  runRowAction(act, docId);
});

// Dismiss the menu on outside click, Escape, or scroll (the anchor moves).
document.addEventListener('click', (ev) => {
  if (libMenuDocId === null) return;
  const t = ev.target as HTMLElement;
  if (t.closest('#lib-menu') || t.closest('.lib-menu-btn')) return;
  closeRowMenu();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && libMenuDocId !== null) closeRowMenu();
});
window.addEventListener('scroll', () => { if (libMenuDocId !== null) closeRowMenu(); }, true);

// ---------------------------------------------------------------------------
// Foundations
// ---------------------------------------------------------------------------

// Unlike My Library (which re-fetches on every activation because canvas docs
// can change at any time), the foundation dump is requested once per session:
// re-fetching would also reset the user's in-progress collection/mode
// selection back to defaultSelection on every tab switch.
let foundationRequested = false;

function requestFoundationOnce(): void {
  if (foundationRequested) return;
  foundationRequested = true;
  send({ type: 'requestFoundation' });
}

// Collection/mode/text-style checkboxes are built dynamically in
// renderFoundationPanel, so delegate the change listener like the variant list.
refs.foundationList.addEventListener('change', (ev) => {
  const target = ev.target as HTMLElement;
  if (target instanceof HTMLInputElement) onFoundationCheckboxChange(refs, target);
});

// Disabled while a generation is in flight (mirrors createFrameBtn/
// docFrameRendering), via the module-level `generating` flag in actions.ts so
// it survives repaints triggered by checkbox toggles mid-generation. Cleared
// by the foundationDone/foundationFrameError handlers below, on both the
// success and error paths.
refs.foundationCreate.addEventListener('click', () => {
  if (refs.foundationCreate.disabled) return;
  setFoundationGenerating(refs, true);
  send({
    type: 'renderFoundation',
    selection: currentFoundationSelection(),
    // includeDescriptions is hardcoded true: v1 has no descriptions checkbox in
    // the tab, and buildFoundationFrame already suppresses the column when no
    // row has one. aiNotes stays false until phase 6.
    config: { includeDescriptions: true, aiNotes: false },
  });
});

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------

refs.extractBtn.addEventListener('click', () => {
  runExtract(refs, state).catch(() => { /* handled inside */ });
});
refs.createFrameBtn.addEventListener('click', () => {
  runCreateDocFrame(refs, state)
    .catch(() => { /* handled inside */ })
    .finally(() => renderQuota(refs, state));
});

/** Re-run the create-frame flow with AI off, without touching the persisted
 *  "Write with AI" preference — used by the upsell's "Continue without AI".
 *  aiEnabled is flipped off only for the duration of this call (never sent to
 *  main via setAiEnabled) so canGenerate/willGenerateProse skip generation and
 *  ensureProse is a no-op, falling straight through to placeholder sections. */
async function runCreateWithoutAi(): Promise<void> {
  const wasEnabled = state.aiEnabled;
  state.aiEnabled = false;
  // Guard against dispatching a second frame build while one is in flight —
  // main.ts's remove-then-append of the doc section isn't atomic across two
  // concurrent renderDocFrame messages (duplicate sections on canvas).
  refs.upsellContinueBtn.disabled = true;
  refs.upsellUpgradeBtn.disabled = true;
  try {
    await runCreateDocFrame(refs, state);
  } catch {
    /* handled inside — mirrors the createFrameBtn listener */
  } finally {
    state.aiEnabled = wasEnabled;
    refs.upsellContinueBtn.disabled = false;
    refs.upsellUpgradeBtn.disabled = false;
    renderQuota(refs, state);
  }
}

refs.upsellUpgradeBtn.addEventListener('click', () => {
  send({ type: 'openBrowser', url: CHECKOUT_URL });
});
refs.upsellContinueBtn.addEventListener('click', () => {
  // The create button's disabled flag is the in-flight signal (cleared by
  // docFrameDone/docFrameError) — never race a build that is still placing.
  if (refs.createFrameBtn.disabled) return;
  state.quotaExhausted = false;
  renderQuota(refs, state);
  void runCreateWithoutAi();
});

// ---------------------------------------------------------------------------
// Download (local .md — same doc as the frame)
// ---------------------------------------------------------------------------

refs.downloadBtn.addEventListener('click', () => {
  // Download may generate prose (same prep as Create frame), so refresh the
  // quota meter/upsell when it settles, like the other AI-touching actions.
  runDownload(refs, state).finally(() => renderQuota(refs, state));
});
refs.licenseActivateBtn.addEventListener('click', async () => {
  const key = refs.licenseKeyInput.value.trim();
  if (!key || refs.licenseActivateBtn.disabled) return;
  // In-flight guard: a double click (or Enter twice) on a first-time
  // activation would register two LS device instances and burn two slots.
  refs.licenseActivateBtn.disabled = true;
  refs.licenseStatus.textContent = 'Checking…';
  refs.licenseRenewRow.hidden = true;
  try {
    // A stored instance id belongs to the stored key. If the user pasted a
    // different key, start fresh instead of validating a mismatched pair.
    const knownInstance = key === state.licenseKey ? state.licenseInstanceId : null;
    let out = await activateLicense(key, knownInstance);
    // A stored instance id can go stale (deactivated in the dashboard, or an
    // older build). If revalidating it fails, register a fresh instance.
    if (!out.valid && knownInstance) {
      out = await activateLicense(key, null);
    }
    if (out.valid && out.status === 'active') {
      state.licenseActive = true;
      setLicenseKey(state, key, out.instanceId ?? knownInstance);
      // The main thread only persists the key (no licenseKey echo back), so
      // refresh the toggle affordance here or a stale "no identity" hint lingers.
      reflectAiToggle();
      // Confirm immediately; refreshQuota repaints from the live quota after.
      refs.licenseStatus.textContent = 'Pro plan active ✓';
      await refreshQuota();
    } else if (out.status === 'active') {
      // Valid, active key that couldn't be activated here: almost always the
      // per-key device limit is full, not a bad key.
      refs.licenseStatus.textContent = "This key is active but couldn't be activated on this device. It may have reached its device limit. Free up a device in Manage subscription, or reach out to support.";
    } else {
      // Differentiated by the raw LS status: expired → renew, disabled →
      // support, anything else → wrong key. No raw code leaks to the user.
      refs.licenseStatus.textContent = activationErrorCopy(out.status);
      // This failure path doesn't refresh the quota-derived license view, so
      // surface the Renew link directly for an expired subscription.
      refs.licenseRenewRow.hidden = out.status !== 'expired';
    }
  } catch {
    refs.licenseStatus.textContent = "Couldn't reach the license server. Give it another go in a minute.";
  } finally {
    refs.licenseActivateBtn.disabled = false;
  }
  renderQuota(refs, state);
});
refs.licenseKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') refs.licenseActivateBtn.click();
});

// Best-effort: free the LS device slot. Local removal happens regardless, so a
// network failure only means the slot stays used until the dashboard.
refs.removeKeyLink.addEventListener('click', async (e) => {
  e.preventDefault();
  refs.licenseStatus.textContent = 'Removing…';
  if (state.licenseKey && state.licenseInstanceId) {
    await deactivateLicense(state.licenseKey, state.licenseInstanceId);
  }
  setLicenseKey(state, '', null);
  state.licenseActive = null;
  refs.licenseKeyInput.value = '';
  refs.licenseStatus.textContent = 'Key removed from this device.';
  refs.licenseRemoveRow.hidden = true;
  reflectAiToggle();
  await refreshQuota();
});

// ---------------------------------------------------------------------------
// Write-with-AI toggle + section select-all
// ---------------------------------------------------------------------------

/** Sync the AI switch and the dimmed-badge state to the current preference.
 *  Free tier needs no key, so the switch is never gated on one. */
function reflectAiToggle(): void {
  refs.aiToggle.checked = state.aiEnabled;
  // Free tier needs no key: the old "no key" blocker is gone. The hint
  // element stays for the edge case of a missing Figma user id.
  const noIdentity = !state.licenseKey && !state.figmaUserId;
  refs.aiNokey.style.display = state.aiEnabled && noIdentity ? '' : 'none';
  refs.sectionList.classList.toggle('ai-dim', !state.aiEnabled);
  renderQuota(refs, state);
}

refs.aiToggle.addEventListener('change', () => {
  setAiEnabled(state, refs.aiToggle.checked);
  reflectAiToggle();
});

// Quota-meter Upgrade link → checkout (same destination as the footer upsell).
refs.quotaUpgrade.addEventListener('click', () => {
  send({ type: 'openBrowser', url: CHECKOUT_URL });
});

// "Activate license" → Settings, where the license key is entered. Focus the
// input so the user lands ready to paste.
refs.quotaActivate.addEventListener('click', () => {
  switchTab(refs, 'settings');
  refs.licenseKeyInput.focus();
});

// Manage-subscription link opens the billing portal via figma.openExternal.
document.getElementById('manage-sub-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  send({ type: 'openBrowser', url: MANAGE_SUB_URL });
});

// Renew link (shown only in the lapsed state) opens the store to repurchase.
document.getElementById('renew-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  send({ type: 'openBrowser', url: STOREFRONT_URL });
});

// Get Pro link (shown only to a free, keyless user) opens the store to buy.
document.getElementById('get-pro-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  send({ type: 'openBrowser', url: STOREFRONT_URL });
});

// Tab-bar icons: website + author LinkedIn. Anchors don't navigate inside the
// plugin iframe, so route through openBrowser like every other external link.
document.getElementById('site-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  send({ type: 'openBrowser', url: SITE_URL });
});
document.getElementById('linkedin-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  send({ type: 'openBrowser', url: LINKEDIN_URL });
});

refs.selectAllBtn.addEventListener('click', () => {
  const checks = Object.values(refs.sectionChecks);
  const allOn = checks.every((c) => c.checked);
  for (const c of checks) {
    if (c.checked === allOn) {
      c.checked = !allOn;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  syncSelectAllLabel();
  syncAllGroups();
});

// ---- Group masters (tri-state) + collapse ----
function sectionsInGroup(groupId: string): HTMLInputElement[] {
  return ALL_SECTIONS
    .filter((s) => s.group === groupId)
    .map((s) => refs.sectionChecks[s.id])
    .filter(Boolean) as HTMLInputElement[];
}

function syncGroup(groupId: string): void {
  const kids = sectionsInGroup(groupId);
  const on = kids.filter((c) => c.checked).length;
  const master = refs.groupChecks[groupId];
  if (master) {
    master.checked = on === kids.length && on > 0;
    master.indeterminate = on > 0 && on < kids.length;
  }
  const count = refs.groupCounts[groupId];
  if (count) count.textContent = `${on}/${kids.length}`;
}

function syncAllGroups(): void {
  for (const g of GROUPS) syncGroup(g.id);
}

// The Select-all button toggles between "select all" and "clear all". Its label
// must reflect the LIVE checkbox state: "Clear all" only when every section is
// on, "Select all" otherwise (including the mixed default). Computed here rather
// than hardcoded so the first click never does the opposite of its label.
function syncSelectAllLabel(): void {
  const checks = Object.values(refs.sectionChecks);
  const allOn = checks.length > 0 && checks.every((c) => c.checked);
  refs.selectAllBtn.textContent = allOn ? 'Clear all' : 'Select all';
}

for (const g of GROUPS) {
  const master = refs.groupChecks[g.id];
  master?.addEventListener('change', () => {
    for (const c of sectionsInGroup(g.id)) {
      if (c.checked !== master.checked) {
        c.checked = master.checked;
        c.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    syncGroup(g.id);
  });

  // Collapse on header click, except when the click lands on the master checkbox.
  const head = refs.groupContainers[g.id]?.querySelector('.sec-grouphead');
  head?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.group-check')) return;
    refs.groupContainers[g.id]?.classList.toggle('collapsed');
  });
}

// Any section checkbox change re-syncs its group's master + count.
refs.sectionList.addEventListener('change', (e) => {
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement && t.id.startsWith('sec-')) syncAllGroups();
});

syncAllGroups(); // initial state
syncSelectAllLabel(); // initial label must match the mixed default, not a hardcode

// Toggling the Tokens section re-renders the variant card's gated state
// (mutes it + collapses the body when Tokens is off; see renderVariantPicker).
refs.sectionChecks['tokens']?.addEventListener('change', () => renderVariantPicker(refs, state));

// Variant card header: toggles the body open/closed, mirrored to aria-expanded.
refs.variantToggle.addEventListener('click', () => {
  const open = refs.variantBody.hidden;
  refs.variantBody.hidden = !open;
  refs.variantToggle.setAttribute('aria-expanded', String(open));
});

// Hint link only appears while Tokens is off (renderVariantPicker); clicking it
// turns Tokens on and re-renders the card, which un-gates + restores the hint.
refs.variantHint.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.vp-hint-link')) return;
  const tokensCheck = refs.sectionChecks['tokens'];
  if (!tokensCheck) return;
  tokensCheck.checked = true;
  renderVariantPicker(refs, state);
});

// Toggling the Anatomy section shows/hides the diagram/table/both view toggle.
// Initialize visibility to match the checkbox's default-checked state.
refs.anatomyView.style.display = refs.sectionChecks['anatomy']?.checked ? 'flex' : 'none';
refs.sectionChecks['anatomy']?.addEventListener('change', () => {
  const checked = refs.sectionChecks['anatomy']?.checked ?? false;
  refs.anatomyView.style.display = checked ? 'flex' : 'none';
  refs.sectionChecks['anatomy']?.setAttribute('aria-expanded', String(checked));
});

// Anatomy view radios: reflect the selected mode onto state.
refs.anatomyView.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  if (target.name !== 'anatomy-view') return;
  state.anatomyView = target.value as 'diagram' | 'table' | 'both';
});

// Toggling the Measurements section shows/hides the measure-setup lens row.
// Initialize visibility to match the checkbox's default-checked state.
refs.measureSetup.style.display = refs.sectionChecks['measurements']?.checked ? 'flex' : 'none';
refs.sectionChecks['measurements']?.addEventListener('change', () => {
  const checked = refs.sectionChecks['measurements']?.checked ?? false;
  refs.measureSetup.style.display = checked ? 'flex' : 'none';
  refs.sectionChecks['measurements']?.setAttribute('aria-expanded', String(checked));
});

// Measure lens checkboxes: rebuild state.measureViews from the checked boxes,
// preserving the canonical size→padding→spacing order regardless of click order.
refs.measureSetup.addEventListener('change', (e) => {
  const target = e.target as HTMLInputElement;
  if (target.name !== 'measure-view') return;
  const checked = new Set(
    Array.from(refs.measureSetup.querySelectorAll<HTMLInputElement>('input[name="measure-view"]:checked'))
      .map((el) => el.value),
  );
  state.measureViews = (['size', 'padding', 'spacing'] as MeasureView[]).filter((v) => checked.has(v));
});

refs.variantSelectAll.addEventListener('click', () => {
  const checks = Array.from(refs.variantList.querySelectorAll('input')) as HTMLInputElement[];
  const allOn = checks.length > 0 && checks.every((c) => c.checked);
  for (const c of checks) c.checked = !allOn;
  refs.variantSelectAll.textContent = allOn ? 'Select all' : 'Clear all';
  updateVariantCount(refs);
});

// Per-row toggles (rows are built dynamically, so delegate) keep the count live.
refs.variantList.addEventListener('change', () => updateVariantCount(refs));

// ---------------------------------------------------------------------------
// Frame brand theme (Settings)
// ---------------------------------------------------------------------------

// Custom mode is a UI-only intent (not persisted): true when the user is
// editing their own theme, false when a preset is selected. It drives which
// preset card is active and whether the color/font controls are shown. On boot
// it is inferred from whether the stored theme matches a preset.
let customMode = false;

/**
 * Paint the theme fields, then reflect the current mode: highlight exactly one
 * preset card (the matching preset, or Custom in custom mode) and show the
 * color/font controls only in custom mode. The logo section lives outside the
 * controls container, so it stays visible in every mode.
 */
function renderTheme(): void {
  renderBrandTheme(refs, state);
  const activeName = customMode ? '__custom__' : (matchPreset(state.brandTheme) ?? '__custom__');
  refs.presetRow.querySelectorAll<HTMLElement>('.preset-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.preset === activeName);
  });
  refs.customizeControls.hidden = !customMode;
}

/**
 * Apply a typed hex value to one theme color field. Empty input clears the
 * override (back to default); an invalid hex shows a hint and is NOT persisted
 * (the swatch keeps its last valid value). A valid hex is normalized + stored.
 */
function applyBrandColor(
  field: 'headerBg' | 'accent' | 'bodyText' | 'tableHeadBg',
  raw: string,
): void {
  const trimmed = raw.trim();
  if (trimmed) {
    const parsed = parseBrandHex(trimmed);
    if (!parsed) {
      refs.brandColorHint.textContent = 'Enter a 6-digit hex color, e.g. #0d2436.';
      return;
    }
    refs.brandColorHint.textContent = '';
    setBrandTheme(state, { ...state.brandTheme, [field]: parsed });
  } else {
    refs.brandColorHint.textContent = '';
    setBrandTheme(state, { ...state.brandTheme, [field]: null });
  }
  renderTheme();
}

refs.headerColorInput.addEventListener('change', () =>
  applyBrandColor('headerBg', refs.headerColorInput.value),
);
refs.accentColorInput.addEventListener('change', () =>
  applyBrandColor('accent', refs.accentColorInput.value),
);
refs.bodyColorInput.addEventListener('change', () =>
  applyBrandColor('bodyText', refs.bodyColorInput.value),
);
refs.tableheadColorInput.addEventListener('change', () =>
  applyBrandColor('tableHeadBg', refs.tableheadColorInput.value),
);
refs.resetColorsLink.addEventListener('click', () => {
  refs.brandColorHint.textContent = '';
  refs.fontFallbackHint.textContent = '';
  setBrandTheme(state, emptyBrandTheme());
  // Stay in custom mode: this clears the user's edits back to the default
  // palette while they keep customizing (it does not re-select a preset).
  renderTheme();
});

// Compatible families from the main thread; empty until (unless) it arrives.
let fontFamilies: string[] = [];

/**
 * Apply a committed font family (empty → default). A free-typed family that
 * is not in the compatible list still commits, but gets a fallback warning
 * since the build will revert it to Inter if styles are missing.
 */
function applyBrandFont(field: 'headingFont' | 'bodyFont', raw: string): void {
  const trimmed = raw.trim();
  setBrandTheme(state, { ...state.brandTheme, [field]: trimmed || null });
  const unknown =
    trimmed !== '' && trimmed !== 'Inter' &&
    fontFamilies.length > 0 && !fontFamilies.includes(trimmed);
  refs.fontFallbackHint.textContent = unknown
    ? 'Figma does not list Regular, Medium, and Bold styles for this font. The frame will fall back to Inter.'
    : '';
  renderTheme();
}

const headingFontPicker = createFontPicker({
  root: refs.headingFontPicker,
  onCommit: (value) => applyBrandFont('headingFont', value),
});
const bodyFontPicker = createFontPicker({
  root: refs.bodyFontPicker,
  onCommit: (value) => applyBrandFont('bodyFont', value),
});

// Preset cards (injected in mount()): clicking a preset applies a CLONE of its
// theme and hides the controls; clicking Custom reveals the controls without
// changing values, so the user edits from whatever was last active.
refs.presetRow.addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest('.preset-card') as HTMLElement | null;
  if (!card) return;
  refs.brandColorHint.textContent = '';
  refs.fontFallbackHint.textContent = '';
  if (card.dataset.preset === '__custom__') {
    customMode = true;
    renderTheme();
    return;
  }
  const preset = THEME_PRESETS.find((p) => p.name === card.dataset.preset);
  if (!preset) return;
  customMode = false;
  setBrandTheme(state, { ...preset.theme });
  renderTheme();
});

// Logo capture/clear — the main thread exports the current canvas selection
// and answers with logoCaptured / logoCleared / logoError. Errors surface in the
// Settings-local hint (the footer banner is hidden on the Settings tab), which
// clears when a new attempt starts or a capture/clear succeeds.
refs.captureLogoBtn.addEventListener('click', () => {
  refs.logoErrorHint.textContent = '';
  send({ type: 'captureLogo' });
});
refs.clearLogoBtn.addEventListener('click', () => {
  refs.logoErrorHint.textContent = '';
  send({ type: 'clearLogo' });
});

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as MainToUi | undefined;
  if (!msg) return;

  switch (msg.type) {
    case 'selection': {
      state.currentNode = msg.node;
      // msg.fileKey is the file key computed by main; embedded in the spec.
      state.currentFileKey = msg.fileKey;
      state.currentSpec = null;
      state.currentExtractedAt = '';
      state.phase = 'idle';
      state.renderedMd = '';
      // Clear AI prose too: it belongs to the previous component. Without this,
      // generating prose for A then selecting B would pair B's spec with A's prose.
      state.generatedProse = null;
      state.generatedProseKeys = null;
      stopLoader(refs);
      renderSelection(refs, state);
      // Extract right away so Download and the frame are always ready;
      // once the spec is in, (re)populate the per-variant picker.
      runAutoExtract(refs, state, () => {
        renderVariantPicker(refs, state);
        renderStatesHint(refs, state);
        // renderStatesHint can force the States checkbox on/off programmatically,
        // which fires no change event, so re-sync the group masters/counts and
        // the Select-all label to match the new checkbox state.
        syncAllGroups();
        syncSelectAllLabel();
      });
      break;
    }

    case 'licenseKey': {
      state.licenseKey = msg.value;
      state.licenseInstanceId = msg.instanceId;
      // Re-probe the key this session — a renewal (or lapse) since last open is
      // discovered by refreshQuota rather than trusting a persisted verdict.
      state.licenseActive = null;
      refs.licenseKeyInput.value = msg.value ?? '';
      renderLicense(refs, state); // immediate paint (unknown → "Your Pro key is saved.")
      reflectAiToggle();
      void refreshQuota();
      break;
    }

    case 'userInfo': {
      state.figmaUserId = msg.userId;
      reflectAiToggle();
      void refreshQuota();
      break;
    }

    case 'aiEnabled': {
      state.aiEnabled = msg.value;
      reflectAiToggle();
      break;
    }

    case 'brandTheme': {
      state.brandTheme = msg.value;
      // Infer the mode from the stored theme: a value that matches no preset
      // means the user had customized, so open in custom mode with controls shown.
      customMode = matchPreset(msg.value) === null;
      renderTheme();
      break;
    }

    case 'fontList': {
      fontFamilies = msg.families;
      headingFontPicker.setFamilies(fontFamilies);
      bodyFontPicker.setFamilies(fontFamilies);
      break;
    }

    case 'logoCaptured': {
      state.logoBase64 = msg.base64;
      refs.logoErrorHint.textContent = '';
      renderTheme();
      break;
    }

    case 'logoCleared': {
      state.logoBase64 = null;
      refs.logoErrorHint.textContent = '';
      renderTheme();
      break;
    }

    case 'logoError': {
      // Settings-local surface: the footer error banner is hidden while the
      // Settings tab is active (syncFooter), which is where capture happens.
      refs.logoErrorHint.textContent = msg.message;
      break;
    }


    case 'componentImage': {
      resolveComponentImage({ base64: msg.base64, mediaType: msg.mediaType });
      break;
    }

    case 'componentImageError': {
      // Fail open → generation proceeds text-only.
      resolveComponentImage(null);
      break;
    }

    case 'docFrameDone': {
      stopLoader(refs);
      const note = state.pendingAiNote ? `. ${state.pendingAiNote}` : '';
      const verb = msg.replaced ? 'Updated' : 'Created';
      showBanner(refs, state.pendingAiNote ? 'error' : 'info', `${verb} ${msg.frameName}${note}`);
      state.pendingAiNote = '';
      refs.createFrameBtn.disabled = false;
      if (refs.panelLibrary.classList.contains('active')) refreshLibrary();
      break;
    }

    case 'docFrameError': {
      stopLoader(refs);
      showBanner(refs, 'error', `Frame failed: ${msg.message}`);
      refs.createFrameBtn.disabled = false;
      break;
    }

    case 'foundation': {
      onFoundationMessage(refs, msg.dump);
      break;
    }

    case 'foundationError': {
      refs.foundationNotes.textContent = msg.message;
      break;
    }

    case 'foundationProgress': {
      refs.foundationNotes.textContent = `Creating ${msg.done} of ${msg.total}.`;
      break;
    }

    case 'foundationDone': {
      // updateFoundationDoc (a single library row's Update) replies on this same
      // message rather than a message of its own — tell the two apart by the
      // docId this UI is tracking, same pattern as downloadingDocId below.
      if (updatingFoundationDocId) {
        const label = libEntries.find((e) => e.docId === updatingFoundationDocId)?.label
          ?? 'the foundation doc';
        showBanner(refs, 'info', `Updated ${label}.`);
        updatingFoundationDocId = null;
        refs.createFrameBtn.disabled = false;
        if (refs.panelLibrary.classList.contains('active')) refreshLibrary();
        break;
      }
      refs.foundationNotes.textContent = msg.replaced > 0
        ? `Updated ${msg.replaced} foundation frames.`
        : `Created ${msg.created} foundation frames.`;
      setFoundationGenerating(refs, false);
      break;
    }

    case 'foundationFrameError': {
      // Frames are appended one at a time and never rolled back, so if any
      // landed before the failure, say so plainly rather than implying nothing
      // happened (a user who believes that and retries gets duplicates, since
      // in-place replacement doesn't exist yet).
      refs.foundationNotes.textContent = msg.created > 0
        ? `Created ${msg.created} frames before hitting an error, and they are still on the canvas. ${msg.message}`
        : `Could not create the foundation frames. ${msg.message}`;
      setFoundationGenerating(refs, false);
      break;
    }

    case 'library': {
      closeRowMenu();
      libEntries = msg.entries;
      renderLibrary(refs, libEntries, libDrift);
      startDriftChecks();
      // Foundation rows are resolved synchronously above (no round trip), so
      // repaint once more immediately — otherwise they'd sit on the stale map
      // from the last refresh until some component's driftSource happens to
      // arrive and trigger a render.
      renderLibrary(refs, libEntries, libDrift);
      break;
    }

    case 'driftSource': {
      const baseline = libBaseline.get(msg.docId);
      // No baseline means this reply is stale (the library was refreshed since
      // we asked, dropping this docId). Ignore it rather than comparing against
      // `undefined`, which would always read as drifted → a phantom "Update".
      if (baseline === undefined) break;
      const spec = extract(msg.node, { figmaFile: msg.fileKey });
      const drifted = specContentHash(spec) !== baseline;
      libDrift.set(msg.docId, drifted ? 'drifted' : 'inSync');
      renderLibrary(refs, libEntries, libDrift);
      break;
    }

    case 'driftError': {
      // Treat an un-checkable source as "in sync" (no false update prompts).
      libDrift.set(msg.docId, 'inSync');
      renderLibrary(refs, libEntries, libDrift);
      break;
    }

    case 'docSource': {
      const src: { docId: string; node: typeof msg.node; fileKey: string; config: DocConfig } = {
        docId: msg.docId, node: msg.node, fileKey: msg.fileKey, config: msg.config,
      };
      if (msg.intent === 'download') {
        void runDownloadFromSource(refs, state, src)
          .finally(() => { downloadingDocId = null; renderQuota(refs, state); });
      } else {
        void runUpdateFromSource(refs, state, src)
          .then((dispatched) => { if (!dispatched) refs.createFrameBtn.disabled = false; })
          .finally(() => renderQuota(refs, state));
      }
      break;
    }

    case 'docSourceError': {
      // The error doesn't say which intent (or which of requestDocSource /
      // updateFoundationDoc) asked, so release every lock it might belong to —
      // whichever one wasn't held is a no-op.
      downloadingDocId = null;
      updatingFoundationDocId = null;
      refs.createFrameBtn.disabled = false;
      showBanner(refs, 'error', msg.message);
      break;
    }

    case 'docDetached':
    case 'docRemoved': {
      if (libMenuDocId === msg.docId) closeRowMenu();
      libEntries = libEntries.filter((e) => e.docId !== msg.docId);
      libDrift.delete(msg.docId);
      libBaseline.delete(msg.docId);
      renderLibrary(refs, libEntries, libDrift);
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// Boot — request initial selection from the main thread
// ---------------------------------------------------------------------------

clearBanners(refs);
// Paint the theme fields/swatches from defaults immediately; the boot-time
// 'brandTheme' message refines them with any stored overrides (and sets the
// mode). Default state is a preset, so controls start hidden.
renderTheme();
send({ type: 'requestSelection' });
// Populate the font-family datalist for the theme's font pickers. If the main
// thread can't list fonts, the inputs simply stay free-text.
send({ type: 'requestFonts' });
