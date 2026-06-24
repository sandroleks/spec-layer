/**
 * dom.ts — owns the UI's static markup + styles and the typed element refs.
 *
 * `mount()` injects the template into document.body and returns a `Refs` object
 * so the rest of the UI never reaches for `getElementById` directly. The markup
 * is laid out as a tabbed shell:
 *
 *   [ Selected component ]  [ Export all ]
 *
 * The "Selected component" tab is the single-component flow (extract → preview →
 * download / optional send). The "Export all" tab (`#tab-all` / `#tab-panel-all`)
 * holds the bulk export: a folder-name input, an "Export all components" button,
 * and a progress/status area; it works whether or not anything is selected.
 *
 * Styling uses Figma theme CSS variables (injected because main.ts passes
 * `themeColors: true` to figma.showUI) so the plugin tracks Figma light/dark.
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
    html, body { height: 100%; }
    body {
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px; margin: 0; line-height: 1.45;
      color: var(--figma-color-text);
      background: var(--figma-color-bg);
      display: flex; flex-direction: column; height: 100vh;
    }

    /* ---- Tab bar ---- */
    .tabs {
      display: flex; gap: 2px; padding: 0 12px;
      border-bottom: 1px solid var(--figma-color-border);
      flex: 0 0 auto;
    }
    .tab {
      appearance: none; background: none; border: none; cursor: pointer;
      padding: 12px 4px; margin-right: 14px;
      font-size: 12px; font-weight: 500;
      color: var(--figma-color-text-secondary);
      border-bottom: 2px solid transparent;
    }
    .tab:hover:not(:disabled) { color: var(--figma-color-text); }
    .tab[aria-selected="true"] {
      color: var(--figma-color-text);
      border-bottom-color: var(--figma-color-text);
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
    .row { display: flex; align-items: center; gap: 8px; }
    .stack { display: flex; flex-direction: column; gap: 10px; }
    hr { border: none; border-top: 1px solid var(--figma-color-border); margin: 14px 0; }

    /* ---- Header / component identity ---- */
    .comp-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .phase-label { font-size: 11px; color: var(--figma-color-text-secondary); }

    /* ---- Buttons ---- */
    button.btn {
      appearance: none; font-size: 12px; font-weight: 500;
      padding: 7px 14px; border-radius: 6px; cursor: pointer;
      border: 1px solid transparent; line-height: 1;
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
      width: 100%; font-size: 12px; padding: 7px 8px;
      border: 1px solid var(--figma-color-border); border-radius: 6px;
      background: var(--figma-color-bg); color: var(--figma-color-text);
    }
    input[type="text"]:focus, input[type="password"]:focus {
      outline: none; border-color: var(--figma-color-bg-brand);
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
    .atom-notice {
      display: none; margin-top: 8px; padding: 8px 10px; border-radius: 6px;
      background: var(--figma-color-bg-secondary); color: var(--figma-color-text-secondary);
      font-size: 11px;
    }
    /* Generic checkbox row (export-all panel). */
    .check-row { display: flex; align-items: flex-start; gap: 8px; font-size: 11px; }
    .check-row input { margin: 1px 0 0; accent-color: var(--figma-color-bg-brand); }
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
      padding: 10px 12px; border-radius: 8px; margin-top: 12px;
      background: var(--figma-color-bg-secondary); border: 1px solid var(--figma-color-border);
    }
    .ai-card .ai-title { font-size: 12px; font-weight: 600; }
    .ai-card .hint { margin-top: 2px; }
    .ai-nokey { font-size: 11px; color: var(--figma-color-bg-danger); margin-top: 4px; }
    .ai-nokey a { color: var(--figma-color-bg-brand); cursor: pointer; }
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

    /* ---- Section header + checklist ---- */
    .section-head { display: flex; align-items: center; justify-content: space-between; margin: 16px 0 6px; }
    .link-btn {
      appearance: none; background: none; border: none; cursor: pointer; padding: 0;
      font-family: inherit; font-size: 11px; color: var(--figma-color-bg-brand);
    }
    .link-btn:hover { text-decoration: underline; }
    .link-btn:disabled { color: var(--figma-color-text-disabled); cursor: default; text-decoration: none; }
    #section-list { display: flex; flex-direction: column; gap: 1px; }
    #section-list .sec-row {
      display: flex; align-items: center; gap: 8px; font-size: 12px;
      padding: 6px 8px; border-radius: 6px;
    }
    #section-list .sec-row:hover { background: var(--figma-color-bg-secondary); }
    #section-list .sec-row input {
      width: 14px; height: 14px; margin: 0; cursor: pointer;
      accent-color: var(--figma-color-bg-brand);
    }
    #section-list .sec-row label { cursor: pointer; flex: 1; }
    #section-list.ai-dim .ai-badge { opacity: 0.4; }

    /* ---- Action buttons ---- */
    .actions { display: flex; gap: 8px; margin-top: 16px; }
    .actions > .btn, .actions > .menu-wrap { flex: 1; }

    /* ---- Export dropdown menu ---- */
    .menu-wrap { position: relative; }
    .menu-wrap > .btn { width: 100%; }
    .caret { display: inline-block; margin-left: 4px; transition: transform 0.12s; }
    .menu-wrap.open .caret { transform: rotate(180deg); }
    .menu {
      position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 5;
      background: var(--figma-color-bg); border: 1px solid var(--figma-color-border);
      border-radius: 8px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
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
    <button class="tab" id="tab-all" role="tab" aria-selected="false"
            aria-controls="tab-panel-all">Export all</button>
    <button class="tab" id="tab-settings" role="tab" aria-selected="false"
            aria-controls="tab-panel-settings">Settings</button>
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

        <!-- Write with AI: one switch gates AI-written prose for the AI sections. -->
        <div class="ai-card">
          <div>
            <div class="ai-title">Write with AI</div>
            <p class="hint">Fills the <strong>AI</strong> sections below. Off = placeholders.</p>
            <div class="ai-nokey" id="ai-nokey" style="display:none">
              Add your Anthropic key in <a id="ai-nokey-link">Settings</a>.
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

        <!-- Two outputs: Create frame (secondary) + Export (primary dropdown
             grouping Send to docs / Download .md). -->
        <div class="actions">
          <button class="btn btn-secondary" id="create-frame-btn">Create frame</button>
          <div class="menu-wrap" id="export-wrap">
            <button class="btn btn-primary" id="export-btn" type="button"
                    aria-haspopup="true" aria-expanded="false">Export<span class="caret">▾</span></button>
            <div class="menu" id="export-menu" role="menu">
              <button class="menu-item" id="send-btn" type="button" role="menuitem">Send to docs</button>
              <button class="menu-item" id="download-btn" type="button" role="menuitem">Download .md</button>
            </div>
          </div>
        </div>

        <!-- Implicit extraction replaces the visible Extract button, but
             render.ts/ui.ts still reference refs.extractBtn — keep it hidden. -->
        <button class="btn" id="extract-btn" style="display:none">Extract spec</button>

        <div id="banner-info" class="banner info" style="margin-top:12px"></div>
        <div id="banner-error" class="banner error"></div>

        <!-- Send-time prompt: only revealed when the Figma file key can't be
             auto-detected, so the user can fix it inline without leaving the
             component. Mirrors the persistent override field in Settings. -->
        <div id="inline-filekey" class="inline-filekey" style="display:none">
          <label class="field-label" for="inline-filekey-input">Paste this file's Figma URL</label>
          <input type="text" id="inline-filekey-input" placeholder="https://figma.com/design/… or file key" />
          <p class="hint">Needed once so previews load after import. Saved for next time.</p>
        </div>
      </div>
    </section>

    <!-- ============ Export-all panel ============ -->
    <section class="panel" id="tab-panel-all" role="tabpanel"
             aria-labelledby="tab-all">
      <div class="stack">
        <p class="hint" style="margin-top:0">
          Export documentation components as Markdown specs in a single
          <code>.zip</code>. No component needs to be selected.
        </p>
        <div>
          <label class="field-label" for="folder-input">Folder / ZIP name</label>
          <input type="text" id="folder-input" placeholder="design-system" value="design-system" />
        </div>
        <div class="check-row">
          <input type="checkbox" id="include-atoms-input" />
          <label for="include-atoms-input">
            Include atom components
            <span>Components whose names start with <code>.</code> are excluded by default.</span>
          </label>
        </div>
        <div class="row">
          <button class="btn btn-primary" id="export-all-btn">Export all components</button>
        </div>
        <div id="export-status" class="hint" style="min-height:1.4em"></div>
      </div>
    </section>

    <!-- ============ Settings panel ============ -->
    <section class="panel" id="tab-panel-settings" role="tabpanel"
             aria-labelledby="tab-settings">
      <div class="stack">
        <div>
          <h2>AI</h2>
          <p class="hint" style="margin-top:4px">
            Your Anthropic API key. Stored locally in this plugin only; used to write guideline prose.
          </p>
          <label class="field-label" for="anthropic-key-input" style="margin-top:8px">Anthropic API key</label>
          <input type="password" id="anthropic-key-input" placeholder="sk-ant-…" />
        </div>

        <hr />

        <div>
          <h2>Docs platform</h2>
          <p class="hint" style="margin-top:4px">
            Where “Send to docs” publishes specs. Runs locally — no account or token.
          </p>
          <label class="field-label" for="endpoint-input" style="margin-top:8px">Docs URL</label>
          <input type="text" id="endpoint-input" placeholder="http://localhost:3000" />
        </div>

        <hr />

        <div>
          <h2>Figma source</h2>
          <p class="hint" style="margin-top:4px">
            The file reference embedded in each spec so previews load after import.
          </p>
          <div class="figma-source missing" id="filekey-status" style="margin-top:8px">
            <div>
              <strong id="filekey-status-title">Checking Figma source…</strong>
              <span id="filekey-status-detail"></span>
            </div>
          </div>
          <div id="filekey-field" style="margin-top:10px">
            <label class="field-label" id="filekey-label" for="filekey-input">Figma file URL</label>
            <input type="text" id="filekey-input" placeholder="paste Figma file URL or key" />
            <p class="hint" id="filekey-hint"></p>
          </div>
        </div>
      </div>
    </section>
  </div>
`;

// ---------------------------------------------------------------------------
// Typed refs
// ---------------------------------------------------------------------------

export interface Refs {
  // Tabs
  tabSelected: HTMLButtonElement;
  tabAll: HTMLButtonElement;
  tabSettings: HTMLButtonElement;
  panelSelected: HTMLElement;
  panelAll: HTMLElement;
  panelSettings: HTMLElement;
  // Selection / main
  noSelection: HTMLDivElement;
  mainArea: HTMLDivElement;
  componentName: HTMLHeadingElement;
  atomNotice: HTMLDivElement;
  phaseLabel: HTMLSpanElement;
  extractBtn: HTMLButtonElement;
  // Write-with-AI switch
  aiToggle: HTMLInputElement;
  aiNokey: HTMLDivElement;
  aiNokeyLink: HTMLElement;
  // Section checklist + new actions
  sectionList: HTMLDivElement;
  sectionChecks: Record<string, HTMLInputElement>;
  selectAllBtn: HTMLButtonElement;
  createFrameBtn: HTMLButtonElement;
  // Export dropdown
  exportWrap: HTMLDivElement;
  exportBtn: HTMLButtonElement;
  exportMenu: HTMLDivElement;
  // Banners
  bannerInfo: HTMLDivElement;
  bannerError: HTMLDivElement;
  // Export actions (inside the dropdown)
  downloadBtn: HTMLButtonElement;
  sendBtn: HTMLButtonElement;
  // Inline send-time file-key prompt (component panel)
  inlineFileKey: HTMLDivElement;
  inlineFileKeyInput: HTMLInputElement;
  // AI settings (Settings tab)
  anthropicKeyInput: HTMLInputElement;
  // Docs platform settings (Settings tab)
  endpointInput: HTMLInputElement;
  fileKeyStatus: HTMLDivElement;
  fileKeyStatusTitle: HTMLElement;
  fileKeyStatusDetail: HTMLElement;
  fileKeyField: HTMLDivElement;
  fileKeyLabel: HTMLLabelElement;
  fileKeyInput: HTMLInputElement;
  fileKeyHint: HTMLParagraphElement;
  // Export-all panel
  folderInput: HTMLInputElement;
  includeAtomsInput: HTMLInputElement;
  exportAllBtn: HTMLButtonElement;
  exportStatus: HTMLDivElement;
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
    tabSelected: byId<HTMLButtonElement>('tab-selected'),
    tabAll: byId<HTMLButtonElement>('tab-all'),
    tabSettings: byId<HTMLButtonElement>('tab-settings'),
    panelSelected: byId<HTMLElement>('tab-panel-selected'),
    panelAll: byId<HTMLElement>('tab-panel-all'),
    panelSettings: byId<HTMLElement>('tab-panel-settings'),
    noSelection: byId<HTMLDivElement>('no-selection'),
    mainArea: byId<HTMLDivElement>('main-area'),
    componentName: byId<HTMLHeadingElement>('component-name'),
    atomNotice: byId<HTMLDivElement>('atom-notice'),
    phaseLabel: byId<HTMLSpanElement>('phase-label'),
    extractBtn: byId<HTMLButtonElement>('extract-btn'),
    aiToggle: byId<HTMLInputElement>('ai-toggle'),
    aiNokey: byId<HTMLDivElement>('ai-nokey'),
    aiNokeyLink: byId<HTMLElement>('ai-nokey-link'),
    sectionList,
    sectionChecks,
    selectAllBtn: byId<HTMLButtonElement>('select-all-btn'),
    createFrameBtn: byId<HTMLButtonElement>('create-frame-btn'),
    exportWrap: byId<HTMLDivElement>('export-wrap'),
    exportBtn: byId<HTMLButtonElement>('export-btn'),
    exportMenu: byId<HTMLDivElement>('export-menu'),
    bannerInfo: byId<HTMLDivElement>('banner-info'),
    bannerError: byId<HTMLDivElement>('banner-error'),
    downloadBtn: byId<HTMLButtonElement>('download-btn'),
    sendBtn: byId<HTMLButtonElement>('send-btn'),
    inlineFileKey: byId<HTMLDivElement>('inline-filekey'),
    inlineFileKeyInput: byId<HTMLInputElement>('inline-filekey-input'),
    anthropicKeyInput: byId<HTMLInputElement>('anthropic-key-input'),
    endpointInput: byId<HTMLInputElement>('endpoint-input'),
    fileKeyStatus: byId<HTMLDivElement>('filekey-status'),
    fileKeyStatusTitle: byId<HTMLElement>('filekey-status-title'),
    fileKeyStatusDetail: byId<HTMLElement>('filekey-status-detail'),
    fileKeyField: byId<HTMLDivElement>('filekey-field'),
    fileKeyLabel: byId<HTMLLabelElement>('filekey-label'),
    fileKeyInput: byId<HTMLInputElement>('filekey-input'),
    fileKeyHint: byId<HTMLParagraphElement>('filekey-hint'),
    folderInput: byId<HTMLInputElement>('folder-input'),
    includeAtomsInput: byId<HTMLInputElement>('include-atoms-input'),
    exportAllBtn: byId<HTMLButtonElement>('export-all-btn'),
    exportStatus: byId<HTMLDivElement>('export-status'),
  };
}
