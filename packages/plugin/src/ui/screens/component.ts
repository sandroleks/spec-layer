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
  unavailableSections,
  variantCountLabel,
} from '../viewModel/componentScreen';
import type { ComponentFacts, VariantChip } from '../viewModel/componentFacts';
import { icon } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';

/** The user's picks. Held here, handed to createDocFrame at build time. */
export interface ComponentSelection {
  sections: Set<SectionId>;
  expanded: Set<GroupId>;
  aiEnabled: boolean;
  anatomyView: 'diagram' | 'table' | 'both';
  measureViews: Set<'size' | 'padding' | 'spacing'>;
  /** Which variants the Tokens section documents. Seeded per component. */
  variantIds: Set<string>;
  variantsExpanded: boolean;
}

export function createComponentSelection(aiEnabled: boolean): ComponentSelection {
  return {
    sections: defaultSections(),
    expanded: new Set<GroupId>(['usage']),
    aiEnabled,
    anatomyView: 'diagram',
    measureViews: new Set(['size', 'padding', 'spacing'] as const),
    variantIds: new Set<string>(),
    variantsExpanded: false,
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

const ATOM_NOTICE =
  'Atom component. It is normally used to build larger components, but you ' +
  'can still export it individually.';

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
  disabled?: boolean;
  note?: string;
}): string {
  const badge = option.aiCapable
    ? '<span class="sl-badge" data-tone="accent">AI</span>'
    : '';
  const note = option.note
    ? `<span class="sl-type-support"> · ${esc(option.note)}</span>`
    : '';
  return (
    '<div class="sl-section-row">' +
    '<label class="sl-choice">' +
    `<input class="sl-choice-input" type="checkbox" data-section="${esc(option.id)}"` +
    `${option.selected ? ' checked' : ''}${option.disabled ? ' disabled' : ''} />` +
    '<span class="sl-checkbox-box" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 6L9 17l-5-5"/></svg>' +
    '</span>' +
    `<span class="sl-choice-copy"><strong>${esc(option.label)}</strong>${note}</span>` +
    '</label>' +
    badge +
    '</div>'
  );
}

/** A quiet statement of fact about the selection, not a warning. */
function atomNoticeMarkup(): string {
  return `<div class="sl-banner" data-tone="neutral">${ATOM_NOTICE}</div>`;
}

function chipMarkup(chip: VariantChip): string {
  const axis = chip.axis ? `<span class="sl-chip-axis">${esc(chip.axis)}</span>` : '';
  return (
    `<span class="sl-chip sl-variant-chip" data-tone="${chip.tone}" ` +
    `title="${esc(chip.title)}">${axis}${esc(chip.text)}</span>`
  );
}

/**
 * The variant picker, shown under the Tokens row.
 *
 * With Tokens off the rows stay discoverable but inert, and the header says
 * which switch turns them back on.
 */
function variantPickerMarkup(facts: ComponentFacts, selection: ComponentSelection): string {
  if (facts.variants.length === 0) return '';
  const tokensOn = selection.sections.has('tokens');
  const rows = facts.variants
    .map((variant) => {
      const checked = selection.variantIds.has(variant.nodeId);
      const accessibleName = variant.chips.map((chip) => chip.title).join(', ');
      return (
        '<div class="sl-section-row">' +
        '<label class="sl-choice">' +
        `<input class="sl-choice-input" type="checkbox" data-variant="${esc(variant.nodeId)}"` +
        ` aria-label="${esc(accessibleName)}"` +
        `${checked ? ' checked' : ''}${tokensOn ? '' : ' disabled'} />` +
        '<span class="sl-checkbox-box" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
        'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M20 6L9 17l-5-5"/></svg>' +
        '</span>' +
        `<span class="sl-choice-copy sl-chip-group">${variant.chips.map(chipMarkup).join('')}</span>` +
        '</label>' +
        '</div>'
      );
    })
    .join('');

  const hint = tokensOn
    ? esc(variantCountLabel(
        facts.variants.filter((variant) => selection.variantIds.has(variant.nodeId)).length,
        facts.variants.length,
      ))
    : 'Turn on Tokens used to apply';

  return (
    '<div class="sl-section-details">' +
    '<div class="sl-disclosure sl-variant-picker">' +
    '<button class="sl-disclosure-trigger" type="button" data-variants ' +
    `aria-expanded="${selection.variantsExpanded}" aria-controls="sl-variant-list">` +
    '<span class="sl-section-group-title">Variants to document</span>' +
    `<span class="sl-section-count">${hint}</span>` +
    `<span data-chevron aria-hidden="true">${icon('chevronDown', 16)}</span>` +
    '</button>' +
    `<div class="sl-disclosure-panel" id="sl-variant-list"` +
    `${selection.variantsExpanded ? '' : ' hidden'}>` +
    `<div><div class="sl-section-rows">${rows}</div></div>` +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

/** Anatomy's view picker and the measurement chips, shown under their rows. */
function detailsFor(
  sectionId: string,
  selection: ComponentSelection,
  facts: ComponentFacts,
): string {
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
  if (sectionId === 'tokens') return variantPickerMarkup(facts, selection);
  return '';
}

function groupMarkup(
  group: ReturnType<typeof sectionGroups>[number],
  selection: ComponentSelection,
  facts: ComponentFacts,
): string {
  const panelId = `sl-group-${group.id}`;
  const rows = group.options
    .map((option) => {
      const details = option.selected || option.id === 'tokens'
        ? detailsFor(option.id, selection, facts)
        : '';
      return checkboxRow(option) + details;
    })
    .join('');
  const available = group.options.filter((option) => !option.disabled);
  const allOn = available.length > 0 && available.every((option) => option.selected);
  return (
    '<div class="sl-disclosure sl-section-group">' +
    `<div class="sl-section-group-header" data-expanded="${group.expanded}">` +
    `<button class="sl-disclosure-trigger" type="button" data-group="${group.id}" ` +
      `aria-expanded="${group.expanded}" aria-controls="${panelId}">` +
      `<span class="sl-section-group-title">${esc(group.label)}</span>` +
      `<span class="sl-section-count">${includedLabel(group)}</span>` +
      `<span data-chevron aria-hidden="true">${icon('chevronDown', 16)}</span>` +
      '</button>' +
    `<button class="sl-button" data-tone="quiet" type="button" data-group-bulk="${group.id}" ` +
      `data-on="${!allOn}" aria-label="${allOn ? 'Clear' : 'Select'} all ${esc(group.label)} sections">` +
      `${allOn ? 'Clear all' : 'Select all'}</button>` +
    '</div>' +
    `<div class="sl-disclosure-panel" id="${panelId}"${group.expanded ? '' : ' hidden'}>` +
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
  facts: ComponentFacts,
): string {
  if (state.kind === 'empty') return emptyMarkup();
  const busy = state.kind === 'reading' || state.kind === 'building';

  const groups = sectionGroups(
    selection.sections,
    selection.expanded,
    selection.aiEnabled,
    unavailableSections(facts),
  )
    .map((group) => groupMarkup(group, selection, facts))
    .join('');

  return (
    `<fieldset class="sl-component-controls"${busy ? ' disabled aria-busy="true"' : ''}>` +
    (facts.isAtom ? atomNoticeMarkup() : '') +
    aiControlMarkup(selection.aiEnabled) +
    '<p class="sl-section-intro">Sections to include</p>' +
    groups +
    '</fieldset>' +
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
  const busy = state.kind === 'reading' || state.kind === 'building';
  const createLabel = state.kind === 'building'
    ? state.action === 'download' ? 'Downloading…' : 'Creating docs'
    : 'Create docs';
  const download =
    state.kind === 'success'
      ? '<button class="sl-button" data-tone="secondary" id="sl-download" type="button">Download</button>'
      : '';
  return (
    download +
    `<button class="sl-button" data-tone="primary" id="sl-create" type="button"` +
    `${busy ? ' disabled' : ''}>${createLabel}</button>`
  );
}

export function componentStatusMarkup(state: ComponentScreenState): string {
  switch (state.kind) {
    case 'error':
      return `<div class="sl-banner" data-tone="danger">${esc(state.message)}</div>`;
    case 'success':
      return (
        `<div class="sl-banner" data-tone="${state.warning ? 'danger' : 'success'}">` +
        `${esc(state.message ?? (state.replaced ? 'Docs replaced' : 'Docs created'))}</div>`
      );
    case 'reading':
      return '<div class="sl-banner" data-tone="neutral">Reading…</div>';
    case 'empty':
    case 'ready':
    case 'building':
      return '';
    default:
      return assertNever(state, 'ComponentScreenState');
  }
}

/** Paint the whole screen. Cheap enough to re-run on any change. */
export function renderComponentScreen(
  refs: ShellRefs,
  state: ComponentScreenState,
  selection: ComponentSelection,
  facts: ComponentFacts,
): void {
  refs.pageHeader.innerHTML = componentHeaderMarkup(state);
  refs.pageHeader.hidden = state.kind === 'empty';
  refs.scroll.innerHTML = componentScrollMarkup(state, selection, facts);
  refs.footer.innerHTML = componentFooterMarkup(state);
  refs.footer.hidden = state.kind === 'empty';

  const status = document.getElementById('sl-component-status');
  if (status) status.innerHTML = componentStatusMarkup(state);
}
