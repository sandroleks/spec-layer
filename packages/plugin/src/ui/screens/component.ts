/**
 * The "Create component docs" screen: presentation and the user's section
 * choice. Anything touching the document, proxy or canvas stays in actions.ts.
 */

import type { SectionId, GroupId } from '../docModel';
import type { AllowanceState, ComponentScreenState } from '../viewModel/contracts';
import { assertNever } from '../viewModel/contracts';
import {
  defaultSections,
  exhaustedAiNote,
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
import { esc } from '../escape';

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
  { id: 'size', label: 'Height and width' },
  { id: 'padding', label: 'Inner padding' },
  { id: 'spacing', label: 'Gaps between items' },
];

/** The tooltip on the last measurement chip still on; ui-vnext.ts reuses it when patching. */
export const MEASURE_LAST_VIEW_TITLE =
  'Keep at least one on, or clear Measurements to leave the diagram out.';

const GROUP_ICONS: Record<GroupId, IconName> = {
  usage: 'fileDescription',
  specs: 'box',
  a11y: 'accessible',
};

/** UI-only label overrides; labels come from ALL_SECTIONS, so this is empty. */
const DISPLAY_LABELS: Partial<Record<SectionId, string>> = {};

const AI_HELP =
  'With this on, AI drafts the text in sections marked AI. Measurements, ' +
  'states, and tokens always come from Figma. On the free plan, each draft ' +
  'takes 1 free AI writing use.';

/** The explanation the switch's own label cannot carry, shown as a tooltip. */
const HIDDEN_HELP =
  'Some layers in this component stay hidden until a property shows them. ' +
  'With this on, the docs include them, and the Anatomy section names that ' +
  'property for each one.';

/** States the detected leading dot, a naming convention, rather than asserting an atom. */
const ATOM_NOTICE =
  'This component’s name starts with a dot, so it’s likely a building block ' +
  'for larger ones. You can still document it on its own.';

const CHECK_GLYPH =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M20 6L9 17l-5-5"/></svg>';

/**
 * A cursor selects a component and a doc sheet comes out of it. Decorative, so
 * aria-hidden; the CSS motion stills under prefers-reduced-motion.
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
 * Shown when nothing usable is selected; a new user's first screen, so it
 * teaches the one move and offers the two starts that need no selection.
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
    `${icon('folder', 15)}<span>Open Library</span></button>` +
    '</div>' +
    '</div>'
  );
}

/**
 * Shown until main reports the first selection, so the panel never says
 * "Select a component" while one is already selected.
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
  beta?: boolean;
}): string {
  const badge = option.aiCapable
    ? '<span class="sl-badge" data-tone="accent">AI</span>'
    : '';
  const beta = option.beta ? '<span class="sl-badge">Beta</span>' : '';
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
    beta +
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

/** The variant picker, shown under the Tokens row. */
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
 * The document-wide hidden-elements switch, above "Sections to include"
 * because its flag feeds Anatomy, States, Variants, tokens and Measurements
 * alike. Drawn only when the component has such layers.
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
          `title="${esc(MEASURE_LAST_VIEW_TITLE)}"` : ''}>` +
          `<span class="sl-option-check" aria-hidden="true">${icon('check', 13)}</span>` +
          `${esc(c.label)}</button>`
        );
      },
    ).join('');
    return (
      '<div class="sl-section-details">' +
      '<span class="sl-section-option-label">Show on the diagram</span>' +
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

/** The AI writing switch, its help tooltip, and the note when the free allowance is spent. */
function aiControlMarkup(enabled: boolean, allowance: AllowanceState): string {
  const note = exhaustedAiNote(enabled, allowance);
  // `data-license-open="upgrade"` is the route the header's Upgrade already
  // takes: ui-vnext.ts sends it to CHECKOUT_URL through the main thread.
  const noteMarkup = note
    ? '<p class="sl-ai-control-note" data-tone="warning" role="status">' +
      `${esc(note)} ` +
      '<button class="sl-text-button" type="button" data-license-open="upgrade" ' +
      'aria-label="Upgrade to Pro, opens in your browser">Upgrade to Pro</button></p>'
    : '';
  return (
    // A literal, not the flag itself: `enabled` reaches here from a main-thread
    // message, and CodeQL (js/xss) tracks any message value into innerHTML.
    `<div class="sl-ai-control" data-enabled="${enabled ? 'true' : 'false'}">` +
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
    '</div>' +
    noteMarkup
  );
}

export function componentScrollMarkup(
  state: ComponentScreenState,
  selection: ComponentSelection,
  facts: ComponentFacts,
  allowance: AllowanceState = { kind: 'loading' },
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
    // `has-error` adds room at the bottom so the last control can scroll out
    // from under the floating banner, as .sl-publish-body.has-error does.
    `<fieldset class="sl-component-controls${state.kind === 'error' ? ' has-error' : ''}"` +
    `${busy ? ' disabled aria-busy="true"' : ''}>` +
    (facts.isAtom ? atomNoticeMarkup() : '') +
    aiControlMarkup(selection.aiEnabled, allowance) +
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

/**
 * `hasDoc` makes the button say Replace. Unknown counts as no doc: "Create
 * docs" is never false, since Create also replaces.
 */
export function componentFooterMarkup(state: ComponentScreenState, hasDoc = false): string {
  if (state.kind === 'empty') return '';
  const busy = state.kind === 'reading' || state.kind === 'building';
  const progress = componentStatusMarkup(state);
  // Both busy labels take the ellipsis: the same button working, not a new action.
  const createLabel = state.kind === 'building'
    ? (hasDoc ? 'Replacing docs…' : 'Creating docs…')
    : (hasDoc ? 'Replace docs' : 'Create docs');
  // Both footer buttons carry a glyph, and this one keeps `filePlus` through
  // every state: one button, one glyph (design-system/components.css).
  return (
    (progress ? `<div class="sl-footer-progress">${progress}</div>` : '') +
    '<div class="sl-footer-actions">' +
    // Copy needs only the extracted spec, so it shares Create docs' disabled rule.
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
      // Same slot and banner as the Publish footer's error: it stays until the
      // next Create or selection replaces this state.
      return `<div class="sl-banner sl-footer-error" data-tone="danger" role="alert">${esc(state.message)}</div>`;
    case 'success':
      return '';
    case 'reading':
      return progressMarkup({
        label: 'Reading the selected component',
      });
    case 'building':
      // Always set: every startComponentProgress caller passes a phase list.
      return progressMarkup({ label: state.phase });
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
  hasDoc = false,
  allowance: AllowanceState = { kind: 'loading' },
): void {
  // Replace, never add: a previous screen's class left on the element would win
  // the equal-specificity `.sl-screen-scroll` padding rules.
  refs.screen.className = 'sl-screen sl-component-screen';
  refs.pageHeader.innerHTML = componentHeaderMarkup(state);
  refs.pageHeader.hidden = state.kind === 'empty';
  refs.scroll.innerHTML = componentScrollMarkup(state, selection, facts, allowance);
  for (const input of refs.scroll.querySelectorAll<HTMLInputElement>(
    '.sl-choice-input[data-mixed="true"]',
  )) {
    input.indeterminate = true;
  }
  refs.footer.innerHTML = componentFooterMarkup(state, hasDoc);
  refs.footer.hidden = state.kind === 'empty';
}
