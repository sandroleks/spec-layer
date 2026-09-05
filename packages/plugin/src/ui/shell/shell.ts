/**
 * shell.ts — the vNext plugin frame: rail, header, screen.
 *
 * The shell owns chrome and nothing else. Screens render into `refs.screen`
 * and never touch the rail or header directly; they change the active view
 * through setActiveView so selection state has exactly one owner.
 */

import type { PluginView } from '../viewModel/contracts';
import { applyThemeMode, detectFigmaTheme, toggleThemeMode, type ThemeMode } from '../theme';
import { sidebarMarkup } from './sidebar';
import { headerMarkup, HEADER_IDS } from './header';

export interface ShellRefs {
  root: HTMLElement;
  header: HTMLElement;
  sidebar: HTMLElement;
  screen: HTMLElement;
  /** Screen title row. Screens fill it and unhide it. */
  pageHeader: HTMLElement;
  /** The only scrolling region. Screen content goes here. */
  scroll: HTMLElement;
  /** Sticky action row. Hidden until a screen has a primary action. */
  footer: HTMLElement;
  themeButton: HTMLButtonElement;
  searchButton: HTMLButtonElement;
  allowanceButton: HTMLButtonElement;
}

/**
 * .sl-plugin-shell is a two-column, two-row grid and each region is placed
 * explicitly, so the header, the rail, and the screen must all be direct
 * children. Wrapping any of them breaks the layout silently.
 */
export function shellMarkup(active: PluginView): string {
  return (
    '<div class="sl-plugin-shell">' +
    headerMarkup() +
    sidebarMarkup(active, {}) +
    '<main class="sl-screen" id="sl-screen">' +
    '<div class="sl-page-header" id="sl-page-header" hidden></div>' +
    '<div class="sl-screen-scroll" id="sl-screen-scroll"></div>' +
    '<div class="sl-screen-footer" id="sl-screen-footer" hidden></div>' +
    '</main>' +
    '</div>'
  );
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Shell is missing #${id}`);
  return el as T;
}

export function mountShell(active: PluginView = 'component'): ShellRefs {
  document.body.innerHTML = shellMarkup(active);
  const root = document.querySelector<HTMLElement>('.sl-plugin-shell');
  const header = document.querySelector<HTMLElement>('.sl-utility-header');
  const sidebar = document.querySelector<HTMLElement>('.sl-sidebar');
  if (!root || !header || !sidebar) throw new Error('Shell failed to mount');

  // Pointer activation leaves Chromium buttons focused, which keeps the
  // adjacent tooltip open after the pointer leaves the rail. Release pointer
  // focus after activation; keyboard focus is untouched, so Tab users still
  // get the same tooltip and focus ring.
  sidebar.addEventListener('pointerup', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    target.closest<HTMLButtonElement>('.sl-sidebar-item > .sl-icon-button')?.blur();
  });

  return {
    root,
    header,
    sidebar,
    screen: byId<HTMLElement>('sl-screen'),
    pageHeader: byId<HTMLElement>('sl-page-header'),
    scroll: byId<HTMLElement>('sl-screen-scroll'),
    footer: byId<HTMLElement>('sl-screen-footer'),
    themeButton: byId<HTMLButtonElement>(HEADER_IDS.theme),
    searchButton: byId<HTMLButtonElement>(HEADER_IDS.search),
    allowanceButton: byId<HTMLButtonElement>(HEADER_IDS.allowance),
  };
}

/** Move the rail's selection. The rail is the only place this state lives. */
export function setActiveView(refs: ShellRefs, view: PluginView): void {
  for (const button of refs.sidebar.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

/**
 * Wire the header's theme control. Detection and application stay in theme.ts;
 * the shell only owns the button. applyThemeMode sets `title`, so the
 * accessible name is copied from it rather than left to go stale.
 *
 * `initial` exists so callers outside Figma (the dev harness) can seed the
 * mode without re-implementing the wiring and drifting from it.
 */
export function wireShellTheme(refs: ShellRefs, initial: ThemeMode = detectFigmaTheme()): void {
  let mode: ThemeMode = initial;
  const paint = (): void => {
    applyThemeMode(refs.themeButton, mode);
    refs.themeButton.setAttribute('aria-label', refs.themeButton.title);
  };
  paint();
  refs.themeButton.addEventListener('click', () => {
    mode = toggleThemeMode(mode);
    paint();
  });
}
