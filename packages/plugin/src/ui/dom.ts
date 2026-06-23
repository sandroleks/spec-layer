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
      --figma-color-bg-danger: #f24822;
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

    /* ---- Banners ---- */
    .banner {
      padding: 8px 10px; border-radius: 6px; font-size: 11px;
      display: none; margin-bottom: 10px;
    }
    .banner.info  { background: var(--figma-color-bg-secondary); color: var(--figma-color-text); }
    .banner.error { background: var(--figma-color-bg-secondary); color: var(--figma-color-bg-danger); }
    .atom-notice {
      display: none; margin-top: 8px; padding: 8px 10px; border-radius: 6px;
      background: var(--figma-color-bg-secondary); color: var(--figma-color-text-secondary);
      font-size: 11px;
    }
    .check-row { display: flex; align-items: flex-start; gap: 8px; font-size: 11px; }
    .check-row input { margin: 1px 0 0; }
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
    /* Section checklist container. */
    #section-list { display: flex; flex-direction: column; gap: 8px; }

    /* ---- "Also" de-emphasized block ---- */
    details.also { margin-top: 14px; }
    details.also > summary {
      cursor: pointer; font-size: 11px; color: var(--figma-color-text-secondary);
      list-style: none; padding: 4px 0; user-select: none;
    }
    details.also > summary::-webkit-details-marker { display: none; }
    details.also > summary::before { content: "▸ "; }
    details.also[open] > summary::before { content: "▾ "; }
    details.also > summary:hover { color: var(--figma-color-text); }

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
        <div class="stack">
          <div class="comp-head">
            <h2 id="component-name">Component</h2>
            <span class="phase-label" id="phase-label"></span>
          </div>
          <p class="hint" style="margin-top:0">
            Extract a Markdown spec from the selection. Download it locally — no account or server needed.
          </p>
          <div class="atom-notice" id="atom-notice">
            <strong>Atom component.</strong> It is normally used to build larger components, but you can still export it individually.
          </div>

          <!-- Section checklist: which guideline sections to include in the
               doc frame. Rows are generated in mount() from ALL_SECTIONS so the
               markup stays DRY; #section-list is the injection target. -->
          <div>
            <label class="field-label">Sections to include</label>
            <div id="section-list"></div>
          </div>

          <div class="row">
            <button class="btn btn-primary" id="create-frame-btn">Create doc frame</button>
            <button class="btn btn-secondary" id="generate-btn">Generate with AI</button>
          </div>

          <!-- Implicit extraction (Task 9) replaces the visible Extract button,
               but render.ts/ui.ts still reference refs.extractBtn — keep the id
               present (hidden) until Tasks 9-10 clean up the usage. -->
          <button class="btn btn-primary" id="extract-btn" style="display:none">Extract spec</button>
        </div>

        <div id="banner-info" class="banner info" style="margin-top:14px"></div>
        <div id="banner-error" class="banner error"></div>

        <!-- Download / send remain available but de-emphasized in an "Also" block. -->
        <details class="also" id="also-details">
          <summary>Also: download .md / send to docs</summary>
          <div id="review-area" style="display:none; margin-top:10px">
            <p class="hint" style="margin-top:0">
              Review the spec. Edits here only affect the Markdown inside the downloaded bundle.
            </p>
            <textarea id="spec-textarea" spellcheck="false"></textarea>

            <div class="row" style="margin-top:10px">
              <button class="btn btn-primary" id="send-btn">Send to docs</button>
              <button class="btn btn-secondary" id="download-btn">Download</button>
            </div>

            <!-- Send-time prompt: only revealed when the Figma file key can't be
                 auto-detected, so the user can fix it inline without leaving the
                 component. Mirrors the persistent override field in Settings. -->
            <div id="inline-filekey" class="inline-filekey" style="display:none">
              <label class="field-label" for="inline-filekey-input">Paste this file's Figma URL</label>
              <input type="text" id="inline-filekey-input" placeholder="https://figma.com/design/… or file key" />
              <p class="hint">Needed once so previews load after import. Saved for next time.</p>
            </div>
          </div>
        </details>
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
  // Section checklist + new actions
  sectionList: HTMLDivElement;
  sectionChecks: Record<string, HTMLInputElement>;
  generateBtn: HTMLButtonElement;
  createFrameBtn: HTMLButtonElement;
  alsoDetails: HTMLDetailsElement;
  // Banners
  bannerInfo: HTMLDivElement;
  bannerError: HTMLDivElement;
  // Review / output
  reviewArea: HTMLDivElement;
  specTextarea: HTMLTextAreaElement;
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
    row.className = 'check-row';

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
    sectionList,
    sectionChecks,
    generateBtn: byId<HTMLButtonElement>('generate-btn'),
    createFrameBtn: byId<HTMLButtonElement>('create-frame-btn'),
    alsoDetails: byId<HTMLDetailsElement>('also-details'),
    bannerInfo: byId<HTMLDivElement>('banner-info'),
    bannerError: byId<HTMLDivElement>('banner-error'),
    reviewArea: byId<HTMLDivElement>('review-area'),
    specTextarea: byId<HTMLTextAreaElement>('spec-textarea'),
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
