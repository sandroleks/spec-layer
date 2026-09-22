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
  variantBulkState,
  variantCountLabel,
} from '../viewModel/componentScreen';
import type { ComponentFacts, VariantChip } from '../viewModel/componentFacts';
import { icon, type IconName } from '../shell/icons';
import type { ShellRefs } from '../shell/shell';
import { loadingRowsMarkup, progressMarkup } from './progress';

/** The user's picks. Held here, handed to createDocFrame at build time. */
export interface ComponentSelection {
  sections: Set<SectionId>;
  expanded: Set<GroupId>;
  aiEnabled: boolean;
  measureViews: Set<'size' | 'padding' | 'spacing'>;
  /** Which variants the Tokens section documents. Seeded per component. */
  variantIds: Set<string>;
  variantsExpanded: boolean;
  /** Draw the parts a boolean property hides by default. Per component: reset
   *  to false when the selection changes. */
  includeHidden: boolean;
}

export function createComponentSelection(aiEnabled: boolean): ComponentSelection {
  return {
    sections: defaultSections(),
    expanded: new Set<GroupId>(['usage']),
    aiEnabled,
    measureViews: new Set(['size', 'padding', 'spacing'] as const),
    variantIds: new Set<string>(),
    variantsExpanded: false,
    includeHidden: false,
  };
}

const MEASURE_CHIPS: { id: 'size' | 'padding' | 'spacing'; label: string }[] = [
  { id: 'size', label: 'Height & width' },
  { id: 'padding', label: 'Inner padding' },
  { id: 'spacing', label: 'Children & spacing' },
];

const GROUP_ICONS: Record<GroupId, IconName> = {
  usage: 'fileDescription',
  specs: 'box',
  a11y: 'accessible',
};

/** Labels come from ALL_SECTIONS now; this map exists for a UI-only override
 *  and is empty on purpose. */
const DISPLAY_LABELS: Partial<Record<SectionId, string>> = {};

const AI_HELP =
  'AI can assist sections labeled AI. Component data, measurements, states, ' +
  'and tokens still come directly from Figma. Creating docs uses one free AI ' +
  'writing use when this is on.';

/**
 * The explanation the switch's own label cannot carry.
 *
 * This text shipped as a caption under the control, set in an uppercase
 * micro-caps style built for two-word labels, which made two sentences of it
 * unreadable. The information was never the problem, so it moved to the same
 * tooltip pattern the AI writing switch already uses rather than being cut.
 */
const HIDDEN_HELP =
  'This component has layers that a boolean property turns on, off by ' +
  'default. Turn this on and every section documents them, noting the ' +
  'property that shows each one.';

const ATOM_NOTICE =
  'Atom component. Usually part of larger ones, but you can document it on its own.';

const CHECK_GLYPH =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M20 6L9 17l-5-5"/></svg>';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A small drawing of the act the screen is waiting for: a cursor selects a
 * component on the canvas and a doc sheet comes out of it. Decorative only,
 * so it is hidden from assistive tech; the heading carries the message. The
 * motion is CSS, and prefers-reduced-motion stills it.
 */
const EMPTY_ILLUSTRATION =
  '<svg class="sl-select-illustration" viewBox="0 0 160 112" width="160" height="112" ' +
  'fill="none" aria-hidden="true" focusable="false">' +
  // The doc sheet, behind the component so it reads as coming out of it.
  '<g class="sl-select-doc">' +
  '<rect x="108" y="20" width="48" height="64" rx="6" class="sl-select-sheet"/>' +
  '<rect x="115" y="29" width="22" height="4" rx="2" class="sl-select-line is-strong"/>' +
  '<rect x="115" y="38" width="34" height="3" rx="1.5" class="sl-select-line"/>' +
  '<rect x="115" y="45" width="28" height="3" rx="1.5" class="sl-select-line"/>' +
  '<rect x="115" y="55" width="15" height="10" rx="2" class="sl-select-chip"/>' +
  '<rect x="133" y="55" width="15" height="10" rx="2" class="sl-select-chip"/>' +
  '<rect x="115" y="71" width="26" height="3" rx="1.5" class="sl-select-line"/>' +
  '</g>' +
  // The component: a button-like tile with an icon and a label.
  '<g class="sl-select-component">' +
  '<rect x="20" y="40" width="72" height="32" rx="8" class="sl-select-tile"/>' +
  '<circle cx="36" cy="56" r="5" class="sl-select-dot"/>' +
  '<rect x="46" y="53" width="34" height="6" rx="3" class="sl-select-label"/>' +
  '</g>' +
  // The selection marquee and its corner handles.
  '<g class="sl-select-marquee">' +
  '<rect x="14" y="34" width="84" height="44" rx="11" class="sl-select-outline"/>' +
  '<rect x="11" y="31" width="6" height="6" rx="1" class="sl-select-handle"/>' +
  '<rect x="95" y="31" width="6" height="6" rx="1" class="sl-select-handle"/>' +
  '<rect x="11" y="75" width="6" height="6" rx="1" class="sl-select-handle"/>' +
  '<rect x="95" y="75" width="6" height="6" rx="1" class="sl-select-handle"/>' +
  '</g>' +
  '<path class="sl-select-cursor" d="M70 66 L70 88 L75.5 82.5 L79.5 91 L83 89.4 L79 81 L86.5 81 Z"/>' +
  '</svg>';

/**
 * The centered state shown when Figma has nothing usable selected.
 *
 * This is the first screen a new user meets, so it teaches the one move that
 * starts everything and offers the two starts that need no selection:
 * foundations, and the Library of docs already made. The buttons navigate
 * through the same views the rail does and start nothing.
 */
function emptyMarkup(): string {
  return (
    '<div class="sl-empty-state sl-select-empty">' +
    EMPTY_ILLUSTRATION +
    '<strong>Start with a component</strong>' +
    '<p>Select a component or component set on the canvas to create its docs.</p>' +
    '<div class="sl-select-actions">' +
    '<button class="sl-button" data-tone="secondary" type="button" data-empty-nav="foundations">' +
    `${icon('layoutGrid', 15)}<span>Document foundations</span></button>` +
    '<button class="sl-button" data-tone="quiet" type="button" data-empty-nav="library">' +
    `${icon('folder', 15)}<span>View library</span></button>` +
    '</div>' +
    '</div>'
  );
}

/**
 * Shown from the moment the panel opens until the main thread reports the
 * first selection. Without it the panel said "Select a component" for a beat
 * even when one was already selected, then swapped to the picker.
 */
function waitingMarkup(): string {
  return (
    '<div class="sl-select-waiting" aria-busy="true" aria-label="Reading the selection">' +
    '<i class="sl-skeleton sl-select-waiting-switch"></i>' +
    loadingRowsMarkup(6) +
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
    ? `<span class="sl-section-option-note"> · ${esc(option.note)}</span>`
    : '';
  return (
    `<div class="sl-section-row${option.selected ? ' is-selected' : ''}` +
    `${option.disabled ? ' is-disabled' : ''}">` +
    '<label class="sl-choice sl-section-choice">' +
    `<input class="sl-choice-input" type="checkbox" data-section="${esc(option.id)}"` +
    `${option.selected ? ' checked' : ''}${option.disabled ? ' disabled' : ''} />` +
    `<span class="sl-checkbox-box" aria-hidden="true">${CHECK_GLYPH}</span>` +
    `<span class="sl-choice-copy"><strong>${esc(option.label)}</strong>${note}</span>` +
    badge +
    '</label>' +
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
  const variantIds = facts.variants.map((variant) => variant.nodeId);
  const bulk = variantBulkState(selection.variantIds, variantIds);
  const rows = facts.variants
    .map((variant) => {
      const checked = selection.variantIds.has(variant.nodeId);
      const accessibleName = variant.chips.map((chip) => chip.title).join(', ');
      return (
        `<div class="sl-section-row sl-variant-row${checked ? ' is-selected' : ''}">` +
        '<label class="sl-choice sl-section-choice">' +
        `<input class="sl-choice-input" type="checkbox" data-variant="${esc(variant.nodeId)}"` +
        ` aria-label="${esc(accessibleName)}"` +
        `${checked ? ' checked' : ''} />` +
        `<span class="sl-checkbox-box" aria-hidden="true">${CHECK_GLYPH}</span>` +
        `<span class="sl-choice-copy sl-chip-group">${variant.chips.map(chipMarkup).join('')}</span>` +
        '</label>' +
        '</div>'
      );
    })
    .join('');

  const hint = esc(variantCountLabel(
    facts.variants.filter((variant) => selection.variantIds.has(variant.nodeId)).length,
    facts.variants.length,
  ));
  const bulkLabel = bulk.checked ? 'Clear all variants' : 'Select all variants';

  return (
    '<div class="sl-disclosure sl-variant-picker">' +
    '<div class="sl-variant-picker-header">' +
    `<label class="sl-bulk-checkbox" title="${bulkLabel}">` +
    `<input class="sl-choice-input" type="checkbox" data-variants-bulk ` +
    `aria-label="${bulkLabel}"${bulk.checked ? ' checked' : ''}` +
    `${bulk.mixed ? ' data-mixed="true" aria-checked="mixed"' : ''} />` +
    `<span class="sl-checkbox-box" aria-hidden="true">${CHECK_GLYPH}</span>` +
    '</label>' +
    '<button class="sl-disclosure-trigger" type="button" data-variants ' +
    `aria-expanded="${selection.variantsExpanded}" aria-controls="sl-variant-list">` +
    '<span class="sl-section-group-title">Variants to document</span>' +
    `<span class="sl-section-count" data-variant-count>${hint}</span>` +
    `<span data-chevron aria-hidden="true">${icon('chevronDown', 16)}</span>` +
    '</button>' +
    '</div>' +
    `<div class="sl-disclosure-panel" id="sl-variant-list"` +
    `${selection.variantsExpanded ? '' : ' hidden'}>` +
    `<div><div class="sl-section-rows">${rows}</div></div>` +
    '</div>' +
    '</div>'
  );
}

/**
 * The document-wide hidden-elements switch.
 *
 * It sits above "Sections to include" rather than under the Anatomy row,
 * because the flag it sets feeds Anatomy, States, Variants, the per-variant
 * token pane and Measurements alike. Nesting it under one section said it
 * applied to that section only, and made it look like it should disarm when
 * that section did.
 *
 * Only drawn when the component actually has such layers: on every other
 * component the switch would be a control with nothing to control.
 */
function hiddenElementsMarkup(selection: ComponentSelection, facts: ComponentFacts): string {
  if (!facts.hasHiddenParts) return '';
  return (
    '<div class="sl-doc-option">' +
    '<span class="sl-doc-option-copy">' +
    '<strong>Document hidden elements</strong>' +
    '<span data-tooltip-trigger>' +
    '<button class="sl-icon-button" id="sl-hidden-help" type="button" ' +
    'aria-label="About documenting hidden elements" ' +
    `aria-describedby="sl-hidden-help-text">${icon('infoCircle', 15)}</button>` +
    `<span class="sl-tooltip" id="sl-hidden-help-text" role="tooltip">${HIDDEN_HELP}</span>` +
    '</span>' +
    '</span>' +
    '<label class="sl-switch-control">' +
    '<input class="sl-choice-input sl-switch-input" type="checkbox" role="switch" ' +
    'aria-label="Document hidden elements" data-include-hidden' +
    `${selection.includeHidden ? ' checked' : ''} />` +
    '<span class="sl-switch-track" aria-hidden="true"><span class="sl-switch-thumb"></span></span>' +
    '</label>' +
    '</div>'
  );
}

/** Measurement and token settings, shown under their rows. */
function detailsFor(
  sectionId: string,
  selection: ComponentSelection,
  facts: ComponentFacts,
): string {
  if (sectionId === 'measurements') {
    const chips = MEASURE_CHIPS.map(
      (c) => {
        const selected = selection.measureViews.has(c.id);
        const onlySelected = selected && selection.measureViews.size === 1;
        return (
          `<button class="sl-chip sl-option-chip" type="button" data-measure="${c.id}" ` +
          `aria-pressed="${selected}"${onlySelected ? ' aria-disabled="true" ' +
          'title="At least one measurement view is required"' : ''}>` +
          `<span class="sl-option-check" aria-hidden="true">${icon('check', 13)}</span>` +
          `${esc(c.label)}</button>`
        );
      },
    ).join('');
    return (
      '<div class="sl-section-details">' +
      '<span class="sl-section-option-label">Diagrams to include</span>' +
      `<div class="sl-chip-group">${chips}</div>` +
      '</div>'
    );
  }
  if (sectionId === 'tokens') {
    const picker = variantPickerMarkup(facts, selection);
    return picker ? `<div class="sl-section-details">${picker}</div>` : '';
  }
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
      const details = option.selected ? detailsFor(option.id, selection, facts) : '';
      return checkboxRow({
        ...option,
        label: DISPLAY_LABELS[option.id as SectionId] ?? option.label,
      }) + details;
    })
    .join('');
  const allIncluded = group.total > 0 && group.included === group.total;
  const mixed = group.included > 0 && !allIncluded;
  const bulkLabel = allIncluded ? 'Clear all' : 'Select all';
  return (
    '<div class="sl-disclosure sl-section-group">' +
    `<div class="sl-section-group-header" data-expanded="${group.expanded}">` +
    `<label class="sl-bulk-checkbox" title="${bulkLabel} ${esc(group.label)} sections">` +
    `<input class="sl-choice-input" type="checkbox" data-group-bulk="${group.id}" ` +
      `aria-label="${bulkLabel} ${esc(group.label)} sections"` +
      `${allIncluded ? ' checked' : ''}` +
      `${mixed ? ' data-mixed="true" aria-checked="mixed"' : ''}` +
      `${group.total === 0 ? ' disabled' : ''} />` +
    `<span class="sl-checkbox-box" aria-hidden="true">${CHECK_GLYPH}</span>` +
    '</label>' +
    `<button class="sl-disclosure-trigger" type="button" data-group="${group.id}" ` +
      `aria-expanded="${group.expanded}" aria-controls="${panelId}">` +
      `<span class="sl-section-group-title">${icon(GROUP_ICONS[group.id], 17)}` +
      `${esc(group.label)}</span>` +
      `<span class="sl-section-count">${includedLabel(group)}</span>` +
      `<span data-chevron aria-hidden="true">${icon('chevronDown', 16)}</span>` +
      '</button>' +
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
    '<span class="sl-ai-control-copy">' +
    '<strong>AI writing</strong>' +
    '<span data-tooltip-trigger>' +
    `<button class="sl-icon-button" id="sl-ai-help" type="button" aria-label="About AI writing" ` +
    `aria-describedby="sl-ai-help-text">${icon('infoCircle', 15)}</button>` +
    `<span class="sl-tooltip" id="sl-ai-help-text" role="tooltip">${AI_HELP}</span>` +
    '</span>' +
    '</span>' +
    '<label class="sl-switch-control">' +
    '<input class="sl-switch-input" id="sl-ai-toggle" type="checkbox" role="switch" ' +
    `aria-label="AI writing"${enabled ? ' checked' : ''} />` +
    '<span class="sl-switch-track" aria-hidden="true"><span class="sl-switch-thumb"></span></span>' +
    '</label>' +
    '</div>'
  );
}

export function componentScrollMarkup(
  state: ComponentScreenState,
  selection: ComponentSelection,
  facts: ComponentFacts,
): string {
  if (state.kind === 'empty') return state.waiting ? waitingMarkup() : emptyMarkup();
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
    hiddenElementsMarkup(selection, facts) +
    '<p class="sl-section-intro">Sections to include</p>' +
    groups +
    '</fieldset>'
  );
}

export function componentHeaderMarkup(state: ComponentScreenState): string {
  if (state.kind === 'empty') return '';
  return (
    '<div class="sl-page-header-copy">' +
    '<small>Selected component</small>' +
    `<h1 id="sl-component-name">${esc(state.componentName)}</h1>` +
    '</div>'
  );
}

export function componentFooterMarkup(state: ComponentScreenState): string {
  if (state.kind === 'empty') return '';
  const busy = state.kind === 'reading' || state.kind === 'building';
  const progress = componentStatusMarkup(state);
  // Both busy labels take the ellipsis. "Creating docs" without one read as a
  // second, differently-worded action rather than the same button working.
  const createLabel = state.kind === 'building'
    ? 'Creating docs…'
    : 'Create docs';
  // Both footer buttons carry a glyph, and this one keeps `filePlus` through
  // every state. Per the icon contract in design-system/components.css: one
  // button, one glyph. The old `fileDescription` was dropped because it drew
  // the finished document rather than the act and duplicated the sidebar's
  // glyph for this very screen, not because the slot should stay empty.
  return (
    (progress ? `<div class="sl-footer-progress">${progress}</div>` : '') +
    '<div class="sl-footer-actions">' +
    // The fastest path to value is component context in an agent's window,
    // and it used to require a canvas document first. Same disabled rule as
    // Create docs: both need the extracted spec, which reading produces.
    `<button class="sl-button" data-tone="secondary" id="sl-copy-component" type="button"` +
    `${busy ? ' disabled' : ''}>${icon('copy', 15)}` +
    '<span>Copy for AI</span></button>' +
    `<button class="sl-button" data-tone="primary" id="sl-create" type="button"` +
    `${busy ? ' disabled' : ''}>${icon('filePlus', 15)}` +
    `<span>${createLabel}</span></button>` +
    '</div>'
  );
}

export function componentStatusMarkup(state: ComponentScreenState): string {
  switch (state.kind) {
    case 'error':
    case 'success':
      return '';
    case 'reading':
      return progressMarkup({
        label: 'Reading the selected component',
      });
    case 'building':
      return progressMarkup({
        label: state.phase ?? (
          state.action === 'download'
            ? 'Preparing documentation'
            : 'Creating documentation'
        ),
      });
    case 'empty':
    case 'ready':
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
  // Replace, never add. Every other screen assigns the full class here, and this
  // one adding to it meant the previous screen's class stayed on the element:
  // coming back from Settings or License left `sl-settings-screen` alongside
  // `sl-component-screen`, and since the two `.sl-screen-scroll` padding rules
  // have equal specificity, the one later in the stylesheet won. The component
  // screen silently picked up Settings' 16px horizontal padding and header
  // indent. Going to Library or Foundations appeared to fix it only because
  // their padding is 0, the same as this screen's.
  refs.screen.className = 'sl-screen sl-component-screen';
  refs.pageHeader.innerHTML = componentHeaderMarkup(state);
  refs.pageHeader.hidden = state.kind === 'empty';
  refs.scroll.innerHTML = componentScrollMarkup(state, selection, facts);
  for (const input of refs.scroll.querySelectorAll<HTMLInputElement>(
    '.sl-choice-input[data-mixed="true"]',
  )) {
    input.indeterminate = true;
  }
  refs.footer.innerHTML = componentFooterMarkup(state);
  refs.footer.hidden = state.kind === 'empty';
}
