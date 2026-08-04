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
 * Auto Docs & Specs Pro license activation used to lift the free-tier AI quota.
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

import { ALL_SECTIONS, GROUPS } from './docModel';

// Sections that start unchecked. Defined in viewModel/componentScreen so the
// legacy UI and the vNext screen cannot drift into different defaults.
import { DEFAULT_OFF_SECTIONS } from './viewModel/componentScreen';
import { THEME_PRESETS, resolveTheme, type CornerStyle } from '../brandColors';

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

    /* ---- Scrollbars ----
       The native scrollbar ignores body[data-theme] and stays OS-light even in
       our dark palette, so we draw our own thin, theme-aware one instead. */
    * {
      scrollbar-width: thin;
      scrollbar-color: var(--figma-color-bg-tertiary) transparent;
    }
    *::-webkit-scrollbar { width: 10px; height: 10px; }
    *::-webkit-scrollbar-track { background: transparent; }
    *::-webkit-scrollbar-thumb {
      background-color: var(--figma-color-bg-tertiary);
      border-radius: 8px;
      border: 2px solid var(--figma-color-bg);
      background-clip: padding-box;
    }
    *::-webkit-scrollbar-thumb:hover {
      background-color: var(--figma-color-text-disabled);
      background-clip: padding-box;
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
    /* Right-aligned icon cluster: website + LinkedIn links, then the theme
       toggle. margin-left:auto pushes the whole group to the tab row's edge. */
    .tab-actions {
      display: flex; align-items: center; gap: 4px;
      flex: 0 0 auto; margin-left: auto;
    }
    /* Cycling light/dark button + the link icons share one look. */
    .theme-btn, .icon-link {
      appearance: none; flex: 0 0 auto; cursor: pointer; text-decoration: none;
      width: 26px; height: 26px; border-radius: 7px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid var(--figma-color-border);
      background: var(--figma-color-bg); color: var(--figma-color-text);
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .theme-btn:hover, .icon-link:hover { background: var(--figma-color-bg-secondary); border-color: var(--figma-color-text-secondary); }
    .theme-btn:focus-visible, .icon-link:focus-visible { outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px; }
    .theme-btn svg, .icon-link svg { width: 15px; height: 15px; display: block; }
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

    .lib-summary { color: var(--figma-color-text-secondary); font-size: 11px; margin: 4px 2px 10px; }
    .lib-empty { color: var(--figma-color-text-secondary); font-size: 12px; padding: 24px 8px; text-align: center; }
    .lib-row { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 6px; cursor: pointer; }
    .lib-row:hover { background: var(--figma-color-bg-hover); }
    .lib-row-main { flex: 1 1 auto; min-width: 0; }
    .lib-row-title { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lib-row-sub { font-size: 11px; color: var(--figma-color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lib-badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; white-space: nowrap; }
    .lib-badge.insync { background: var(--figma-color-bg-success-tertiary, #e6f4ea); color: var(--figma-color-text-success, #1e7a3c); }
    .lib-badge.update { background: var(--figma-color-bg-brand-tertiary, #e8f0fe); color: var(--figma-color-text-brand, #1a56db); }
    .lib-badge.edited { background: var(--figma-color-bg-warning-tertiary, #fef7e0); color: var(--figma-color-text-warning, #9a6700); }
    .lib-badge.orphaned { background: var(--figma-color-bg-danger-tertiary, #fce8e6); color: var(--figma-color-text-danger, #b3261e); }
    .lib-badge.checking { background: var(--figma-color-bg-secondary); color: var(--figma-color-text-secondary); }
    .lib-menu-btn { flex: 0 0 auto; border: none; background: transparent; cursor: pointer; padding: 4px 6px; border-radius: 4px; color: var(--figma-color-text-secondary); }
    .lib-menu-btn:hover { background: var(--figma-color-bg-secondary); }
    /* Inline shortcut for the primary action, shown only when a doc is out of
       date. Inherits .btn .btn-secondary; just more compact for the row. */
    .lib-update-inline.btn { flex: 0 0 auto; font-size: 11px; padding: 4px 10px; }
    /* Overflow menu popover: one shared element, positioned on open (ui.ts). */
    .lib-menu {
      position: fixed; z-index: 20; min-width: 150px;
      background: var(--figma-color-bg);
      border: 1px solid var(--figma-color-border);
      border-radius: 8px; padding: 4px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
    }
    .lib-menu[hidden] { display: none; }
    .lib-menu button {
      display: block; width: 100%; text-align: left;
      border: none; background: transparent; cursor: pointer;
      font-size: 12px; color: var(--figma-color-text);
      padding: 7px 10px; border-radius: 6px; line-height: 1;
    }
    .lib-menu button:hover { background: var(--figma-color-bg-secondary); }
    .lib-menu button.danger { color: var(--figma-color-text-danger, #b3261e); }
    .lib-menu button.danger:hover { background: var(--figma-color-bg-danger-tertiary, #fce8e6); }
    .lib-menu hr { border: none; border-top: 1px solid var(--figma-color-border); margin: 4px 0; }

    /* ---- Foundations tab ----
       Rows are the same two-line shape as a My Library row (title + muted meta)
       and share the Selected tab's checkbox, so the three checklists in the
       plugin read as one control rather than three. */
    #foundation-list { display: flex; flex-direction: column; gap: 4px; }
    .foundation-row {
      border: 1px solid var(--figma-color-border); border-radius: 8px;
      padding: 9px 10px; background: var(--figma-color-bg);
      transition: border-color 0.12s ease, background 0.12s ease;
    }
    .foundation-row:hover { border-color: var(--figma-color-text-secondary); }
    /* A selected source reads as selected without relying on the box alone. */
    .foundation-row.on { background: var(--figma-color-bg-secondary); }
    .foundation-row > label {
      display: flex; align-items: flex-start; gap: 9px; cursor: pointer;
    }
    .foundation-main { flex: 1 1 auto; min-width: 0; }
    .foundation-title {
      font-size: 12px; font-weight: 600; line-height: 1.35;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .foundation-meta {
      font-size: 11px; color: var(--figma-color-text-secondary); line-height: 1.4;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    /* Mode pills, indented to sit under the title rather than the checkbox. */
    .foundation-modes {
      margin: 8px 0 0 24px; display: flex; flex-wrap: wrap; gap: 5px;
    }
    .foundation-modes label {
      display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
      font-size: 11px; padding: 3px 8px 3px 6px; border-radius: 999px;
      border: 1px solid var(--figma-color-border);
      background: var(--figma-color-bg);
      transition: border-color 0.12s ease, background 0.12s ease;
    }
    .foundation-modes label:hover { border-color: var(--figma-color-text-secondary); }
    .foundation-modes label.on {
      border-color: var(--figma-color-bg-brand);
      background: var(--figma-color-bg-brand-tertiary, var(--figma-color-bg-secondary));
    }
    /* A mode cannot be picked until its collection is, so the whole pill reads
       as unavailable rather than just its box. */
    .foundation-modes label.off { opacity: 0.45; cursor: default; }
    .foundation-modes input[type="checkbox"] { width: 13px; height: 13px; border-radius: 3px; }
    .foundation-modes input[type="checkbox"]:checked::after { left: 3.5px; top: 1px; width: 3.5px; height: 7px; }
    .foundation-cap { margin: 6px 0 0 24px; }

    /* AI group descriptions opt-in. Shares the AI card's look so it reads as the
       same kind of control as "Write with AI" on the Selected tab. */
    .found-ai {
      margin-top: 10px; padding: 10px 12px; border-radius: 8px;
      background: var(--figma-color-bg-secondary);
      border: 1px solid var(--figma-color-border);
    }
    .found-ai[hidden] { display: none; }
    .found-ai-row { display: flex; align-items: flex-start; gap: 9px; cursor: pointer; }
    .found-ai-row > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .found-ai-title { font-size: 12px; font-weight: 600; }
    .found-ai .hint { margin: 0; }
    .found-ai input[type="checkbox"] {
      appearance: none; -webkit-appearance: none; margin: 0; margin-top: 1px;
      width: 15px; height: 15px; flex: 0 0 auto; position: relative; cursor: pointer;
      border: 1.5px solid var(--figma-color-border); border-radius: 4px;
      background: var(--figma-color-bg);
    }
    .found-ai input[type="checkbox"]:hover { border-color: var(--figma-color-bg-brand); }
    .found-ai input[type="checkbox"]:checked {
      background: var(--figma-color-bg-brand); border-color: var(--figma-color-bg-brand);
    }
    .found-ai input[type="checkbox"]:checked::after {
      content: ""; position: absolute; left: 4.5px; top: 1.5px;
      width: 4px; height: 8px; box-sizing: border-box;
      border: solid var(--figma-color-text-onbrand); border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .found-ai input[type="checkbox"]:focus-visible {
      outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px;
    }

    /* Loading skeleton, shown while the file's variables and styles are read.
       Three rows the same height as real ones, so the panel does not jump when
       the data lands. */
    #foundation-skeleton { display: flex; flex-direction: column; gap: 4px; }
    #foundation-skeleton[hidden] { display: none; }
    .skel-row {
      display: flex; align-items: center; gap: 9px;
      border: 1px solid var(--figma-color-border); border-radius: 8px;
      padding: 9px 10px;
    }
    .skel { position: relative; overflow: hidden; border-radius: 4px; background: var(--figma-color-bg-secondary); }
    .skel::after {
      content: ""; position: absolute; inset: 0; transform: translateX(-100%);
      /* bg-tertiary, not bg-hover: this palette does not define bg-hover, and an
         undefined var in a gradient voids the whole declaration, which left the
         sweep invisible and the skeleton looking like three dead grey bars. */
      background: linear-gradient(90deg, transparent, var(--figma-color-bg-tertiary), transparent);
      animation: skel-sweep 1.5s ease-in-out infinite;
    }
    @keyframes skel-sweep { to { transform: translateX(100%); } }
    .skel-box { width: 15px; height: 15px; flex: 0 0 auto; border-radius: 4px; }
    .skel-lines { flex: 1 1 auto; display: flex; flex-direction: column; gap: 5px; }
    .skel-line { height: 9px; }
    .skel-line.short { width: 42%; }
    .skel-line.mid { width: 66%; }
    @media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }

    .footer-row { margin-top: 14px; }
    .footer-row .btn { width: 100%; }

    /* ---- Typography / layout ---- */
    h2 { font-size: 13px; font-weight: 600; margin: 0; }
    .muted { color: var(--figma-color-text-secondary); }
    .hint { font-size: 11px; color: var(--figma-color-text-secondary); margin: 4px 0 0; }
    .hint a { color: var(--figma-color-bg-brand); cursor: pointer; }
    .hint a:hover { text-decoration: underline; }
    /* License action links laid out in one horizontal row (Get Pro / Renew Pro
       share a slot with Manage subscription); wraps if the panel is narrow. */
    .license-links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
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
    .color-row input[type="text"] { flex: 1; min-width: 0; }
    /* Four color fields in a 2x2 grid. min-width:0 lets the hex inputs shrink
       inside their grid cells instead of overflowing. */
    .color-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 8px; margin-top: 8px; }
    .color-field { min-width: 0; }

    /* ---- License activation row (Settings tab) ---- */
    .license-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    .license-row input { flex: 1; }
    /* Box-sizing is border-box globally, so a shared height keeps the input and
       the filled Activate button the same size instead of the button sitting
       proud of the field. */
    .license-row input, .license-row .btn { height: 34px; }
    .color-swatch {
      flex: 0 0 auto; width: 26px; height: 26px; border-radius: 7px;
      border: 1px solid var(--figma-color-border); background: #0f172a;
    }

    /* ---- Theme presets (frame theme) ----
       A compact row of preset cards plus a trailing "Custom" card. Each preset
       card previews its theme: a band in the header color with the accent dot
       and an "Ag" specimen in an approximate font stack. The card's own border
       radius mirrors the preset's corner style (set inline in mount()). Exactly
       one card is always active: the matching preset, or Custom when the theme
       has been edited away from every preset (see renderBrandTheme). */
    .preset-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: 6px; margin-top: 8px;
    }
    .preset-card {
      position: relative; display: flex; flex-direction: column; gap: 4px; padding: 3px 3px 4px;
      border: 1px solid var(--figma-color-border); background: var(--figma-color-bg);
      font-family: inherit; text-align: left; cursor: pointer;
      transition: border-color 0.12s ease, box-shadow 0.12s ease;
    }
    .preset-card:hover { border-color: var(--figma-color-bg-brand); }
    .preset-card:focus-visible { outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px; }
    .preset-card.active {
      border-color: var(--figma-color-bg-brand);
      box-shadow: 0 0 0 1px var(--figma-color-bg-brand);
    }
    .preset-band {
      position: relative; display: flex; align-items: center; justify-content: center;
      height: 24px;
    }
    .preset-ag { color: #ffffff; font-size: 12px; font-weight: 600; line-height: 1; }
    .preset-dot { position: absolute; right: 4px; bottom: 4px; width: 7px; height: 7px; border-radius: 50%; }
    .preset-name {
      font-size: 10px; font-weight: 500; color: var(--figma-color-text);
      padding: 0 1px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    /* Checkmark badge on the active card. */
    .preset-check {
      display: none; position: absolute; top: -6px; right: -6px;
      width: 15px; height: 15px; border-radius: 50%;
      background: var(--figma-color-bg-brand); color: var(--figma-color-text-onbrand);
      align-items: center; justify-content: center;
    }
    .preset-check svg { width: 9px; height: 9px; display: block; }
    .preset-card.active .preset-check { display: flex; }
    /* The Custom card has no palette to preview: a neutral band with a small
       sliders glyph reads as "your own mix". */
    .preset-card.custom .preset-band { background: var(--figma-color-bg-secondary); }
    .preset-card.custom .preset-band svg {
      width: 14px; height: 14px; color: var(--figma-color-text-secondary); display: block;
    }

    /* ---- Customize subheading (frame theme) ---- */
    h3.customize-heading {
      font-size: 10px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--figma-color-text-secondary);
      margin: 16px 0 8px;
    }

    /* ---- Font pickers (frame theme) ----
       Searchable combobox: a text input plus an absolutely positioned menu.
       Only families with Regular+Medium+Bold are listed (filtered on the
       main thread); typing filters, arrows navigate, Enter/click commits. */
    /* Heading + body pickers sit side by side, matching the color grid. */
    .font-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 8px; margin-top: 12px; }
    .font-field { min-width: 0; }
    .font-picker { position: relative; }
    /* position: fixed (top/left/width/max-height set in fontPicker.ts) so the
       menu escapes the settings panel's overflow clipping and flips above the
       input when it would otherwise run past the window's bottom edge. */
    .font-menu {
      position: fixed; z-index: 20;
      max-height: 190px; overflow-y: auto; padding: 4px;
      background: var(--figma-color-bg); border: 1px solid var(--figma-color-border);
      border-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    }
    .font-option { padding: 6px 8px; border-radius: 5px; font-size: 12px; cursor: pointer; }
    .font-option:hover, .font-option.active { background: var(--figma-color-bg-secondary); }
    .font-option.default { color: var(--figma-color-text-secondary); }

    /* ---- Logo row (frame theme) ---- */
    /* Logo gets its own labelled section, separated from the fonts above. */
    .logo-label { margin-top: 16px; }
    .logo-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .logo-row img {
      border: 1px solid var(--figma-color-border); border-radius: 4px;
      background: var(--figma-color-bg-secondary);
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
    /* ---- Custom checkbox (section checklist, variant picker, foundations) ----
       Native checkboxes render inconsistently across platforms and ignore most
       theming; appearance:none lets us draw a Figma-style box + CSS checkmark
       that tracks the theme tokens. Scoped to the rows that want it, so the AI
       switch (a visually-hidden checkbox) is untouched. */
    .sec-row input[type="checkbox"],
    .foundation-row input[type="checkbox"] {
      appearance: none; -webkit-appearance: none; margin: 0;
      width: 15px; height: 15px; flex: 0 0 auto; position: relative; cursor: pointer;
      border: 1.5px solid var(--figma-color-border); border-radius: 4px;
      background: var(--figma-color-bg);
      transition: background 0.1s ease, border-color 0.1s ease;
    }
    .sec-row input[type="checkbox"]:hover,
    .foundation-row input[type="checkbox"]:hover { border-color: var(--figma-color-bg-brand); }
    .sec-row input[type="checkbox"]:checked,
    .foundation-row input[type="checkbox"]:checked {
      background: var(--figma-color-bg-brand); border-color: var(--figma-color-bg-brand);
    }
    /* CSS checkmark: a rotated rectangle with two borders. */
    .sec-row input[type="checkbox"]:checked::after,
    .foundation-row input[type="checkbox"]:checked::after {
      content: ""; position: absolute; left: 4.5px; top: 1.5px;
      width: 4px; height: 8px; box-sizing: border-box;
      border: solid var(--figma-color-text-onbrand); border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .sec-row input[type="checkbox"]:focus-visible,
    .foundation-row input[type="checkbox"]:focus-visible {
      outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px;
    }

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
      position: relative;
      display: flex; flex-direction: column; gap: 10px;
      padding: 11px 13px; border-radius: 10px; margin-top: 12px;
      background: var(--figma-color-bg-secondary); border: 1px solid var(--figma-color-border);
    }
    /* Title + info on the left, toggle pushed to the right edge of the row. */
    .ai-head { display: flex; align-items: center; gap: 5px; }
    .ai-head .switch { margin-left: auto; }
    .info-wrap { display: inline-flex; align-items: center; }
    .ai-card .ai-title { font-size: 12px; font-weight: 600; }
    /* Info hint: the ⓘ button reveals the .ai-info popover on hover / focus.
       The popover is absolutely positioned against .ai-card, so it overlays
       rather than expanding the card. */
    .info-btn {
      appearance: none; border: none; background: none; cursor: help; padding: 0;
      width: 16px; height: 16px; flex: 0 0 auto;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--figma-color-text-secondary); transition: color 0.12s ease;
    }
    .info-btn:hover, .info-btn:focus-visible { color: var(--figma-color-bg-brand); }
    .info-btn svg { width: 14px; height: 14px; display: block; }
    .info-btn:focus-visible { outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px; border-radius: 50%; }
    .ai-info {
      position: absolute; top: 40px; left: 13px; right: 13px; z-index: 20;
      padding: 9px 11px; border-radius: 8px;
      background: var(--figma-color-bg); border: 1px solid var(--figma-color-border);
      font-size: 11px; color: var(--figma-color-text-secondary); line-height: 1.5;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: opacity 0.12s ease, visibility 0.12s ease;
    }
    .info-wrap:hover .ai-info,
    .info-btn:focus-visible + .ai-info { opacity: 1; visibility: visible; }
    .ai-info p { margin: 0; }
    .ai-info p + p { margin-top: 6px; }
    .ai-info a, .ai-nokey a { color: var(--figma-color-bg-brand); cursor: pointer; }
    /* Shown whenever no key is set (incl. first run) — informational, not an error. */
    .ai-nokey { font-size: 11px; color: var(--figma-color-text-secondary); }
    .switch { position: relative; width: 36px; height: 20px; flex: 0 0 auto; }
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

    /* ---- Quota meter (inside the AI card) ---- */
    .quota-meter { display: flex; flex-direction: column; gap: 6px; }
    .quota-meter[hidden] { display: none; }
    .quota-bar {
      height: 4px; border-radius: 999px; overflow: hidden;
      background: var(--figma-color-bg-tertiary);
    }
    .quota-bar > span {
      display: block; height: 100%; border-radius: 999px;
      background: var(--figma-color-bg-brand); transition: width .18s ease;
    }
    .quota-meter.low .quota-bar > span,
    .quota-meter.exhausted .quota-bar > span { background: var(--figma-color-bg-warning); }
    .quota-meter.pro .quota-bar { display: none; }
    .quota-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    /* Count takes the slack and truncates rather than wrapping, so the foot is
       always exactly one line tall — the block height never shifts between the
       "N of M left" and "0 left · resets …" states. */
    .quota-countwrap { display: inline-flex; align-items: center; gap: 5px; flex: 1 1 auto; min-width: 0; }
    .quota-check { display: none; width: 13px; height: 13px; flex: 0 0 auto; color: var(--figma-color-bg-brand); }
    .quota-meter.pro .quota-check { display: block; }
    .quota-count {
      font-size: 11px; color: var(--figma-color-text-secondary); font-variant-numeric: tabular-nums;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
    }
    .quota-meter.low .quota-count,
    .quota-meter.exhausted .quota-count { color: var(--figma-color-text-warning); }
    /* Both links sit together on the right; never shrink or wrap. */
    .quota-links { display: inline-flex; align-items: center; gap: 12px; flex: 0 0 auto; }
    .quota-upgrade, .quota-activate {
      appearance: none; background: none; border: none; cursor: pointer; padding: 0;
      font-family: inherit; font-size: 11px; white-space: nowrap;
    }
    .quota-upgrade { color: var(--figma-color-bg-brand); }
    .quota-activate { color: var(--figma-color-text-secondary); }
    .quota-upgrade:hover, .quota-activate:hover { text-decoration: underline; }
    .quota-upgrade[hidden], .quota-activate[hidden] { display: none; }
    .quota-upgrade:focus-visible, .quota-activate:focus-visible {
      outline: 2px solid var(--figma-color-bg-brand); outline-offset: 2px; border-radius: 3px;
    }

    /* ---- Section header + checklist ---- */
    .section-head { display: flex; align-items: center; justify-content: space-between; margin: 16px 0 6px; }
    /* An author display declaration beats the UA rule for [hidden], so hiding
       one of these with the attribute alone does nothing. */
    .section-head[hidden] { display: none; }
    .link-btn {
      appearance: none; background: none; border: none; cursor: pointer; padding: 0;
      font-family: inherit; font-size: 11px; color: var(--figma-color-bg-brand);
    }
    .link-btn:hover { text-decoration: underline; }
    .link-btn:disabled { color: var(--figma-color-text-disabled); cursor: default; text-decoration: none; }
    /* Single column: each row can now carry an inline disclosure area beneath
       it (anatomy/measure options, states note), which a 2-column grid can't
       accommodate without the options spanning oddly across the gutter. */
    #section-list { display: flex; flex-direction: column; gap: 1px; }
    .sec-row {
      display: flex; align-items: center; gap: 8px; font-size: 12px;
      padding: 6px 8px; border-radius: 6px;
    }
    .sec-row:hover { background: var(--figma-color-bg-secondary); }
    .sec-row label { cursor: pointer; flex: 1; }
    #section-list.ai-dim .ai-badge { opacity: 0.4; }

    /* ---- Section groups (Usage / Specifications / Accessibility) ---- */
    .sec-groupbox { border: 1px solid var(--figma-color-border); border-radius: 10px; margin-bottom: 8px; overflow: hidden; }
    .sec-grouphead { display: flex; align-items: center; gap: 8px; padding: 9px 10px; cursor: pointer; user-select: none; background: var(--figma-color-bg-secondary); }
    .sec-grouphead:hover { background: var(--figma-color-bg-tertiary); }
    .sec-grouphead .chev { flex: 0 0 auto; width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; color: var(--figma-color-text-secondary); transition: transform .16s ease; }
    .sec-groupbox.collapsed .chev { transform: rotate(-90deg); }
    .group-name { flex: 1; font-weight: 600; font-size: 12px; }
    .group-count { font-size: 10.5px; color: var(--figma-color-text-secondary); background: var(--figma-color-bg); border: 1px solid var(--figma-color-border); border-radius: 999px; padding: 1px 7px; }
    .sec-groupbody { padding: 4px 6px 6px; }
    .sec-groupbox.collapsed .sec-groupbody { display: none; }
    /* indeterminate master checkbox: a horizontal bar */
    .sec-grouphead input.group-check { appearance: none; -webkit-appearance: none; margin: 0; width: 15px; height: 15px; flex: 0 0 auto; position: relative; cursor: pointer; border: 1.5px solid var(--figma-color-border); border-radius: 4px; background: var(--figma-color-bg); }
    .sec-grouphead input.group-check:hover { border-color: var(--figma-color-bg-brand); }
    .sec-grouphead input.group-check:checked, .sec-grouphead input.group-check:indeterminate { background: var(--figma-color-bg-brand); border-color: var(--figma-color-bg-brand); }
    .sec-grouphead input.group-check:checked::after { content: ""; position: absolute; left: 4.5px; top: 1.5px; width: 4px; height: 8px; box-sizing: border-box; border: solid var(--figma-color-text-onbrand); border-width: 0 2px 2px 0; transform: rotate(45deg); }
    .sec-grouphead input.group-check:indeterminate::after { content: ""; position: absolute; left: 3px; top: 6px; width: 7px; border-top: 2px solid var(--figma-color-text-onbrand); }
    .sec-grouphead input.group-check:focus-visible { outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px; }

    /* ---- Measure setup (lens checkboxes) ----
       Each lens (size/padding/spacing) renders as its own focused mini-diagram. */
    .measure-setup {
      display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px;
      margin: 2px 0 6px 27px; padding-left: 10px;
      border-left: 1px solid var(--figma-color-border);
      font-size: 11px; color: var(--figma-color-text-secondary);
    }
    .measure-setup-label { flex: 0 0 auto; }
    .measure-setup label {
      display: inline-flex; align-items: center; gap: 4px; cursor: pointer;
    }
    .measure-setup input[type="checkbox"] {
      appearance: none; -webkit-appearance: none; margin: 0;
      width: 13px; height: 13px; flex: 0 0 auto; position: relative; cursor: pointer;
      border: 1.5px solid var(--figma-color-border); border-radius: 4px;
      background: var(--figma-color-bg);
      transition: background 0.1s ease, border-color 0.1s ease;
    }
    .measure-setup input[type="checkbox"]:hover { border-color: var(--figma-color-bg-brand); }
    .measure-setup input[type="checkbox"]:checked {
      background: var(--figma-color-bg-brand); border-color: var(--figma-color-bg-brand);
    }
    .measure-setup input[type="checkbox"]:checked::after {
      content: ""; position: absolute; left: 3.5px; top: 1px;
      width: 4px; height: 8px; box-sizing: border-box;
      border: solid var(--figma-color-text-onbrand); border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .measure-setup input[type="checkbox"]:focus-visible {
      outline: 2px solid var(--figma-color-bg-brand); outline-offset: 1px;
    }

    /* ---- Variant picker (per-variant tokens) ----
       Collapsed-by-default summary card: .vp-head is a full-width button that
       toggles #variant-body (the "Select all" action + scrollable list). Gated
       on the Tokens checkbox (see renderVariantPicker): unchecked mutes the
       whole card and swaps the hint for an actionable link. */
    .variant-picker {
      margin-top: 12px; padding: 12px 13px; border-radius: 10px;
      background: var(--figma-color-bg-secondary); border: 1px solid var(--figma-color-border);
      transition: opacity 0.12s ease;
    }
    .variant-picker.disabled { opacity: 0.5; }
    .vp-head {
      display: flex; align-items: center; justify-content: space-between;
      width: 100%; appearance: none; border: none; background: none; cursor: pointer;
      padding: 0; font-family: inherit; color: inherit; text-align: left;
    }
    .vp-title { font-size: 12px; font-weight: 600; color: var(--figma-color-text); }
    .vp-count { font-weight: 400; color: var(--figma-color-text-secondary); }
    .vp-head svg {
      width: 14px; height: 14px; flex: 0 0 auto; color: var(--figma-color-text-secondary);
      transition: transform 0.12s ease;
    }
    .vp-head[aria-expanded="true"] svg { transform: rotate(180deg); }
    .vp-hint {
      font-size: 11px; color: var(--figma-color-text-secondary); margin: 4px 0 0;
    }
    .vp-hint-link { color: var(--figma-color-bg-brand); cursor: pointer; }
    .vp-hint-link:hover { text-decoration: underline; }
    .vp-body { margin-top: 8px; }
    .vp-body[hidden] { display: none; }
    .vp-body #variant-select-all { display: block; margin-bottom: 6px; }
    #variant-list {
      display: flex; flex-direction: column; gap: 3px;
      max-height: 300px; overflow-y: auto;
    }
    /* Each variant is a raised tile on the card; the active state is carried by
       the checkbox, with a faint brand outline on the selected rows. */
    #variant-list .variant-row {
      align-items: flex-start; padding: 8px 9px; background: var(--figma-color-bg);
      border: 1px solid var(--figma-color-border);
    }
    #variant-list .variant-row:hover { background: var(--figma-color-bg-tertiary); }
    #variant-list .variant-row:has(input:checked) { border-color: var(--figma-color-bg-brand); }
    #variant-list .variant-row input[type="checkbox"] { margin-top: 1px; }
    /* The label wraps the value chips; clicking anywhere on it toggles the row. */
    .variant-label { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .variant-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    /* Value chip (enum axis value) vs flag chip (an active boolean modifier). */
    .variant-chip {
      font-size: 11px; line-height: 1.6; padding: 0 7px; border-radius: 5px;
      background: var(--figma-color-bg-tertiary); color: var(--figma-color-text);
    }
    /* Muted axis-name prefix inside a value chip, e.g. "Size" before "Small". */
    .variant-chip .vc-axis { color: var(--figma-color-text-secondary); margin-right: 5px; }
    #variant-list .variant-row:hover .variant-chip { background: var(--figma-color-bg-secondary); }
    .variant-chip.flag {
      background: transparent; border: 1px solid var(--figma-color-border);
      color: var(--figma-color-text-secondary); padding: 0 6px;
    }
    .variant-chip.muted { background: transparent; color: var(--figma-color-text-secondary); font-style: italic; }

    /* ---- Action buttons ---- */
    .actions { display: flex; gap: 8px; margin-top: 16px; }
    .actions > .btn { flex: 1; }
    /* Author rule needed so [hidden] beats the .actions display:flex above. */
    .actions[hidden] { display: none; }

    /* ---- Sticky action footer (Selected-component tab) ---- */
    .footer {
      flex: 0 0 auto; padding: 12px; background: var(--figma-color-bg);
      border-top: 1px solid var(--figma-color-border);
    }
    .footer .actions { margin-top: 0; }
    .footer .banner { margin-bottom: 8px; }
    #upsell { padding: 8px 0; }
    #upsell .upsell-text { margin: 0 0 8px; font-size: 11px; color: var(--figma-color-text-warning); }

    /* ---- Button tooltip (footer Download) ----
       CSS-only bubble shown on hover / keyboard focus, sitting above the
       button. The footer is a flex sibling of .content (not nested inside it)
       and body overflow is visible, so the bubble escapes upward without
       clipping. Anchored to the button's left edge and extending right so it
       stays inside the panel even for the left-hand button. ~300ms show delay
       keeps it from flickering during ordinary clicking. */
    .btn[data-tooltip] { position: relative; }
    .btn[data-tooltip]::after {
      content: attr(data-tooltip);
      position: absolute;
      left: 0; bottom: calc(100% + 8px);
      width: 200px; padding: 7px 9px;
      border-radius: 8px;
      background: var(--figma-color-bg-inverse, #1e1e1e);
      color: var(--figma-color-text-oninverse, #fff);
      font-size: 11px; line-height: 1.4; font-weight: 400;
      text-align: left; white-space: normal;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
      opacity: 0; transform: translateY(4px);
      pointer-events: none;
      transition: opacity 80ms ease, transform 80ms ease;
      transition-delay: 0s;
      z-index: 30;
    }
    .btn[data-tooltip]:hover::after,
    .btn[data-tooltip]:focus-visible::after {
      opacity: 1; transform: translateY(0);
      transition-delay: 300ms;
    }

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
    <button class="tab" id="tab-library" role="tab" aria-selected="false"
            aria-controls="tab-panel-library">My Library</button>
    <button class="tab" id="tab-foundations" role="tab" aria-selected="false"
            aria-controls="tab-panel-foundations">Foundations</button>
    <button class="tab" id="tab-settings" role="tab" aria-selected="false"
            aria-controls="tab-panel-settings">Settings</button>
    <div class="tab-actions">
      <a class="icon-link" id="site-link" href="#" target="_blank" rel="noopener"
         title="spec-layer.com" aria-label="Visit spec-layer.com">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      </a>
      <a class="icon-link" id="linkedin-link" href="#" target="_blank" rel="noopener"
         title="LinkedIn" aria-label="Alex Kurchev on LinkedIn">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z"/></svg>
      </a>
      <button class="theme-btn" id="theme-btn" type="button" title="Theme"
              aria-label="Toggle light/dark theme"></button>
    </div>
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
          <div class="ai-head">
            <span class="ai-title">Write with AI</span>
            <span class="info-wrap">
              <button class="info-btn" id="ai-info-btn" type="button"
                      aria-label="About Write with AI" aria-describedby="ai-info">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>
                </svg>
              </button>
              <div class="ai-info" id="ai-info" role="tooltip">
                <p>AI turns a bare component into docs a teammate can actually use. It reads what Auto Docs & Specs pulls from your file (the variants, states, tokens, and layout) and works out the intent behind them: what the component is for, when to reach for each option, and the accessibility and content details that are easy to forget.</p>
                <p>The measurable parts always come straight from Figma, so your specs stay accurate whether AI is on or off. AI just adds the written layer on top. Turn it off and those written sections wait for you as editable placeholders.</p>
              </div>
            </span>
            <label class="switch">
              <input type="checkbox" id="ai-toggle" />
              <span class="track"></span>
            </label>
          </div>
          <div id="quota-meter" class="quota-meter" hidden>
            <div class="quota-bar"><span id="quota-bar-fill"></span></div>
            <div class="quota-foot">
              <span class="quota-countwrap">
                <svg class="quota-check" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
                <span id="quota-count" class="quota-count"></span>
              </span>
              <span class="quota-links">
                <button id="quota-activate" class="quota-activate" type="button">Activate license</button>
                <button id="quota-upgrade" class="quota-upgrade" type="button">Upgrade</button>
              </span>
            </div>
          </div>
          <div class="ai-nokey" id="ai-nokey" style="display:none">
            AI works on the free plan. No key needed.
          </div>
        </div>

        <!-- Section checklist: which guideline sections to include. Rows are
             generated in mount() from ALL_SECTIONS so the markup stays DRY;
             #section-list is the injection target. -->
        <div class="section-head">
          <label class="field-label" style="margin:0">Sections to include</label>
          <button class="link-btn" id="select-all-btn" type="button">Clear all</button>
        </div>
        <div id="section-list"></div>

        <!-- Measure setup: which measurement lenses to render. Each checked lens
             becomes its own focused mini-diagram in a wrapping row. Only relevant
             (and shown) while the Measurements section is checked; visibility is
             wired in ui.ts alongside the sec-measurements checkbox. -->
        <div class="measure-setup" id="measure-setup" style="display:none">
          <span class="measure-setup-label">Measure</span>
          <label><input type="checkbox" name="measure-view" value="size" checked> Height &amp; width</label>
          <label><input type="checkbox" name="measure-view" value="padding" checked> Inner padding</label>
          <label><input type="checkbox" name="measure-view" value="spacing" checked> Children &amp; spacing</label>
        </div>

        <!-- Variants to document (per-variant tokens). Shown whenever the spec
             has variant instances (see renderVariantPicker); gated on the
             Tokens checkbox via the .disabled class + hint link rather than
             visibility, so the card stays a stable landmark. Collapsed by
             default — the header button toggles #variant-body. Rows are
             populated in render.ts from the extracted spec. -->
        <div class="variant-picker" id="variant-picker" style="display:none">
          <button class="vp-head" id="variant-toggle" type="button"
                  aria-expanded="false" aria-controls="variant-body">
            <span class="vp-title">Variants to document <span class="vp-count" id="variant-count"></span></span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          <div class="vp-hint" id="variant-hint">Applies to the Tokens section</div>
          <div class="vp-body" id="variant-body" hidden>
            <button class="link-btn" id="variant-select-all" type="button">Select all</button>
            <div id="variant-list"></div>
          </div>
        </div>

        <!-- Actions, banners, and the inline file-key prompt live in the sticky
             footer below so they're always reachable. extract-btn stays a hidden
             bridge still referenced by render.ts/ui.ts. -->
        <button class="btn" id="extract-btn" style="display:none">Extract spec</button>
      </div>
    </section>

    <!-- ============ My Library panel ============ -->
    <section class="panel" id="tab-panel-library" role="tabpanel"
             aria-labelledby="tab-library">
      <p class="lib-summary" id="lib-summary"></p>
      <div class="lib-empty" id="lib-empty" style="display:none">
        No connected docs yet. Generate one from the Selected component tab.
      </div>
      <div class="lib-list" id="lib-list"></div>
      <div class="lib-menu" id="lib-menu" role="menu" hidden></div>
    </section>

    <!-- ============ Foundations panel ============ -->
    <section class="panel" id="tab-panel-foundations" role="tabpanel"
             aria-labelledby="tab-foundations">
      <p class="hint" id="foundation-summary" style="margin-top:0">Reading this file's variables and styles.</p>
      <div id="foundation-notes"></div>

      <div class="section-head" id="foundation-head" hidden>
        <label class="field-label" style="margin:0">Include in the docs</label>
        <button class="link-btn" id="foundation-toggle-all" type="button">Clear all</button>
      </div>


      <!-- Placeholder rows while the file is read. Same height as real rows, so
           the panel does not jump when the data lands. -->
      <div id="foundation-skeleton" aria-hidden="true">
        <div class="skel-row">
          <span class="skel skel-box"></span>
          <span class="skel-lines"><span class="skel skel-line short"></span><span class="skel skel-line mid"></span></span>
        </div>
        <div class="skel-row">
          <span class="skel skel-box"></span>
          <span class="skel-lines"><span class="skel skel-line mid"></span><span class="skel skel-line short"></span></span>
        </div>
        <div class="skel-row">
          <span class="skel skel-box"></span>
          <span class="skel-lines"><span class="skel skel-line short"></span><span class="skel skel-line mid"></span></span>
        </div>
      </div>

      <div id="foundation-list"></div>

      <!-- Opt-in, and default off: it spends an AI generation from the quota, so
           it is not something a user should discover having already paid for. -->
      <div class="found-ai" id="foundation-ai-card" hidden>
        <label class="found-ai-row">
          <input type="checkbox" id="foundation-ai" />
          <span>
            <span class="found-ai-title">Describe each colour group with AI</span>
            <span class="hint" id="foundation-ai-hint">
              Adds a sentence under each group heading. Sends the group's token
              names and resolved values to Spec Layer's AI service, and uses one
              generation from your monthly allowance for the whole build.
            </span>
          </span>
        </label>
      </div>
      <div class="footer-row">
        <!-- Outcome of the last build. Deliberately NOT #foundation-notes: that
             div is rebuilt on every repaint, and the repaint that follows a
             finished build used to wipe the result before the user could read
             it. -->
        <div id="foundation-result" class="banner info" role="status" aria-live="polite"></div>
        <div id="foundation-loader" class="loader" role="status" aria-live="polite">
          <span class="loader-icon" aria-hidden="true"></span>
          <span class="loader-body">
            <span class="loader-text" id="foundation-loader-text"></span>
            <span class="loader-dots" aria-hidden="true"><span></span><span></span><span></span></span>
          </span>
        </div>
        <button class="btn btn-primary" id="foundation-create" disabled>Create foundation frames</button>
      </div>
    </section>

    <!-- ============ Settings panel ============ -->
    <section class="panel" id="tab-panel-settings" role="tabpanel"
             aria-labelledby="tab-settings">
      <div class="stack">
        <div>
          <h2>Auto Docs & Specs Pro</h2>
          <p class="hint" style="margin-top:4px">
            The free plan includes monthly AI generations, no setup needed.
            Pro lifts that limit for heavier use. Paste the license key from
            your purchase email to switch it on.
          </p>
          <div class="license-row">
            <input type="password" id="license-key-input" placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" />
            <button class="btn btn-primary" id="license-activate-btn" type="button">Activate</button>
          </div>
          <p class="hint" id="license-status" style="margin-top:6px" aria-live="polite"></p>
          <div class="hint license-links" style="margin-top:6px">
            <span id="license-getpro-row" hidden><a id="get-pro-link" href="#" target="_blank">Get Pro</a></span>
            <span id="license-renew-row" hidden><a id="renew-link" href="#" target="_blank">Renew Pro</a></span>
            <a id="manage-sub-link" href="#" target="_blank">Manage subscription</a>
          </div>
          <p class="hint" id="license-remove-row" hidden style="margin-top:6px"><a id="remove-key-link" href="#">Remove key from this device</a></p>
        </div>

        <hr />

        <div class="settings-group" id="theme-group" style="padding-bottom:12px">
          <h2>Frame theme</h2>
          <p class="hint" style="margin-top:4px">
            Pick a theme for the generated Guidelines frame, or adjust any value below.
          </p>

          <div class="preset-grid" id="preset-row"></div>

          <!-- Color + font controls: only shown when the theme is Custom
               (toggled in ui.ts). The logo section below stays outside this
               container so it is always visible. -->
          <div class="customize-controls" id="customize-controls" hidden>
          <h3 class="customize-heading">Customize</h3>

          <div class="color-grid">
            <div class="color-field">
              <label class="field-label" for="header-color-input">Header background</label>
              <div class="color-row">
                <span class="color-swatch" id="header-color-swatch"></span>
                <input type="text" id="header-color-input" placeholder="#0f172a" />
              </div>
            </div>
            <div class="color-field">
              <label class="field-label" for="accent-color-input">Accent</label>
              <div class="color-row">
                <span class="color-swatch" id="accent-color-swatch"></span>
                <input type="text" id="accent-color-input" placeholder="#2563eb" />
              </div>
            </div>
            <div class="color-field">
              <label class="field-label" for="body-color-input">Body text</label>
              <div class="color-row">
                <span class="color-swatch" id="body-color-swatch"></span>
                <input type="text" id="body-color-input" placeholder="#334155" />
              </div>
            </div>
            <div class="color-field">
              <label class="field-label" for="tablehead-color-input">Table header</label>
              <div class="color-row">
                <span class="color-swatch" id="tablehead-color-swatch"></span>
                <input type="text" id="tablehead-color-input" placeholder="#f8fafc" />
              </div>
            </div>
          </div>

          <p class="hint" id="brand-color-hint"></p>
          <p class="hint" style="margin-top:6px"><a id="reset-colors-link">Reset to defaults</a></p>

          <div class="font-grid">
            <div class="font-field">
              <label class="field-label" for="heading-font-input">Heading font</label>
              <div class="font-picker" id="heading-font-picker">
                <input type="text" id="heading-font-input" placeholder="Inter" autocomplete="off" spellcheck="false" />
                <div class="font-menu" hidden></div>
              </div>
            </div>
            <div class="font-field">
              <label class="field-label" for="body-font-input">Body font</label>
              <div class="font-picker" id="body-font-picker">
                <input type="text" id="body-font-input" placeholder="Inter" autocomplete="off" spellcheck="false" />
                <div class="font-menu" hidden></div>
              </div>
            </div>
          </div>
          <p class="hint" id="font-fallback-hint" aria-live="polite"></p>
          </div>

          <label class="field-label logo-label">Logo</label>
          <p class="hint" style="margin:0 0 6px">Optional. Sits in the header of the generated frame.</p>
          <div class="logo-row">
            <button class="btn btn-secondary" id="capture-logo-btn" type="button">Use selected node as logo</button>
            <img id="logo-preview" alt="" style="display:none; height:24px;" />
            <button class="link-btn" id="clear-logo-btn" type="button" style="display:none;">Remove</button>
          </div>
          <p class="hint" id="logo-error-hint" style="color: var(--figma-color-text-danger)"></p>
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
    <div id="upsell" hidden>
      <p id="upsell-text" class="upsell-text"></p>
      <div class="actions">
        <button class="btn btn-primary" id="upsell-upgrade-btn" type="button">Upgrade for unlimited</button>
        <button class="btn btn-secondary" id="upsell-continue-btn" type="button">Continue without AI</button>
      </div>
    </div>
    <div class="actions" id="primary-actions">
      <button class="btn btn-secondary" id="download-btn" type="button"
              data-tooltip="Saves the spec as markdown. Drop it into Claude, Cursor, or any AI tool.">Download</button>
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
  tabLibrary: HTMLButtonElement;
  tabFoundations: HTMLButtonElement;
  panelSelected: HTMLElement;
  panelSettings: HTMLElement;
  panelLibrary: HTMLElement;
  panelFoundations: HTMLElement;
  libraryList: HTMLElement;
  libraryEmpty: HTMLElement;
  librarySummary: HTMLElement;
  libraryMenu: HTMLElement;
  foundationSummary: HTMLParagraphElement;
  foundationNotes: HTMLDivElement;
  foundationHead: HTMLDivElement;
  foundationAiCard: HTMLDivElement;
  foundationAi: HTMLInputElement;
  foundationToggleAll: HTMLButtonElement;
  foundationSkeleton: HTMLDivElement;
  foundationList: HTMLDivElement;
  foundationCreate: HTMLButtonElement;
  foundationLoader: HTMLDivElement;
  foundationLoaderText: HTMLSpanElement;
  foundationResult: HTMLDivElement;
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
  quotaMeter: HTMLElement;
  quotaBarFill: HTMLElement;
  quotaCount: HTMLElement;
  quotaUpgrade: HTMLButtonElement;
  quotaActivate: HTMLButtonElement;
  // Section checklist + new actions
  sectionList: HTMLDivElement;
  sectionChecks: Record<string, HTMLInputElement>;
  groupChecks: Record<string, HTMLInputElement>;
  groupCounts: Record<string, HTMLElement>;
  groupContainers: Record<string, HTMLElement>;
  selectAllBtn: HTMLButtonElement;
  measureSetup: HTMLElement;
  // Variant picker (per-variant tokens)
  variantPicker: HTMLDivElement;
  variantToggle: HTMLButtonElement;
  variantBody: HTMLDivElement;
  variantHint: HTMLDivElement;
  variantList: HTMLDivElement;
  variantSelectAll: HTMLButtonElement;
  variantCount: HTMLSpanElement;
  createFrameBtn: HTMLButtonElement;
  // Sticky footer
  actionFooter: HTMLDivElement;
  primaryActions: HTMLDivElement;
  // Banners + generating loader
  bannerInfo: HTMLDivElement;
  bannerError: HTMLDivElement;
  loader: HTMLDivElement;
  loaderText: HTMLSpanElement;
  // Quota-exhausted upsell fork
  upsell: HTMLElement;
  upsellText: HTMLElement;
  upsellUpgradeBtn: HTMLButtonElement;
  upsellContinueBtn: HTMLButtonElement;
  // Download action
  downloadBtn: HTMLButtonElement;
  // AI settings (Settings tab)
  licenseKeyInput: HTMLInputElement;
  licenseActivateBtn: HTMLButtonElement;
  licenseStatus: HTMLElement;
  licenseRenewRow: HTMLElement;
  licenseRemoveRow: HTMLElement;
  licenseGetProRow: HTMLElement;
  removeKeyLink: HTMLAnchorElement;
  // Frame brand theme (Settings tab)
  presetRow: HTMLDivElement;
  headerColorInput: HTMLInputElement;
  headerColorSwatch: HTMLSpanElement;
  accentColorInput: HTMLInputElement;
  accentColorSwatch: HTMLSpanElement;
  bodyColorInput: HTMLInputElement;
  bodyColorSwatch: HTMLSpanElement;
  tableheadColorInput: HTMLInputElement;
  tableheadColorSwatch: HTMLSpanElement;
  headingFontInput: HTMLInputElement;
  bodyFontInput: HTMLInputElement;
  headingFontPicker: HTMLDivElement;
  bodyFontPicker: HTMLDivElement;
  fontFallbackHint: HTMLParagraphElement;
  customizeControls: HTMLElement;
  brandColorHint: HTMLParagraphElement;
  resetColorsLink: HTMLElement;
  captureLogoBtn: HTMLButtonElement;
  logoPreview: HTMLImageElement;
  clearLogoBtn: HTMLButtonElement;
  logoErrorHint: HTMLParagraphElement;
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
  // with an inline (AI) badge on AI-generated sections. Each row is wrapped in
  // a `.sec-group` so option-bearing sections (anatomy, measurements) can nest
  // their disclosure directly beneath the checkbox that controls them, instead
  // of floating disconnected below the whole grid. Must run before we collect
  // the per-checkbox refs below.
  const sectionList = byId<HTMLDivElement>('section-list');
  const groupChecks: Record<string, HTMLInputElement> = {};
  const groupCounts: Record<string, HTMLElement> = {};
  const groupContainers: Record<string, HTMLElement> = {};

  for (const grp of GROUPS) {
    const container = document.createElement('div');
    container.className = 'sec-groupbox';
    container.dataset.group = grp.id;

    const head = document.createElement('div');
    head.className = 'sec-grouphead';

    const master = document.createElement('input');
    master.type = 'checkbox';
    master.className = 'group-check';
    master.id = `group-${grp.id}`;
    master.setAttribute('aria-label', `Toggle all ${grp.label} sections`);

    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = grp.label;

    const count = document.createElement('span');
    count.className = 'group-count';

    head.appendChild(master);
    head.appendChild(chev);
    head.appendChild(name);
    head.appendChild(count);

    const body = document.createElement('div');
    body.className = 'sec-groupbody';

    for (const section of ALL_SECTIONS.filter((s) => s.group === grp.id)) {
      const group = document.createElement('div');
      group.className = 'sec-group';

      const row = document.createElement('div');
      row.className = 'sec-row';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `sec-${section.id}`;
      // Opt-in by default for the paid, verbose a11y additions (and Related):
      // they cost extra tokens and most components won't need all three.
      input.checked = !DEFAULT_OFF_SECTIONS.has(section.id);

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
      group.appendChild(row);
      body.appendChild(group);
    }

    container.appendChild(head);
    container.appendChild(body);
    sectionList.appendChild(container);

    groupChecks[grp.id] = master;
    groupCounts[grp.id] = count;
    groupContainers[grp.id] = container;
  }

  const sectionChecks: Record<string, HTMLInputElement> = {};
  for (const section of ALL_SECTIONS) {
    sectionChecks[section.id] = byId<HTMLInputElement>(`sec-${section.id}`);
  }

  // Relocate the pre-existing measurement option panel (still defined in
  // TEMPLATE, outside #section-list) into its section's group, directly
  // beneath the row — appendChild moves the existing node rather than cloning
  // it, so ids/listeners attached later still resolve to the same elements.
  // Also wire up the disclosure a11y pairing (checkbox <-> options panel) here,
  // once, rather than duplicating it at every toggle site in ui.ts.
  const measureSetup = byId<HTMLElement>('measure-setup');
  sectionChecks['measurements']?.closest('.sec-group')?.appendChild(measureSetup);
  if (sectionChecks['measurements']) {
    sectionChecks['measurements'].setAttribute('aria-controls', 'measure-setup');
    sectionChecks['measurements'].setAttribute('aria-expanded', String(sectionChecks['measurements'].checked));
  }

  // Inject one preset card per built-in theme (wired to setBrandTheme in
  // ui.ts). Each card previews its theme; the specimen uses an approximate
  // CSS stack since the iframe cannot load Figma's fonts.
  const PRESET_FONT_STACKS: Record<string, string> = {
    Lora: "Georgia, 'Times New Roman', serif",
    'Space Grotesk': "Futura, 'Trebuchet MS', sans-serif",
    'DM Sans': 'Verdana, sans-serif',
  };
  // [card radius, band radius] per corner style, mirroring the frame's look.
  const PRESET_RADII: Record<CornerStyle, [number, number]> = {
    sharp: [0, 0],
    soft: [8, 5],
    round: [14, 10],
  };
  const CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
  const SLIDERS_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="2" fill="currentColor" stroke="none"/></svg>';

  // A checkmark badge, shown on whichever card is active (CSS toggles it).
  const addCheck = (card: HTMLElement): void => {
    const check = document.createElement('span');
    check.className = 'preset-check';
    check.innerHTML = CHECK_SVG;
    card.appendChild(check);
  };

  const presetRow = byId<HTMLDivElement>('preset-row');
  for (const preset of THEME_PRESETS) {
    const resolved = resolveTheme(preset.theme);
    const [cardR, bandR] = PRESET_RADII[resolved.cornerStyle];

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'preset-card';
    card.dataset.preset = preset.name;
    card.style.borderRadius = `${cardR}px`;

    const band = document.createElement('span');
    band.className = 'preset-band';
    band.style.background = resolved.headerBg;
    band.style.borderRadius = `${bandR}px`;

    const ag = document.createElement('span');
    ag.className = 'preset-ag';
    ag.style.fontFamily = PRESET_FONT_STACKS[resolved.headingFont] ?? 'Inter, sans-serif';
    ag.textContent = 'Ag';

    const dot = document.createElement('span');
    dot.className = 'preset-dot';
    dot.style.background = resolved.accent;

    band.append(ag, dot);
    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = preset.name;
    card.append(band, name);
    addCheck(card);
    presetRow.appendChild(card);
  }

  // Trailing "Custom" card: a state indicator, not a preset. It has no palette
  // to apply (clicking it is a no-op, since it matches no THEME_PRESETS entry);
  // renderBrandTheme marks it active whenever the theme matches no preset.
  {
    const [cardR, bandR] = PRESET_RADII.soft;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'preset-card custom';
    card.dataset.preset = '__custom__';
    card.style.borderRadius = `${cardR}px`;

    const band = document.createElement('span');
    band.className = 'preset-band';
    band.style.borderRadius = `${bandR}px`;
    band.innerHTML = SLIDERS_SVG;

    const name = document.createElement('span');
    name.className = 'preset-name';
    name.textContent = 'Custom';
    card.append(band, name);
    addCheck(card);
    presetRow.appendChild(card);
  }

  return {
    themeBtn: byId<HTMLButtonElement>('theme-btn'),
    tabSelected: byId<HTMLButtonElement>('tab-selected'),
    tabSettings: byId<HTMLButtonElement>('tab-settings'),
    tabLibrary: byId<HTMLButtonElement>('tab-library'),
    tabFoundations: byId<HTMLButtonElement>('tab-foundations'),
    panelSelected: byId<HTMLElement>('tab-panel-selected'),
    panelSettings: byId<HTMLElement>('tab-panel-settings'),
    panelLibrary: byId<HTMLElement>('tab-panel-library'),
    panelFoundations: byId<HTMLElement>('tab-panel-foundations'),
    libraryList: byId<HTMLElement>('lib-list'),
    libraryEmpty: byId<HTMLElement>('lib-empty'),
    librarySummary: byId<HTMLElement>('lib-summary'),
    libraryMenu: byId<HTMLElement>('lib-menu'),
    foundationSummary: byId<HTMLParagraphElement>('foundation-summary'),
    foundationNotes: byId<HTMLDivElement>('foundation-notes'),
    foundationHead: byId<HTMLDivElement>('foundation-head'),
    foundationAiCard: byId<HTMLDivElement>('foundation-ai-card'),
    foundationAi: byId<HTMLInputElement>('foundation-ai'),
    foundationToggleAll: byId<HTMLButtonElement>('foundation-toggle-all'),
    foundationSkeleton: byId<HTMLDivElement>('foundation-skeleton'),
    foundationList: byId<HTMLDivElement>('foundation-list'),
    foundationCreate: byId<HTMLButtonElement>('foundation-create'),
    foundationLoader: byId<HTMLDivElement>('foundation-loader'),
    foundationLoaderText: byId<HTMLSpanElement>('foundation-loader-text'),
    foundationResult: byId<HTMLDivElement>('foundation-result'),
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
    quotaMeter: byId<HTMLElement>('quota-meter'),
    quotaBarFill: byId<HTMLElement>('quota-bar-fill'),
    quotaCount: byId<HTMLElement>('quota-count'),
    quotaUpgrade: byId<HTMLButtonElement>('quota-upgrade'),
    quotaActivate: byId<HTMLButtonElement>('quota-activate'),
    sectionList,
    sectionChecks,
    groupChecks,
    groupCounts,
    groupContainers,
    selectAllBtn: byId<HTMLButtonElement>('select-all-btn'),
    measureSetup: byId<HTMLElement>('measure-setup'),
    variantPicker: byId<HTMLDivElement>('variant-picker'),
    variantToggle: byId<HTMLButtonElement>('variant-toggle'),
    variantBody: byId<HTMLDivElement>('variant-body'),
    variantHint: byId<HTMLDivElement>('variant-hint'),
    variantList: byId<HTMLDivElement>('variant-list'),
    variantSelectAll: byId<HTMLButtonElement>('variant-select-all'),
    variantCount: byId<HTMLSpanElement>('variant-count'),
    createFrameBtn: byId<HTMLButtonElement>('create-frame-btn'),
    actionFooter: byId<HTMLDivElement>('action-footer'),
    primaryActions: byId<HTMLDivElement>('primary-actions'),
    bannerInfo: byId<HTMLDivElement>('banner-info'),
    bannerError: byId<HTMLDivElement>('banner-error'),
    loader: byId<HTMLDivElement>('loader'),
    loaderText: byId<HTMLSpanElement>('loader-text'),
    upsell: byId<HTMLElement>('upsell'),
    upsellText: byId<HTMLElement>('upsell-text'),
    upsellUpgradeBtn: byId<HTMLButtonElement>('upsell-upgrade-btn'),
    upsellContinueBtn: byId<HTMLButtonElement>('upsell-continue-btn'),
    downloadBtn: byId<HTMLButtonElement>('download-btn'),
    licenseKeyInput: byId<HTMLInputElement>('license-key-input'),
    licenseActivateBtn: byId<HTMLButtonElement>('license-activate-btn'),
    licenseStatus: byId<HTMLElement>('license-status'),
    licenseRenewRow: byId<HTMLElement>('license-renew-row'),
    licenseRemoveRow: byId<HTMLElement>('license-remove-row'),
    licenseGetProRow: byId<HTMLElement>('license-getpro-row'),
    removeKeyLink: byId<HTMLAnchorElement>('remove-key-link'),
    presetRow,
    headerColorInput: byId<HTMLInputElement>('header-color-input'),
    headerColorSwatch: byId<HTMLSpanElement>('header-color-swatch'),
    accentColorInput: byId<HTMLInputElement>('accent-color-input'),
    accentColorSwatch: byId<HTMLSpanElement>('accent-color-swatch'),
    bodyColorInput: byId<HTMLInputElement>('body-color-input'),
    bodyColorSwatch: byId<HTMLSpanElement>('body-color-swatch'),
    tableheadColorInput: byId<HTMLInputElement>('tablehead-color-input'),
    tableheadColorSwatch: byId<HTMLSpanElement>('tablehead-color-swatch'),
    headingFontInput: byId<HTMLInputElement>('heading-font-input'),
    bodyFontInput: byId<HTMLInputElement>('body-font-input'),
    headingFontPicker: byId<HTMLDivElement>('heading-font-picker'),
    bodyFontPicker: byId<HTMLDivElement>('body-font-picker'),
    fontFallbackHint: byId<HTMLParagraphElement>('font-fallback-hint'),
    customizeControls: byId<HTMLElement>('customize-controls'),
    brandColorHint: byId<HTMLParagraphElement>('brand-color-hint'),
    resetColorsLink: byId<HTMLElement>('reset-colors-link'),
    captureLogoBtn: byId<HTMLButtonElement>('capture-logo-btn'),
    logoPreview: byId<HTMLImageElement>('logo-preview'),
    clearLogoBtn: byId<HTMLButtonElement>('clear-logo-btn'),
    logoErrorHint: byId<HTMLParagraphElement>('logo-error-hint'),
  };
}
