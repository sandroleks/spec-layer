/**
 * sidebar.ts — the 52px navigation rail.
 *
 * The rail is five workflow destinations in three groups, then a spacer, then
 * the utility links. Selection is a background fill plus a blue icon: no left
 * marker, no outline. Labels are always present as accessible names even
 * though only the tooltip shows them.
 */

import { navigation, type NavigationItem, type PluginView } from '../viewModel/contracts';
import { LINKEDIN_URL, SITE_URL } from '../proxy';
import { icon, type IconName } from './icons';

export interface RailBlock {
  group: NavigationItem['group'];
  items: NavigationItem[];
}

/** Collapse the flat contract into consecutive runs of the same group. */
export function railBlocks(items: readonly NavigationItem[]): RailBlock[] {
  const blocks: RailBlock[] = [];
  for (const item of items) {
    const last = blocks[blocks.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else blocks.push({ group: item.group, items: [item] });
  }
  return blocks;
}

const ICONS: Record<PluginView, IconName> = {
  component: 'fileDescription',
  foundations: 'layoutGrid',
  library: 'folder',
  settings: 'settings',
  license: 'key',
};

export function railIcon(id: PluginView): IconName {
  return ICONS[id];
}

const SITE_LABEL = 'Spec Layer website';
const LINKEDIN_LABEL = 'Spec Layer on LinkedIn';

/**
 * The badge is a dot, not a count.
 *
 * It used to print `counts.updates`, which is a number the UI only ever knows
 * progressively: source checks resolve one doc at a time, so the digit climbed
 * 1, 2, 3 as they landed, and every refresh cleared the checks and took the
 * badge away entirely before it counted back up. None of that motion told the
 * user anything they could act on. "Something in the Library needs attention"
 * is the whole message, and a dot says it without changing shape.
 *
 * The dot itself stays aria-hidden, and the state goes on the button's
 * accessible name instead: colour and shape alone are not available to a screen
 * reader, and the count never was either.
 */
function railButton(item: NavigationItem, active: PluginView, badge: boolean | undefined): string {
  const current = item.id === active ? ' aria-current="page"' : '';
  const dot = badge
    ? '<span class="sl-sidebar-badge" aria-hidden="true"></span>'
    : '';
  const label = badge ? `${item.label}, updates available` : item.label;
  return (
    '<div class="sl-sidebar-item" data-tooltip-trigger>' +
    `<button class="sl-icon-button" type="button" data-view="${item.id}"${current} ` +
    `aria-label="${label}">${icon(railIcon(item.id))}${dot}</button>` +
    `<span class="sl-tooltip" role="tooltip">${item.label}</span>` +
    '</div>'
  );
}

export function sidebarMarkup(
  active: PluginView,
  /** Which views show an attention dot. Not counts: see railButton. */
  badges: Partial<Record<PluginView, boolean>>,
): string {
  const groups = railBlocks(navigation)
    .map((block) =>
      '<div class="sl-sidebar-group">' +
      block.items.map((item) => railButton(item, active, badges[item.id])).join('') +
      '</div>')
    .join('<span class="sl-sidebar-separator" aria-hidden="true"></span>');

  return (
    '<nav class="sl-sidebar" aria-label="Workflows">' +
    groups +
    '<div class="sl-sidebar-spacer"></div>' +
    '<span class="sl-sidebar-separator" aria-hidden="true"></span>' +
    '<div class="sl-sidebar-group">' +
    `<a class="sl-icon-button" id="rail-site" href="${SITE_URL}" target="_blank" rel="noopener" ` +
    `aria-label="${SITE_LABEL}">${icon('world')}</a>` +
    `<a class="sl-icon-button" id="rail-linkedin" href="${LINKEDIN_URL}" target="_blank" rel="noopener" ` +
    `aria-label="${LINKEDIN_LABEL}">${icon('brandLinkedin')}</a>` +
    '</div>' +
    '</nav>'
  );
}

/**
 * Show or hide one live badge without rebuilding the rail or losing focus.
 *
 * Takes a boolean, not a count: see railButton. The caller decides WHEN the
 * answer is settled enough to act on (ui-vnext.ts holds the badge steady while
 * source checks are still resolving); this only draws it.
 */
export function setRailBadge(
  root: HTMLElement,
  view: PluginView,
  show: boolean,
): void {
  const button = root.querySelector<HTMLButtonElement>(`[data-view="${view}"]`);
  if (!button) return;
  const existing = button.querySelector('.sl-sidebar-badge');
  const label = LABELS[view];
  if (label) {
    button.setAttribute('aria-label', show ? `${label}, updates available` : label);
  }
  // Idempotent: re-rendering the same state must not remove and re-add the dot,
  // which would restart its transition and read as a flicker on every repaint.
  if (show === Boolean(existing)) return;
  if (!show) {
    existing?.remove();
    return;
  }
  const badge = document.createElement('span');
  badge.className = 'sl-sidebar-badge';
  badge.setAttribute('aria-hidden', 'true');
  button.appendChild(badge);
}

/** The rail's own labels, so setRailBadge can restate one without the caller. */
const LABELS: Partial<Record<PluginView, string>> = Object.fromEntries(
  navigation.map((item) => [item.id, item.label]),
);
