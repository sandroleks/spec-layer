/**
 * sidebar.ts — the 52px navigation rail.
 *
 * The rail is five workflow destinations in three groups, then a spacer, then
 * the utility links. Selection is a background fill plus a blue icon: no left
 * marker, no outline. Labels are always present as accessible names even
 * though only the tooltip shows them.
 */

import { navigation, type NavigationItem, type PluginView } from '../viewModel/contracts';
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

function railButton(item: NavigationItem, active: PluginView, badge: number | undefined): string {
  const current = item.id === active ? ' aria-current="page"' : '';
  const count = badge && badge > 0
    ? `<span class="sl-sidebar-badge" aria-hidden="true">${badge}</span>`
    : '';
  return (
    '<div class="sl-sidebar-item" data-tooltip-trigger>' +
    `<button class="sl-icon-button" type="button" data-view="${item.id}"${current} ` +
    `aria-label="${item.label}">${icon(railIcon(item.id))}${count}</button>` +
    `<span class="sl-tooltip" role="tooltip">${item.label}</span>` +
    '</div>'
  );
}

export function sidebarMarkup(
  active: PluginView,
  badges: Partial<Record<PluginView, number>>,
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
    `<a class="sl-icon-button" id="rail-site" href="#" target="_blank" rel="noopener" ` +
    `aria-label="${SITE_LABEL}">${icon('world')}</a>` +
    `<a class="sl-icon-button" id="rail-linkedin" href="#" target="_blank" rel="noopener" ` +
    `aria-label="${LINKEDIN_LABEL}">${icon('brandLinkedin')}</a>` +
    '<div class="sl-sidebar-item" data-tooltip-trigger>' +
    `<button class="sl-icon-button" id="rail-help" type="button" ` +
    `aria-label="Help & feedback">${icon('helpCircle')}</button>` +
    '<span class="sl-tooltip" role="tooltip">Help & feedback</span>' +
    '</div>' +
    '</div>' +
    '</nav>'
  );
}

/** Repaint one live badge without rebuilding the rail or losing focus. */
export function setRailBadge(
  root: HTMLElement,
  view: PluginView,
  count: number,
): void {
  const button = root.querySelector<HTMLButtonElement>(`[data-view="${view}"]`);
  if (!button) return;
  button.querySelector('.sl-sidebar-badge')?.remove();
  if (count <= 0) return;
  const badge = document.createElement('span');
  badge.className = 'sl-sidebar-badge';
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = String(count);
  button.appendChild(badge);
}
