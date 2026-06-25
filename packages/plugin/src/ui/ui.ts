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
import { parseFigmaFileKey } from './fileKey';
import { normalizeDocsEndpoint } from './state';
import {
  createState,
  send,
  runExtract,
  runDownload,
  runSendToDocs,
  runExportAll,
  handleExportAllScanning,
  handleExportAllStart,
  handleExportComponent,
  handleExportAllDone,
  handleExportAllError,
  refreshRenderedSpecFileKey,
  runCreateDocFrame,
  runAutoExtract,
  setAnthropicKey,
  setAiEnabled,
} from './actions';
import { resolveComponentImage } from './ai';
import { applyThemeMode, toggleThemeMode, detectFigmaTheme, type ThemeMode } from './theme';
import {
  renderFigmaConnection,
  renderPhase,
  renderSelection,
  renderVariantPicker,
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
refs.tabAll.addEventListener('click', () => switchTab(refs, 'all'));
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
// Export dropdown (Send to docs / Download .md)
// ---------------------------------------------------------------------------

function setExportMenu(open: boolean): void {
  refs.exportWrap.classList.toggle('open', open);
  refs.exportBtn.setAttribute('aria-expanded', String(open));
}

refs.exportBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setExportMenu(!refs.exportWrap.classList.contains('open'));
});

// Close the menu on any outside click.
document.addEventListener('click', (e) => {
  if (!refs.exportWrap.contains(e.target as Node)) setExportMenu(false);
});

refs.sendBtn.addEventListener('click', () => {
  setExportMenu(false);
  runSendToDocs(refs, state).catch(() => { /* handled inside */ });
});
refs.downloadBtn.addEventListener('click', () => {
  setExportMenu(false);
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
// Export-all panel
// ---------------------------------------------------------------------------

refs.exportAllBtn.addEventListener('click', () => runExportAll(refs, state));

// ---------------------------------------------------------------------------
// Optional docs-platform inputs (endpoint + file key override)
// ---------------------------------------------------------------------------

refs.endpointInput.addEventListener('change', () => {
  // Normalize a typed 127.0.0.1/::1 host to 'localhost' (the only loopback form
  // Figma can allowlist) and reflect the canonical value back into the field.
  state.docsEndpoint = normalizeDocsEndpoint(refs.endpointInput.value);
  refs.endpointInput.value = state.docsEndpoint;
  send({ type: 'setDocsEndpoint', value: state.docsEndpoint });
});

// Both the persistent Settings field and the inline send-time prompt resolve a
// pasted URL/key the same way. Main is the single authority: it stores the
// override, recomputes the effective key, and echoes both back via a
// 'fileKeyOverride' message (which also clears the inline prompt on success).
function applyFileKeyInput(raw: string, onInvalid: (message: string) => void): void {
  const trimmed = raw.trim();
  if (!trimmed) {
    send({ type: 'setFileKeyOverride', value: null });
    return;
  }
  const parsed = parseFigmaFileKey(trimmed);
  if (!parsed) {
    onInvalid('Could not detect a file key — paste the full Figma URL.');
    return;
  }
  send({ type: 'setFileKeyOverride', value: parsed });
}

refs.fileKeyInput.addEventListener('change', () => {
  refs.fileKeyHint.textContent = '';
  applyFileKeyInput(refs.fileKeyInput.value, (message) => {
    refs.fileKeyHint.textContent = message;
  });
});

refs.inlineFileKeyInput.addEventListener('change', () => {
  clearBanners(refs);
  applyFileKeyInput(refs.inlineFileKeyInput.value, (message) => {
    showBanner(refs, 'error', message);
  });
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
      // msg.fileKey is already the effective key computed by main.
      state.currentFileKey = msg.fileKey;
      state.currentFileKeySource = msg.fileKeySource;
      state.currentSpec = null;
      state.currentExtractedAt = '';
      state.phase = 'idle';
      state.renderedMd = '';
      // Clear AI prose too: it belongs to the previous component. Without this,
      // generating prose for A then selecting B would pair B's spec with A's prose.
      state.generatedProse = null;
      setExportMenu(false);
      stopLoader(refs);
      renderSelection(refs, state);
      renderFigmaConnection(
        refs,
        state.currentFileKeySource,
        state.currentFileKey,
        state.fileKeyOverride,
      );
      // Extract right away so Export/Download and the frame are always ready;
      // once the spec is in, (re)populate the per-variant picker.
      runAutoExtract(refs, state, () => renderVariantPicker(refs, state));
      break;
    }

    case 'docsEndpoint': {
      // Self-heal a persisted 127.0.0.1/::1 endpoint saved before the localhost
      // fix: normalize on load, and write the corrected value back to
      // clientStorage so it stays fixed across sessions.
      const normalized = normalizeDocsEndpoint(msg.value ?? 'http://localhost:3000');
      state.docsEndpoint = normalized;
      refs.endpointInput.value = normalized;
      if (msg.value && msg.value !== normalized) {
        send({ type: 'setDocsEndpoint', value: normalized });
      }
      break;
    }

    case 'fileKeyOverride': {
      // Main is the single authority; it sends both the stored override
      // (for the input) and the computed effective key (for display/use).
      state.fileKeyOverride = msg.value;
      state.currentFileKeySource = msg.fileKeySource;
      refreshRenderedSpecFileKey(state, msg.effectiveFileKey);
      renderFigmaConnection(refs, msg.fileKeySource, msg.effectiveFileKey, msg.value);
      renderPhase(refs, state);
      break;
    }

    case 'exportAllScanning': {
      handleExportAllScanning(refs);
      break;
    }

    case 'exportAllStart': {
      handleExportAllStart(refs, state, msg.total, msg.fileKey, msg.skippedAtoms);
      break;
    }

    case 'exportComponent': {
      handleExportComponent(refs, state, msg.node, msg.index, msg.total);
      break;
    }

    case 'exportAllDone': {
      handleExportAllDone(refs, state);
      break;
    }

    case 'exportAllError': {
      handleExportAllError(refs, state, msg.message);
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
send({ type: 'requestSelection' });
