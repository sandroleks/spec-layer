/**
 * dom.ts — owns the UI's static markup + styles and the typed element refs.
 *
 * `mount()` injects the template into document.body and returns a `Refs` object
 * so the rest of the UI never reaches for `getElementById` directly. The markup
 * is laid out as a tabbed shell:
 *
 *   [ Selected component ]  [ Settings ]
 *
 * The "Selected component" tab is the single-component flow (auto-extract →
 * Write-with-AI → Create frame / Download). The "Settings" tab holds the
 * Anthropic API key used by Write-with-AI.
 *
 * Figma's own chrome shows the plugin icon + name, so the UI starts straight at
 * the tab bar (no duplicate title). A light/dark theme button lives at the right
 * end of the tab row (wired in ui.ts / theme.ts).
 *
 * Theming: the active palette is always applied via `body[data-theme]` (the
 * light/dark palettes below). The initial value is detected from Figma's host
 * theme at boot and the button toggles it; see theme.ts. Figma's injected
 * `--figma-color-*` vars (from `themeColors: true`) still provide the fallback
 * values and keep the non-Figma/test render legible.
 */

import { ALL_SECTIONS } from './docModel';

// ---------------------------------------------------------------------------
// Markup + styles
// ---------------------------------------------------------------------------

const TEMPLATE = `
  <style>
    * { box-sizing: border-box; }
    :root {
      /* Fallbacks so the UI is still legible if theme vars are absent
         (e.g. unit tests, non-Figma host). Real values come from Figma. */
      --figma-color-bg: #ffffff;
      --figma-color-bg-secondary: #f5f5f5;
      --figma-color-bg-tertiary: #e6e6e6;
      --figma-color-bg-brand: #0d99ff;
      --figma-color-bg-brand-hover: #0a85e0;
      --figma-color-bg-disabled: #e6e6e6;
      --figma-color-text: #1e1e1e;
      --figma-color-text-secondary: #767676;
      --figma-color-text-onbrand: #ffffff;
      --figma-color-text-disabled: #b3b3b3;
      --figma-color-border: #e6e6e6;
      --figma-color-bg-success: #14ae5c;
      --figma-color-bg-success-tertiary: #ebf7ee;
      --figma-color-text-success: #097a3d;
      --figma-color-bg-danger: #f24822;
      --figma-color-bg-danger-tertiary: #fdece9;
      --figma-color-text-danger: #b3251b;
    }

    /* ---- Theme palettes ----
       ui.ts always sets body[data-theme] (light or dark), and these blocks
       redefine the tokens with Figma's published values. We scope to body (not
       :root) deliberately: CSS custom properties resolve from the nearest
       ancestor, so a body-level palette wins over Figma's injected :root vars no
       matter how Figma injects them. Values mirror Figma's own light/dark palette
       so the chrome stays on-brand. */
    body[data-theme="light"] {
      --figma-color-bg: #ffffff;
      --figma-color-bg-secondary: #f5f5f5;
      --figma-color-bg-tertiary: #e6e6e6;
      --figma-color-bg-brand: #0d99ff;
      --figma-color-bg-brand-hover: #0a85e0;
      --figma-color-bg-disabled: #e6e6e6;
      --figma-color-text: #1e1e1e;
      --figma-color-text-secondary: #767676;
      --figma-color-text-onbrand: #ffffff;
      --figma-color-text-disabled: #b3b3b3;
      --figma-color-border: #e6e6e6;
      --figma-color-bg-success: #14ae5c;
      --figma-color-bg-success-tertiary: #ebf7ee;
      --figma-color-text-success: #097a3d;
      --figma-color-bg-danger: #f24822;
      --figma-color-bg-danger-tertiary: #fdece9;
      --figma-color-text-danger: #b3251b;
    }
    body[data-theme="dark"] {
      --figma-color-bg: #2c2c2c;
      --figma-color-bg-secondary: #383838;
      --figma-color-bg-tertiary: #4a4a4a;
      --figma-color-bg-brand: #0d99ff;
      --figma-color-bg-brand-hover: #2aa3ff;
      --figma-color-bg-disabled: #3a3a3a;
      --figma-color-text: #ffffff;
      --figma-color-text-secondary: #b3b3b3;
      --figma-color-text-onbrand: #ffffff;
      --figma-color-text-disabled: #595959;
      --figma-color-border: #444444;
      --figma-color-bg-success: #14ae5c;
      --figma-color-bg-success-tertiary: #1d3024;
      --figma-color-text-success: #4ac26b;
      --figma-color-bg-danger: #f24822;
      --figma-color-bg-danger-tertiary: #3a211c;
      --figma-color-text-danger: #f4796a;
    }
    html, body { height: 100%; }
    body {
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px; margin: 0; line-height: 1.45;
      color: var(--figma-color-text);
      background: var(--figma-color-bg);
      display: flex; flex-direction: column; height: 100vh;
    }

    /* ---- Tab bar ----
       The topmost UI element (Figma's own chrome already shows the plugin icon +
       name, so we don't repeat a title here). Figma-native segmented style: the
       active tab is a filled rounded pill (elevated surface) rather than an
       underline; inactive tabs are plain text with a faint pill on hover. The
       cycling theme button lives at the right end of this row. */
    .tabs {
      display: flex; align-items: center; gap: 2px; padding: 7px 10px;
      border-bottom: 1px solid var(--figma-color-border);
      flex: 0 0 auto;
    }
    /* Cycling light/dark/auto button — pushed to the right edge of the tab row. */
    .theme-btn {
      appearance: none; flex: 0 0 auto; cursor: pointer; margin-left: auto;
      width: 26px; height: 26px; border-radius: 7px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--figma-color-border);
      background: var(--figma-color-bg); color: var(--figma-color-text);
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .theme-btn:hover { background: var(--figma-color-bg-secondary); border-color: var(--figma-color-text-secondary); }
    .theme-btn:focus-visible { outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px; }
    .theme-btn svg { width: 15px; height: 15px; display: block; }
    .tab {
      appearance: none; background: none; border: none; cursor: pointer;
      padding: 5px 10px; border-radius: 6px;
      font-size: 12px; font-weight: 500;
      color: var(--figma-color-text-secondary);
      transition: background 0.12s ease, color 0.12s ease;
    }
    .tab:hover:not(:disabled):not([aria-selected="true"]) {
      color: var(--figma-color-text);
      background: var(--figma-color-bg-secondary);
    }
    .tab[aria-selected="true"] {
      color: var(--figma-color-text);
      background: var(--figma-color-bg-secondary);
    }
    .tab:disabled { cursor: default; opacity: 0.5; }
    .tab .badge {
      font-size: 9px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.04em; margin-left: 6px;
      color: var(--figma-color-text-secondary);
      border: 1px solid var(--figma-color-border);
      border-radius: 4px; padding: 1px 4px;
    }

    /* ---- Scrollable body ---- */
    .content { flex: 1 1 auto; overflow-y: auto; padding: 14px 12px; }
    .panel { display: none; }
    .panel.active { display: block; }

    /* ---- Typography / layout ---- */
    h2 { font-size: 13px; font-weight: 600; margin: 0; }
    .muted { color: var(--figma-color-text-secondary); }
    .hint { font-size: 11px; color: var(--figma-color-text-secondary); margin: 4px 0 0; }
    .hint a { color: var(--figma-color-bg-brand); cursor: pointer; }
    .hint a:hover { text-decoration: underline; }
    .row { display: flex; align-items: center; gap: 8px; }
    .stack { display: flex; flex-direction: column; gap: 10px; }
    hr { border: none; border-top: 1px solid var(--figma-color-border); margin: 14px 0; }

    /* ---- Header / component identity ---- */
    .comp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .phase-label { font-size: 11px; color: var(--figma-color-text-secondary); }

    /* ---- Buttons ---- */
    button.btn {
      appearance: none; font-size: 12px; font-weight: 500;
      padding: 8px 14px; border-radius: 8px; cursor: pointer;
      border: 1px solid transparent; line-height: 1;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    button.btn:disabled { cursor: default; opacity: 0.5; }
    .btn-primary {
      background: var(--figma-color-bg-brand);
      color: var(--figma-color-text-onbrand);
    }
    .btn-primary:hover:not(:disabled) { background: var(--figma-color-bg-brand-hover); }
    .btn-secondary {
      background: var(--figma-color-bg-secondary);
      color: var(--figma-color-text);
      border-color: var(--figma-color-border);
    }
    .btn-secondary:hover:not(:disabled) { background: var(--figma-color-bg-tertiary); }

    /* ---- Inputs ---- */
    label.field-label {
      display: block; font-size: 11px; font-weight: 500;
      color: var(--figma-color-text-secondary); margin-bottom: 4px;
    }
    input[type="text"], input[type="password"] {
      width: 100%; font-size: 12px; padding: 8px 9px;
      border: 1px solid var(--figma-color-border); border-radius: 8px;
      background: var(--figma-color-bg); color: var(--figma-color-text);
      transition: border-color 0.12s ease, box-shadow 0.12s ease;
    }
    input[type="text"]:focus, input[type="password"]:focus {
      outline: none; border-color: var(--figma-color-bg-brand);
      box-shadow: 0 0 0 2px var(--figma-color-bg-secondary);
    }

    /* ---- Color fields (frame brand colors) ----
       A static swatch preview sits left of a hex text input. The swatch shows
       the effective color (override or default); the input holds the override
       (empty = default, surfaced via placeholder). */
    .color-row { display: flex; align-items: center; gap: 8px; }
    .color-row input[type="text"] { flex: 1; }
    .color-swatch {
      flex: 0 0 auto; width: 26px; height: 26px; border-radius: 7px;
      border: 1px solid var(--figma-color-border); background: #0d2436;
    }

    /* ---- Preview textarea ---- */
    textarea {
      width: 100%; height: 260px; font-family: "SF Mono", "Fira Mono", monospace;
      font-size: 11px; border: 1px solid var(--figma-color-border);
      border-radius: 6px; padding: 10px; resize: vertical; line-height: 1.5;
      background: var(--figma-color-bg-secondary); color: var(--figma-color-text);
    }
    textarea:focus { outline: none; border-color: var(--figma-color-bg-brand); }

    /* ---- Alerts / banners ---- */
    .banner {
      display: none; gap: 8px; align-items: flex-start;
      padding: 9px 11px; border-radius: 8px; font-size: 11px; line-height: 1.45;
      margin-bottom: 10px; border: 1px solid transparent;
    }
    .banner::before {
      flex: 0 0 auto; font-weight: 700; font-size: 12px; line-height: 1.3;
    }
    .banner.info {
      background: var(--figma-color-bg-secondary); color: var(--figma-color-text);
      border-color: var(--figma-color-border);
    }
    .banner.info::before { content: "i"; color: var(--figma-color-text-secondary);
      width: 14px; height: 14px; border-radius: 50%; text-align: center;
      border: 1px solid var(--figma-color-text-secondary); font-style: italic; font-size: 10px; }
    .banner.error {
      background: var(--figma-color-bg-danger-tertiary); color: var(--figma-color-text-danger);
    }
    .banner.error::before { content: "⚠"; color: var(--figma-color-text-danger); }

    /* ---- Generating loader (Create frame) ----
       A small pulsing sparkle + shimmering, cycling status text — a livelier
       stand-in for the old static "Building frame…" banner. Shown/hidden and
       its messages cycled from render.ts (startLoader/stopLoader). */
    .loader {
      display: none; align-items: center; gap: 9px;
      padding: 9px 11px; border-radius: 8px; margin-bottom: 10px;
      background: var(--figma-color-bg-secondary); border: 1px solid var(--figma-color-border);
    }
    .loader.show { display: flex; }
    .loader-icon {
      width: 13px; height: 13px; flex: 0 0 auto;
      background: var(--figma-color-bg-brand);
      clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%);
      animation: loader-spark 1.4s ease-in-out infinite;
    }
    @keyframes loader-spark {
      0%, 100% { transform: rotate(0deg) scale(0.8); opacity: 0.65; }
      50%      { transform: rotate(90deg) scale(1.1); opacity: 1; }
    }
    .loader-body { display: inline-flex; align-items: center; gap: 3px; min-width: 0; }
    /* Base: always a solid, visible colour. The shimmer is layered on top only
       where background-clip:text is supported, so the text can never render
       fully transparent (which left an empty pill on some hosts). */
    .loader-text {
      font-size: 11px; font-weight: 500; line-height: 1.3;
      color: var(--figma-color-text);
    }
    @supports ((-webkit-background-clip: text) or (background-clip: text)) {
      .loader-text {
        background: linear-gradient(
          90deg,
          var(--figma-color-text-secondary) 0%,
          var(--figma-color-text) 25%,
          var(--figma-color-text-secondary) 50%
        );
        background-size: 220% 100%;
        -webkit-background-clip: text; background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: loader-shimmer 2.6s linear infinite;
      }
    }
    @keyframes loader-shimmer { to { background-position: -220% 0; } }
    /* Trailing typing dots, à la Claude. Each fades + lifts in sequence. */
    .loader-dots { display: inline-flex; align-items: center; gap: 2px; margin-bottom: -1px; }
    .loader-dots span {
      width: 3px; height: 3px; border-radius: 50%;
      background: var(--figma-color-text-secondary);
      animation: loader-dot 1.4s ease-in-out infinite;
    }
    .loader-dots span:nth-child(2) { animation-delay: 0.18s; }
    .loader-dots span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes loader-dot {
      0%, 70%, 100% { opacity: 0.25; transform: translateY(0); }
      35%           { opacity: 1; transform: translateY(-1px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .loader-icon { animation: none; opacity: 1; }
      .loader-text {
        animation: none; -webkit-text-fill-color: var(--figma-color-text);
        color: var(--figma-color-text); transition: none;
      }
      .loader-dots span { animation: none; opacity: 0.5; transform: none; }
    }

    .atom-notice {
      display: none; margin-top: 8px; padding: 8px 10px; border-radius: 6px;
      background: var(--figma-color-bg-secondary); color: var(--figma-color-text-secondary);
      font-size: 11px;
    }
    /* ---- Custom checkbox (section checklist, variant picker, export options) ----
       Native checkboxes render inconsistently across platforms and ignore most
       theming; appearance:none lets us draw a Figma-style box + CSS checkmark
       that tracks the theme tokens. Scoped to .sec-row/.check-row so the AI
       switch (a visually-hidden checkbox) is untouched. */
    .sec-row input[type="checkbox"],
    .check-row input[type="checkbox"] {
      appearance: none; -webkit-appearance: none; margin: 0;
      width: 15px; height: 15px; flex: 0 0 auto; position: relative; cursor: pointer;
      border: 1.5px solid var(--figma-color-border); border-radius: 4px;
      background: var(--figma-color-bg);
      transition: background 0.1s ease, border-color 0.1s ease;
    }
    .sec-row input[type="checkbox"]:hover,
    .check-row input[type="checkbox"]:hover { border-color: var(--figma-color-bg-brand); }
    .sec-row input[type="checkbox"]:checked,
    .check-row input[type="checkbox"]:checked {
      background: var(--figma-color-bg-brand); border-color: var(--figma-color-bg-brand);
    }
    /* CSS checkmark: a rotated rectangle with two borders. */
    .sec-row input[type="checkbox"]:checked::after,
    .check-row input[type="checkbox"]:checked::after {
      content: ""; position: absolute; left: 4.5px; top: 1.5px;
      width: 4px; height: 8px; box-sizing: border-box;
      border: solid var(--figma-color-text-onbrand); border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .sec-row input[type="checkbox"]:focus-visible,
    .check-row input[type="checkbox"]:focus-visible {
      outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px;
    }

    /* Generic checkbox row (export-all panel). */
    .check-row { display: flex; align-items: flex-start; gap: 8px; font-size: 11px; }
    .check-row input[type="checkbox"] { margin-top: 1px; }
    .check-row label { cursor: pointer; }
    .check-row span { display: block; margin-top: 2px; color: var(--figma-color-text-secondary); }

    /* Inline (AI) badge on AI-generated section rows. */
    .ai-badge {
      display: inline-block; font-size: 9px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.04em; margin-left: 6px;
      color: var(--figma-color-text-secondary);
      border: 1px solid var(--figma-color-border);
      border-radius: 4px; padding: 0 4px; vertical-align: middle;
    }

    /* ---- "Write with AI" switch + card ---- */
    .ai-card {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      padding: 11px 13px; border-radius: 10px; margin-top: 12px;
      background: var(--figma-color-bg-secondary); border: 1px solid var(--figma-color-border);
    }
    .ai-head { display: flex; align-items: center; gap: 5px; }
    .ai-card .ai-title { font-size: 12px; font-weight: 600; }
    .ai-card .hint { margin-top: 2px; }
    /* Info disclosure: ⓘ button toggles the .ai-info panel (wired in ui.ts). */
    .info-btn {
      appearance: none; border: none; background: none; cursor: pointer; padding: 0;
      width: 16px; height: 16px; flex: 0 0 auto;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--figma-color-text-secondary); transition: color 0.12s ease;
    }
    .info-btn:hover { color: var(--figma-color-text); }
    .info-btn[aria-expanded="true"] { color: var(--figma-color-bg-brand); }
    .info-btn svg { width: 14px; height: 14px; display: block; }
    .info-btn:focus-visible { outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px; border-radius: 50%; }
    .ai-info {
      margin-top: 8px; padding: 9px 11px; border-radius: 8px;
      background: var(--figma-color-bg); border: 1px solid var(--figma-color-border);
      font-size: 11px; color: var(--figma-color-text-secondary); line-height: 1.5;
    }
    .ai-info[hidden] { display: none; }
    .ai-info p { margin: 0; }
    .ai-info p + p { margin-top: 6px; }
    .ai-info a, .ai-nokey a { color: var(--figma-color-bg-brand); cursor: pointer; }
    /* Shown whenever no key is set (incl. first run) — informational, not an error. */
    .ai-nokey { font-size: 11px; color: var(--figma-color-text-secondary); margin-top: 6px; }
    .switch { position: relative; width: 36px; height: 20px; flex: 0 0 auto; margin-top: 1px; }
    .switch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; z-index: 1; }
    .switch .track {
      position: absolute; inset: 0; border-radius: 999px;
      background: var(--figma-color-bg-tertiary); transition: background 0.12s;
    }
    .switch .track::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
      border-radius: 50%; background: #fff; transition: transform 0.12s;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    }
    .switch input:checked + .track { background: var(--figma-color-bg-brand); }
    .switch input:checked + .track::after { transform: translateX(16px); }
    /* No-key state: the toggle can't be turned on yet, so it's shown disabled and
       the whole card becomes a shortcut to Settings (wired in ui.ts). The disabled
       input gets pointer-events:none so clicks fall through to the card handler. */
    .ai-card.needs-key { cursor: pointer; }
    .ai-card.needs-key:hover { border-color: var(--figma-color-text-secondary); }
    .ai-card.needs-key .switch { opacity: 0.45; }
    .switch input:disabled { pointer-events: none; }

    /* ---- Section header + checklist ---- */
    .section-head { display: flex; align-items: center; justify-content: space-between; margin: 16px 0 6px; }
    .link-btn {
      appearance: none; background: none; border: none; cursor: pointer; padding: 0;
      font-family: inherit; font-size: 11px; color: var(--figma-color-bg-brand);
    }
    .link-btn:hover { text-decoration: underline; }
    .link-btn:disabled { color: var(--figma-color-text-disabled); cursor: default; text-decoration: none; }
    #section-list { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 12px; }
    .sec-row {
      display: flex; align-items: center; gap: 8px; font-size: 12px;
      padding: 6px 8px; border-radius: 6px;
    }
    .sec-row:hover { background: var(--figma-color-bg-secondary); }
    .sec-row label { cursor: pointer; flex: 1; }
    #section-list.ai-dim .ai-badge { opacity: 0.4; }

    /* ---- Variant picker (per-variant tokens) ---- */
    .variant-picker {
      margin-top: 12px; padding: 11px 13px; border-radius: 10px;
      background: var(--figma-color-bg-secondary); border: 1px solid var(--figma-color-border);
    }
    .variant-picker .vp-head {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
    }
    .variant-picker .vp-title {
      font-size: 11px; font-weight: 600; color: var(--figma-color-text-secondary);
    }
    #variant-list {
      display: flex; flex-direction: column; gap: 1px;
      max-height: 148px; overflow-y: auto;
    }
    #variant-list .sec-row { background: var(--figma-color-bg); }
    #variant-list .sec-row:hover { background: var(--figma-color-bg-tertiary); }

    /* ---- Action buttons ---- */
    .actions { display: flex; gap: 8px; margin-top: 16px; }
    .actions > .btn, .actions > .menu-wrap { flex: 1; }

    /* ---- Sticky action footer (Selected-component tab) ---- */
    .footer {
      flex: 0 0 auto; padding: 12px; background: var(--figma-color-bg);
      border-top: 1px solid var(--figma-color-border);
    }
    .footer .actions { margin-top: 0; }
    .footer .banner { margin-bottom: 8px; }
    .footer .inline-filekey { margin-top: 0; margin-bottom: 8px; }

    /* ---- Export dropdown menu ---- */
    .menu-wrap { position: relative; }
    .menu-wrap > .btn { width: 100%; }
    .caret { display: inline-block; margin-left: 4px; transition: transform 0.12s; }
    .menu-wrap.open .caret { transform: rotate(180deg); }
    /* Opens upward — the dropdown lives in the bottom action footer. */
    .menu {
      position: absolute; bottom: calc(100% + 6px); left: 0; right: 0; z-index: 5;
      background: var(--figma-color-bg); border: 1px solid var(--figma-color-border);
      border-radius: 8px; box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.18);
      overflow: hidden; display: none;
    }
    .menu-wrap.open .menu { display: block; }
    .menu-item {
      appearance: none; display: block; width: 100%; text-align: left;
      padding: 9px 12px; font-family: inherit; font-size: 12px; cursor: pointer;
      background: none; border: none; color: var(--figma-color-text);
    }
    .menu-item + .menu-item { border-top: 1px solid var(--figma-color-border); }
    .menu-item:hover:not(:disabled) { background: var(--figma-color-bg-secondary); }
    .menu-item:disabled { color: var(--figma-color-text-disabled); cursor: default; }

    /* ---- Reading chip (auto-extract loading indicator) ---- */
    .chip {
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 10px; color: var(--figma-color-text-secondary);
      background: var(--figma-color-bg-secondary); border-radius: 999px; padding: 2px 8px;
    }
    .chip::before {
      content: ""; width: 6px; height: 6px; border-radius: 50%;
      background: var(--figma-color-bg-brand);
    }

    /* ---- Inline send-time file-key prompt ---- */
    .inline-filekey {
      margin-top: 10px; padding: 10px; border-radius: 6px;
      background: var(--figma-color-bg-secondary);
      border: 1px solid var(--figma-color-border);
    }
    .figma-source {
      display: flex; gap: 8px; padding: 9px 10px; border-radius: 6px;
      background: var(--figma-color-bg); border: 1px solid var(--figma-color-border);
    }
    .figma-source::before {
      content: ""; width: 7px; height: 7px; margin-top: 4px; border-radius: 50%;
      flex: 0 0 auto; background: var(--figma-color-text-secondary);
    }
    .figma-source.figma::before, .figma-source.override::before {
      background: var(--figma-color-bg-success);
    }
    .figma-source.missing::before { background: var(--figma-color-bg-danger); }
    .figma-source strong { display: block; font-size: 11px; font-weight: 600; }
    .figma-source span { display: block; margin-top: 2px; font-size: 10px; color: var(--figma-color-text-secondary); }

    /* ---- Empty / placeholder states ---- */
    .empty {
      text-align: center; color: var(--figma-color-text-secondary);
      padding: 32px 16px;
    }
    .empty .empty-title { font-size: 13px; font-weight: 600; color: var(--figma-color-text); margin-bottom: 4px; }
  </style>

  <div class="tabs" role="tablist">
    <button class="tab" id="tab-selected" role="tab" aria-selected="true"
            aria-controls="tab-panel-selected">Selected component</button>
    <button class="tab" id="tab-settings" role="tab" aria-selected="false"
            aria-controls="tab-panel-settings">Settings</button>
    <button class="theme-btn" id="theme-btn" type="button" title="Theme"
            aria-label="Toggle light/dark theme"></button>
  </div>

  <div class="content">
    <!-- ============ Selected-component panel ============ -->
    <section class="panel active" id="tab-panel-selected" role="tabpanel"
             aria-labelledby="tab-selected">
      <!-- No selection -->
      <div class="empty" id="no-selection">
        <div class="empty-title">No component selected</div>
        <div>Select a component or component set in Figma to extract its spec.</div>
      </div>

      <!-- Main flow -->
      <div id="main-area" style="display:none">
        <div class="comp-head">
          <h2 id="component-name">Component</h2>
          <span class="phase-label" id="phase-label"></span>
        </div>
        <div class="atom-notice" id="atom-notice">
          <strong>Atom component.</strong> It is normally used to build larger components, but you can still export it individually.
        </div>

        <!-- Write with AI: one switch gates AI-written prose for the AI sections.
             The ⓘ button toggles #ai-info; #ai-nokey shows whenever no key is set. -->
        <div class="ai-card" id="ai-card">
          <div class="ai-main">
            <div class="ai-head">
              <span class="ai-title">Write with AI</span>
              <button class="info-btn" id="ai-info-btn" type="button"
                      aria-label="About Write with AI" aria-expanded="false" aria-controls="ai-info">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>
                </svg>
              </button>
            </div>
            <p class="hint">Let Claude draft the <strong>AI</strong> sections from your component.</p>
            <div class="ai-info" id="ai-info" hidden>
              <p>Drafts the <strong>Definition</strong>, <strong>Accessibility</strong>, and <strong>Do's &amp; Don'ts</strong> sections. When off, they use placeholder text.</p>
              <p>Uses your own <strong>Anthropic API key</strong>, stored locally and billed to your account.</p>
            </div>
            <div class="ai-nokey" id="ai-nokey" style="display:none">
              Add your Anthropic API key to turn this on. <a id="ai-nokey-link">Open Settings</a>.
            </div>
          </div>
          <label class="switch">
            <input type="checkbox" id="ai-toggle" />
            <span class="track"></span>
          </label>
        </div>

        <!-- Section checklist: which guideline sections to include. Rows are
             generated in mount() from ALL_SECTIONS so the markup stays DRY;
             #section-list is the injection target. -->
        <div class="section-head">
          <label class="field-label" style="margin:0">Sections to include</label>
          <button class="link-btn" id="select-all-btn" type="button">Clear all</button>
        </div>
        <div id="section-list"></div>

        <!-- Variants to document (per-variant tokens). Shown only when the
             Tokens section is checked and the selection is a component set;
             rows are populated in render.ts from the extracted spec. -->
        <div class="variant-picker" id="variant-picker" style="display:none">
          <div class="vp-head">
            <span class="vp-title">VARIANTS TO DOCUMENT</span>
            <button class="link-btn" id="variant-select-all" type="button">Select all</button>
          </div>
          <div id="variant-list"></div>
        </div>

        <!-- Actions, banners, and the inline file-key prompt live in the sticky
             footer below so they're always reachable. extract-btn stays a hidden
             bridge still referenced by render.ts/ui.ts. -->
        <button class="btn" id="extract-btn" style="display:none">Extract spec</button>
      </div>
    </section>

    <!-- ============ Settings panel ============ -->
    <section class="panel" id="tab-panel-settings" role="tabpanel"
             aria-labelledby="tab-settings">
      <div class="stack">
        <div>
          <h2>Write with AI</h2>
          <p class="hint" style="margin-top:4px">
            Add an Anthropic API key to let Claude draft the AI guideline sections. The key is stored locally in this plugin and used only to call Anthropic directly, so usage is billed to your own account.
          </p>
          <label class="field-label" for="anthropic-key-input" style="margin-top:8px">Anthropic API key</label>
          <input type="password" id="anthropic-key-input" placeholder="sk-ant-…" />
          <p class="hint" style="margin-top:6px"><a id="get-key-link">Get an API key from Anthropic ↗</a></p>
        </div>

        <hr />

        <div>
          <h2>Frame colors</h2>
          <p class="hint" style="margin-top:4px">
            Brand colors used in the generated Guidelines frame. Enter a 6-digit hex value, or leave blank to use the default.
          </p>

          <label class="field-label" for="header-color-input" style="margin-top:8px">Header background</label>
          <div class="color-row">
            <span class="color-swatch" id="header-color-swatch"></span>
            <input type="text" id="header-color-input" placeholder="#0d2436" />
          </div>

          <label class="field-label" for="accent-color-input" style="margin-top:10px">Accent</label>
          <div class="color-row">
            <span class="color-swatch" id="accent-color-swatch"></span>
            <input type="text" id="accent-color-input" placeholder="#12b3a6" />
          </div>

          <p class="hint" id="brand-color-hint"></p>
          <p class="hint" style="margin-top:6px"><a id="reset-colors-link">Reset to defaults</a></p>
        </div>
      </div>
    </section>
  </div>

  <!-- Sticky action footer — only shown on the Selected-component tab with a
       component selected (toggled in render.ts/syncFooter). -->
  <div class="footer" id="action-footer" style="display:none">
    <div id="loader" class="loader" role="status" aria-live="polite">
      <span class="loader-icon" aria-hidden="true"></span>
      <span class="loader-body">
        <span class="loader-text" id="loader-text"></span>
        <span class="loader-dots" aria-hidden="true"><span></span><span></span><span></span></span>
      </span>
    </div>
    <div id="banner-info" class="banner info"></div>
    <div id="banner-error" class="banner error"></div>
    <div class="actions">
      <button class="btn btn-secondary" id="download-btn" type="button">Download</button>
      <button class="btn btn-primary" id="create-frame-btn">Create frame</button>
    </div>
  </div>
`;

// ---------------------------------------------------------------------------
// Typed refs
// ---------------------------------------------------------------------------

export interface Refs {
  // Header
  themeBtn: HTMLButtonElement;
  // Tabs
  tabSelected: HTMLButtonElement;
  tabSettings: HTMLButtonElement;
  panelSelected: HTMLElement;
  panelSettings: HTMLElement;
  // Selection / main
  noSelection: HTMLDivElement;
  mainArea: HTMLDivElement;
  componentName: HTMLHeadingElement;
  atomNotice: HTMLDivElement;
  phaseLabel: HTMLSpanElement;
  extractBtn: HTMLButtonElement;
  // Write-with-AI switch
  aiCard: HTMLDivElement;
  aiToggle: HTMLInputElement;
  aiInfoBtn: HTMLButtonElement;
  aiInfo: HTMLDivElement;
  aiNokey: HTMLDivElement;
  aiNokeyLink: HTMLElement;
  // Section checklist + new actions
  sectionList: HTMLDivElement;
  sectionChecks: Record<string, HTMLInputElement>;
  selectAllBtn: HTMLButtonElement;
  // Variant picker (per-variant tokens)
  variantPicker: HTMLDivElement;
  variantList: HTMLDivElement;
  variantSelectAll: HTMLButtonElement;
  createFrameBtn: HTMLButtonElement;
  // Sticky footer
  actionFooter: HTMLDivElement;
  // Banners + generating loader
  bannerInfo: HTMLDivElement;
  bannerError: HTMLDivElement;
  loader: HTMLDivElement;
  loaderText: HTMLSpanElement;
  // Download action
  downloadBtn: HTMLButtonElement;
  // AI settings (Settings tab)
  anthropicKeyInput: HTMLInputElement;
  getKeyLink: HTMLElement;
  // Frame brand colors (Settings tab)
  headerColorInput: HTMLInputElement;
  headerColorSwatch: HTMLSpanElement;
  accentColorInput: HTMLInputElement;
  accentColorSwatch: HTMLSpanElement;
  brandColorHint: HTMLParagraphElement;
  resetColorsLink: HTMLElement;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`dom.mount: missing element #${id}`);
  return el as T;
}

/**
 * Injects the template into document.body and returns the typed refs.
 * Call exactly once on boot.
 */
export function mount(): Refs {
  document.body.innerHTML = TEMPLATE;

  // Build the section checklist from ALL_SECTIONS so the markup stays DRY.
  // Each row gets a checkbox `sec-<id>`, checked by default except `related`,
  // with an inline (AI) badge on AI-generated sections. Must run before we
  // collect the per-checkbox refs below.
  const sectionList = byId<HTMLDivElement>('section-list');
  for (const section of ALL_SECTIONS) {
    const row = document.createElement('div');
    row.className = 'sec-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `sec-${section.id}`;
    input.checked = section.id !== 'related';

    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = section.label;
    if (section.ai) {
      const badge = document.createElement('span');
      badge.className = 'ai-badge';
      badge.textContent = 'AI';
      label.appendChild(badge);
    }

    row.appendChild(input);
    row.appendChild(label);
    sectionList.appendChild(row);
  }

  const sectionChecks: Record<string, HTMLInputElement> = {};
  for (const section of ALL_SECTIONS) {
    sectionChecks[section.id] = byId<HTMLInputElement>(`sec-${section.id}`);
  }

  return {
    themeBtn: byId<HTMLButtonElement>('theme-btn'),
    tabSelected: byId<HTMLButtonElement>('tab-selected'),
    tabSettings: byId<HTMLButtonElement>('tab-settings'),
    panelSelected: byId<HTMLElement>('tab-panel-selected'),
    panelSettings: byId<HTMLElement>('tab-panel-settings'),
    noSelection: byId<HTMLDivElement>('no-selection'),
    mainArea: byId<HTMLDivElement>('main-area'),
    componentName: byId<HTMLHeadingElement>('component-name'),
    atomNotice: byId<HTMLDivElement>('atom-notice'),
    phaseLabel: byId<HTMLSpanElement>('phase-label'),
    extractBtn: byId<HTMLButtonElement>('extract-btn'),
    aiCard: byId<HTMLDivElement>('ai-card'),
    aiToggle: byId<HTMLInputElement>('ai-toggle'),
    aiInfoBtn: byId<HTMLButtonElement>('ai-info-btn'),
    aiInfo: byId<HTMLDivElement>('ai-info'),
    aiNokey: byId<HTMLDivElement>('ai-nokey'),
    aiNokeyLink: byId<HTMLElement>('ai-nokey-link'),
    sectionList,
    sectionChecks,
    selectAllBtn: byId<HTMLButtonElement>('select-all-btn'),
    variantPicker: byId<HTMLDivElement>('variant-picker'),
    variantList: byId<HTMLDivElement>('variant-list'),
    variantSelectAll: byId<HTMLButtonElement>('variant-select-all'),
    createFrameBtn: byId<HTMLButtonElement>('create-frame-btn'),
    actionFooter: byId<HTMLDivElement>('action-footer'),
    bannerInfo: byId<HTMLDivElement>('banner-info'),
    bannerError: byId<HTMLDivElement>('banner-error'),
    loader: byId<HTMLDivElement>('loader'),
    loaderText: byId<HTMLSpanElement>('loader-text'),
    downloadBtn: byId<HTMLButtonElement>('download-btn'),
    anthropicKeyInput: byId<HTMLInputElement>('anthropic-key-input'),
    getKeyLink: byId<HTMLElement>('get-key-link'),
    headerColorInput: byId<HTMLInputElement>('header-color-input'),
    headerColorSwatch: byId<HTMLSpanElement>('header-color-swatch'),
    accentColorInput: byId<HTMLInputElement>('accent-color-input'),
    accentColorSwatch: byId<HTMLSpanElement>('accent-color-swatch'),
    brandColorHint: byId<HTMLParagraphElement>('brand-color-hint'),
    resetColorsLink: byId<HTMLElement>('reset-colors-link'),
  };
}
