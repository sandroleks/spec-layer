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

import type { MainToUi } from '../messages';
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
  setLicenseKey,
  setAiEnabled,
  setBrandTheme,
} from './actions';
import {
  activateLicense, fetchQuota, effectiveAuth, activationErrorCopy,
  CHECKOUT_URL, MANAGE_SUB_URL, STOREFRONT_URL,
} from './proxy';
import { resolveComponentImage } from './ai';
import { parseBrandHex, emptyBrandTheme, THEME_PRESETS } from '../brandColors';
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

async function refreshQuota(): Promise<void> {
  state.quota = await fetchQuota(effectiveAuth(state.licenseKey, state.figmaUserId, state.licenseActive));
  // Learn the key's real standing from the probe. A definite free-tier response
  // while a key is stored (and we haven't already ruled it inactive) means the
  // key isn't granting Pro — drop to the free identity and re-read the meter so
  // it shows the user's real free quota, not the license identity's empty one.
  // A null quota (offline) teaches us nothing and leaves the key untouched.
  if (state.licenseKey && state.licenseActive !== false && state.quota) {
    if (state.quota.tier === 'pro') {
      state.licenseActive = true;
    } else {
      state.licenseActive = false;
      state.quota = await fetchQuota(effectiveAuth(state.licenseKey, state.figmaUserId, false));
    }
  }
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
// Download (local .zip)
// ---------------------------------------------------------------------------

refs.downloadBtn.addEventListener('click', () => {
  runDownload(refs, state);
});
refs.licenseActivateBtn.addEventListener('click', async () => {
  const key = refs.licenseKeyInput.value.trim();
  if (!key) return;
  refs.licenseStatus.textContent = 'Checking…';
  refs.licenseRenewRow.hidden = true;
  try {
    let out = await activateLicense(key, state.licenseInstanceId);
    // A stored instance id can go stale (the device was deactivated in the
    // dashboard, or it came from an older build). If revalidating it fails,
    // register a fresh instance instead of showing a false "not active" error.
    if (!out.valid && state.licenseInstanceId) {
      out = await activateLicense(key, null);
    }
    if (out.valid && out.status === 'active') {
      state.licenseActive = true;
      setLicenseKey(state, key, out.instanceId ?? state.licenseInstanceId);
      // The main thread only persists the key (no licenseKey echo back), so
      // refresh the toggle affordance here or a stale "no identity" hint lingers.
      reflectAiToggle();
      await refreshQuota(); // sets the status line to "Pro plan active ✓"
    } else if (out.status === 'active') {
      // Valid, active key that couldn't be activated here: almost always the
      // per-key device limit is full, not a bad key.
      refs.licenseStatus.textContent = "This key is active but couldn't be activated on this device. It may have reached its device limit. Free up a device in Manage subscription, or reach out to support.";
    } else {
      // Differentiated by the raw LS status: expired → renew, disabled →
      // support, anything else → wrong key. No raw code leaks to the user.
      refs.licenseStatus.textContent = activationErrorCopy(out.status);
    }
  } catch {
    refs.licenseStatus.textContent = "Couldn't reach the license server. Give it another go in a minute.";
  }
  renderQuota(refs, state);
});
refs.licenseKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') refs.licenseActivateBtn.click();
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

// Info disclosure: toggle the details panel + the button's expanded state.
refs.aiInfoBtn.addEventListener('click', () => {
  const open = refs.aiInfo.hidden;
  refs.aiInfo.hidden = !open;
  refs.aiInfoBtn.setAttribute('aria-expanded', String(open));
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
  refs.selectAllBtn.textContent = allOn ? 'Select all' : 'Clear all';
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
  renderBrandTheme(refs, state);
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
  setBrandTheme(state, emptyBrandTheme());
  renderBrandTheme(refs, state);
});

/** Apply a typed font family to a theme font field (empty → default). */
function applyBrandFont(field: 'headingFont' | 'bodyFont', raw: string): void {
  const trimmed = raw.trim();
  setBrandTheme(state, { ...state.brandTheme, [field]: trimmed || null });
  renderBrandTheme(refs, state);
}

refs.headingFontInput.addEventListener('change', () =>
  applyBrandFont('headingFont', refs.headingFontInput.value),
);
refs.bodyFontInput.addEventListener('change', () =>
  applyBrandFont('bodyFont', refs.bodyFontInput.value),
);

// Preset chips (injected in mount() from THEME_PRESETS): clicking one applies a
// CLONE of the preset's theme, so later per-field edits never mutate the preset.
refs.presetRow.addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement).closest('.preset-chip') as HTMLElement | null;
  if (!chip) return;
  const preset = THEME_PRESETS.find((p) => p.name === chip.dataset.preset);
  if (!preset) return;
  refs.brandColorHint.textContent = '';
  setBrandTheme(state, { ...preset.theme });
  renderBrandTheme(refs, state);
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
      renderBrandTheme(refs, state);
      break;
    }

    case 'fontList': {
      refs.fontDatalist.textContent = '';
      for (const family of msg.families) {
        const option = document.createElement('option');
        option.value = family;
        refs.fontDatalist.appendChild(option);
      }
      break;
    }

    case 'logoCaptured': {
      state.logoBase64 = msg.base64;
      refs.logoErrorHint.textContent = '';
      renderBrandTheme(refs, state);
      break;
    }

    case 'logoCleared': {
      state.logoBase64 = null;
      refs.logoErrorHint.textContent = '';
      renderBrandTheme(refs, state);
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
      showBanner(refs, state.pendingAiNote ? 'error' : 'info', `Created ${msg.frameName}${note}`);
      state.pendingAiNote = '';
      refs.createFrameBtn.disabled = false;
      break;
    }

    case 'docFrameError': {
      stopLoader(refs);
      showBanner(refs, 'error', `Frame failed: ${msg.message}`);
      refs.createFrameBtn.disabled = false;
      break;
    }
  }
};

// ---------------------------------------------------------------------------
// Boot — request initial selection from the main thread
// ---------------------------------------------------------------------------

clearBanners(refs);
// Paint the theme fields/swatches from defaults immediately; the boot-time
// 'brandTheme' message refines them with any stored overrides.
renderBrandTheme(refs, state);
send({ type: 'requestSelection' });
// Populate the font-family datalist for the theme's font pickers. If the main
// thread can't list fonts, the inputs simply stay free-text.
send({ type: 'requestFonts' });
