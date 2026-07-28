/**
 * component.ts — the "Generate component docs" screen.
 *
 * Owns presentation and the user's section choice. Everything that touches the
 * document, the proxy, or the canvas stays in actions.ts: this module hands it
 * a selection and a presenter and gets on with drawing.
 */

import type { SectionId, GroupId } from '../docModel';
import type { ComponentScreenState } from '../viewModel/contracts';
import { assertNever } from '../viewModel/contracts';
import {
  defaultSections,
  includedLabel,
  sectionGroups,
  sectionIdsInGroup,
} from '../viewModel/componentScreen';
import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';

/** The user's picks. Held here, handed to createDocFrame at build time. */
export interface ComponentSelection {
  sections: Set<SectionId>;
  expanded: Set<GroupId>;
  aiEnabled: boolean;
  anatomyView: 'diagram' | 'table' | 'both';
  measureViews: Set<'size' | 'padding' | 'spacing'>;
}

export function createComponentSelection(aiEnabled: boolean): ComponentSelection {
  return {
    sections: defaultSections(),
    expanded: new Set<GroupId>(['usage']),
    aiEnabled,
    anatomyView: 'diagram',
    measureViews: new Set(['size', 'padding', 'spacing'] as const),
  };
}

const MEASURE_CHIPS: { id: 'size' | 'padding' | 'spacing'; label: string }[] = [
  { id: 'size', label: 'Height & width' },
  { id: 'padding', label: 'Inner padding' },
  { id: 'spacing', label: 'Children & spacing' },
];

const ANATOMY_VIEWS: { id: 'diagram' | 'table' | 'both'; label: string }[] = [
  { id: 'diagram', label: 'Diagram' },
  { id: 'table', label: 'Table' },
  { id: 'both', label: 'Both' },
];

const AI_HELP =
  'AI can assist sections labeled AI. Component data, measurements, states, ' +
  'and tokens still come directly from Figma. Creating docs uses one free AI ' +
  'writing use when this is on.';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The centered state shown when Figma has nothing usable selected. */
function emptyMarkup(): string {
  return (
    '<div class="sl-empty-state">' +
    '<strong>No component selected</strong>' +
    '<p>Select a component or component set in Figma to document it.</p>' +
    '</div>'
  );
}

function checkboxRow(option: {
  id: string;
  label: string;
  aiCapable: boolean;
  selected: boolean;
}): string {
  const badge = option.aiCapable
    ? '<span class="sl-badge" data-tone="accent">AI</span>'
    : '';
  return (
    '<div class="sl-section-row">' +
    '<label class="sl-choice">' +
    `<input class="sl-choice-input" type="checkbox" data-section="${esc(option.id)}"` +
    `${option.selected ? ' checked' : ''} />` +
    '<span class="sl-checkbox-box" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 6L9 17l-5-5"/></svg>' +
    '</span>' +
    `<span class="sl-choice-copy"><strong>${esc(option.label)}</strong></span>` +
    '</label>' +
    badge +
    '</div>'
  );
}

/** Anatomy's view picker and the measurement chips, shown under their rows. */
function detailsFor(sectionId: string, selection: ComponentSelection): string {
  if (sectionId === 'anatomy') {
    const buttons = ANATOMY_VIEWS.map(
      (v) =>
        `<button type="button" role="radio" data-anatomy="${v.id}" ` +
        `aria-checked="${selection.anatomyView === v.id}">${v.label}</button>`,
    ).join('');
    return (
      '<div class="sl-section-details">' +
      `<div class="sl-segmented" role="radiogroup" aria-label="Show anatomy as">${buttons}</div>` +
      '</div>'
    );
  }
  if (sectionId === 'measurements') {
    const chips = MEASURE_CHIPS.map(
      (c) =>
        `<button class="sl-chip" type="button" data-measure="${c.id}" ` +
        `aria-pressed="${selection.measureViews.has(c.id)}">${esc(c.label)}</button>`,
    ).join('');
    return `<div class="sl-section-details"><div class="sl-chip-group">${chips}</div></div>`;
  }
  return '';
}

function groupMarkup(
  group: ReturnType<typeof sectionGroups>[number],
  selection: ComponentSelection,
): string {
  const panelId = `sl-group-${group.id}`;
  const rows = group.options
    .map((o) => checkboxRow(o) + (o.selected ? detailsFor(o.id, selection) : ''))
    .join('');
  return (
    '<div class="sl-disclosure sl-section-group">' +
    `<button class="sl-disclosure-trigger" type="button" data-group="${group.id}" ` +
    `aria-expanded="${group.expanded}" aria-controls="${panelId}">` +
    `<span class="sl-section-group-title">${esc(group.label)}</span>` +
    `<span class="sl-section-count">${includedLabel(group)}</span>` +
    `<span data-chevron aria-hidden="true">${icon('chevronDown', 16)}</span>` +
    '</button>' +
    `<div class="sl-disclosure-panel" id="${panelId}">` +
    `<div><div class="sl-section-rows">${rows}</div></div>` +
    '</div>' +
    '</div>'
  );
}

/** The AI writing switch and its help tooltip. */
function aiControlMarkup(enabled: boolean): string {
  return (
    `<div class="sl-ai-control" data-enabled="${enabled}">` +
    '<label class="sl-switch-control">' +
    '<span class="sl-choice-copy"><strong>AI writing</strong></span>' +
    '<span>' +
    '<input class="sl-switch-input" id="sl-ai-toggle" type="checkbox" role="switch" ' +
    `aria-label="AI writing"${enabled ? ' checked' : ''} />` +
    '<span class="sl-switch-track" aria-hidden="true"><span class="sl-switch-thumb"></span></span>' +
    '</span>' +
    '</label>' +
    '<span data-tooltip-trigger>' +
    `<button class="sl-icon-button" id="sl-ai-help" type="button" aria-label="About AI writing" ` +
    `aria-describedby="sl-ai-help-text">${icon('infoCircle', 15)}</button>` +
    `<span class="sl-tooltip" id="sl-ai-help-text" role="tooltip">${AI_HELP}</span>` +
    '</span>' +
    '</div>'
  );
}

export function componentScrollMarkup(
  state: ComponentScreenState,
  selection: ComponentSelection,
): string {
  if (state.kind === 'empty') return emptyMarkup();

  const groups = sectionGroups(selection.sections, selection.expanded, selection.aiEnabled)
    .map((g) => groupMarkup(g, selection))
    .join('');

  return (
    aiControlMarkup(selection.aiEnabled) +
    '<p class="sl-section-intro">Sections to include</p>' +
    groups +
    '<div class="sl-screen-status" id="sl-component-status" role="status" aria-live="polite"></div>'
  );
}

export function componentHeaderMarkup(state: ComponentScreenState): string {
  if (state.kind === 'empty') return '';
  return (
    '<div class="sl-page-header-copy">' +
    `<h1 id="sl-component-name">${esc(state.componentName)}</h1>` +
    '</div>'
  );
}

export function componentFooterMarkup(state: ComponentScreenState): string {
  if (state.kind === 'empty') return '';
  const building = state.kind === 'building';
  const download =
    state.kind === 'success'
      ? '<button class="sl-button" data-tone="secondary" id="sl-download" type="button">Download</button>'
      : '';
  return (
    download +
    `<button class="sl-button" data-tone="primary" id="sl-create" type="button"` +
    `${building ? ' disabled' : ''}>${building ? 'Creating docs' : 'Create docs'}</button>`
  );
}

/** Paint the whole screen. Cheap enough to re-run on any change. */
export function renderComponentScreen(
  refs: ShellRefs,
  state: ComponentScreenState,
  selection: ComponentSelection,
): void {
  refs.pageHeader.innerHTML = componentHeaderMarkup(state);
  refs.pageHeader.hidden = state.kind === 'empty';
  refs.scroll.innerHTML = componentScrollMarkup(state, selection);
  refs.footer.innerHTML = componentFooterMarkup(state);
  refs.footer.hidden = state.kind === 'empty';

  const status = document.getElementById('sl-component-status');
  if (status) {
    switch (state.kind) {
      case 'error':
        status.innerHTML = `<div class="sl-banner" data-tone="danger">${esc(state.message)}</div>`;
        break;
      case 'success':
        status.innerHTML =
          `<div class="sl-banner" data-tone="success">${state.replaced ? 'Docs replaced' : 'Docs created'}</div>`;
        break;
      case 'empty':
      case 'reading':
      case 'ready':
      case 'building':
        status.innerHTML = '';
        break;
      default:
        assertNever(state, 'ComponentScreenState');
    }
  }
}
