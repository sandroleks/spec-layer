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
import { mount } from './dom';
import {
  createState,
  send,
  runExtract,
  runDownload,
  runCreateDocFrame,
  runAutoExtract,
  setAnthropicKey,
  setAiEnabled,
  setBrandColors,
} from './actions';
import { resolveComponentImage } from './ai';
import { parseBrandHex, emptyBrandColors } from '../brandColors';
import { applyThemeMode, toggleThemeMode, detectFigmaTheme, type ThemeMode } from './theme';
import {
  renderSelection,
  renderVariantPicker,
  renderBrandColors,
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
  runCreateDocFrame(refs, state).catch(() => { /* handled inside */ });
});

// ---------------------------------------------------------------------------
// Download (local .zip)
// ---------------------------------------------------------------------------

refs.downloadBtn.addEventListener('click', () => {
  runDownload(refs, state);
});
refs.anthropicKeyInput.addEventListener('change', () => {
  setAnthropicKey(state, refs.anthropicKeyInput.value);
  // A key may now exist (or have been cleared) — re-evaluate the AI toggle.
  reflectAiToggle();
});

// ---------------------------------------------------------------------------
// Write-with-AI toggle + section select-all
// ---------------------------------------------------------------------------

/** Sync the AI switch, the "no key" note, and the dimmed-badge state to the
 *  current key + preference. The switch can only read "on" when a key exists. */
function reflectAiToggle(): void {
  const hasKey = Boolean(state.anthropicKey);
  const on = state.aiEnabled && hasKey;
  refs.aiToggle.checked = on;
  // No key yet: the toggle can't do anything, so disable it and turn the whole
  // card into a shortcut to Settings (see the card click handler below) rather
  // than letting a click bounce off a dead switch. Also surface the prompt +
  // dim the AI section badges.
  refs.aiToggle.disabled = !hasKey;
  refs.aiCard.classList.toggle('needs-key', !hasKey);
  refs.aiNokey.style.display = hasKey ? 'none' : 'block';
  refs.sectionList.classList.toggle('ai-dim', !on);
}

/** Open Settings and focus the API-key field — shared by both "Settings" links. */
function goToKeySettings(): void {
  switchTab(refs, 'settings');
  refs.anthropicKeyInput.focus();
}

// While no key is set, a click anywhere on the card (except the info button, the
// info panel, or an explicit link, which handle themselves) routes to Settings.
refs.aiCard.addEventListener('click', (e) => {
  if (!refs.aiCard.classList.contains('needs-key')) return;
  const target = e.target as HTMLElement;
  if (target.closest('.info-btn, #ai-info, a')) return;
  goToKeySettings();
});

refs.aiToggle.addEventListener('change', () => {
  // Turning on without a key is not allowed — revert and surface the note.
  if (refs.aiToggle.checked && !state.anthropicKey) {
    setAiEnabled(state, false);
    reflectAiToggle();
    return;
  }
  setAiEnabled(state, refs.aiToggle.checked);
  reflectAiToggle();
});

refs.aiNokeyLink.addEventListener('click', goToKeySettings);
refs.aiInfoSettings.addEventListener('click', goToKeySettings);

// Open the Anthropic console so users can create a key (figma.openExternal).
refs.getKeyLink.addEventListener('click', () => {
  send({ type: 'openBrowser', url: 'https://console.anthropic.com/settings/keys' });
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
  for (const c of checks) c.checked = !allOn;
  refs.selectAllBtn.textContent = allOn ? 'Select all' : 'Clear all';
});

// Toggling the Tokens section shows/hides the per-variant picker.
refs.sectionChecks['tokens']?.addEventListener('change', () => renderVariantPicker(refs, state));

refs.variantSelectAll.addEventListener('click', () => {
  const checks = Array.from(refs.variantList.querySelectorAll('input')) as HTMLInputElement[];
  const allOn = checks.length > 0 && checks.every((c) => c.checked);
  for (const c of checks) c.checked = !allOn;
  refs.variantSelectAll.textContent = allOn ? 'Select all' : 'Clear all';
});

// ---------------------------------------------------------------------------
// Frame brand colors (Settings)
// ---------------------------------------------------------------------------

/**
 * Apply a typed hex value to one brand-color field. Empty input clears the
 * override (back to default); an invalid hex shows a hint and is NOT persisted
 * (the swatch keeps its last valid value). A valid hex is normalized + stored.
 */
function applyBrandColor(field: 'headerBg' | 'accent', raw: string): void {
  const trimmed = raw.trim();
  if (trimmed) {
    const parsed = parseBrandHex(trimmed);
    if (!parsed) {
      refs.brandColorHint.textContent = 'Enter a 6-digit hex color, e.g. #0d2436.';
      return;
    }
    refs.brandColorHint.textContent = '';
    setBrandColors(state, { ...state.brandColors, [field]: parsed });
  } else {
    refs.brandColorHint.textContent = '';
    setBrandColors(state, { ...state.brandColors, [field]: null });
  }
  renderBrandColors(refs, state);
}

refs.headerColorInput.addEventListener('change', () =>
  applyBrandColor('headerBg', refs.headerColorInput.value),
);
refs.accentColorInput.addEventListener('change', () =>
  applyBrandColor('accent', refs.accentColorInput.value),
);
refs.resetColorsLink.addEventListener('click', () => {
  refs.brandColorHint.textContent = '';
  setBrandColors(state, emptyBrandColors());
  renderBrandColors(refs, state);
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
      stopLoader(refs);
      renderSelection(refs, state);
      // Extract right away so Download and the frame are always ready;
      // once the spec is in, (re)populate the per-variant picker.
      runAutoExtract(refs, state, () => renderVariantPicker(refs, state));
      break;
    }

    case 'anthropicKey': {
      state.anthropicKey = msg.value;
      refs.anthropicKeyInput.value = msg.value ?? '';
      reflectAiToggle();
      break;
    }

    case 'aiEnabled': {
      state.aiEnabled = msg.value;
      reflectAiToggle();
      break;
    }

    case 'brandColors': {
      state.brandColors = msg.value;
      renderBrandColors(refs, state);
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
      const note = state.pendingAiNote ? ` — ${state.pendingAiNote}` : '';
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
// Paint the brand-color fields/swatches from defaults immediately; the boot-time
// 'brandColors' message refines them with any stored overrides.
renderBrandColors(refs, state);
send({ type: 'requestSelection' });
