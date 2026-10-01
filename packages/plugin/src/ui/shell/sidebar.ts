/**
 * The 52px navigation rail: workflow destinations in groups, a spacer, then the
 * utility links. Labels are always the accessible names, though only tooltips
 * show them.
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

/** One rail button, drawn without a badge; setRailBadge adds it to the live button. */
function railButton(item: NavigationItem, active: PluginView): string {
  const current = item.id === active ? ' aria-current="page"' : '';
  return (
    '<div class="sl-sidebar-item" data-tooltip-trigger>' +
    `<button class="sl-icon-button" type="button" data-view="${item.id}"${current} ` +
    `aria-label="${item.label}">${icon(railIcon(item.id))}</button>` +
    `<span class="sl-tooltip" role="tooltip">${item.label}</span>` +
    '</div>'
  );
}

export function sidebarMarkup(active: PluginView): string {
  const groups = railBlocks(navigation)
    .map((block) =>
      '<div class="sl-sidebar-group">' +
      block.items.map((item) => railButton(item, active)).join('') +
      '</div>')
    .join('<span class="sl-sidebar-separator" aria-hidden="true"></span>');

  return (
    '<nav class="sl-sidebar" aria-label="Main">' +
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
 * Show or hide one live badge without rebuilding the rail or losing focus. A
 * dot, not a count: checks resolve one doc at a time, so a digit would climb
 * and vanish on every refresh. The dot is aria-hidden and the state goes on the
 * button's accessible name. The caller decides when the answer is settled.
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
