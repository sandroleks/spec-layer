/**
 * fontPicker.ts — a searchable combobox for the theme font fields.
 *
 * Replaces the old <input list> + <datalist>. The menu lists only compatible
 * families (filtered on the main thread, see fonts.ts); typing filters,
 * ArrowUp/Down navigate, Enter or click commits, Esc closes. Free-typed text
 * still commits on Enter/blur so an unlisted family remains possible (the
 * caller shows a fallback hint for those). If setFamilies is never called
 * (main thread could not list fonts) the menu never opens and the input
 * degrades to plain free text.
 */
import { filterFamilies } from '../fonts';

const MENU_GAP = 4; // px between the input and the menu
const MENU_MARGIN = 8; // px kept clear of the window edge
const MENU_DESIRED_HEIGHT = 190; // px, matches the CSS max-height

export interface MenuRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface MenuPlacement {
  /** Set when opening downward: distance from the viewport top. */
  top?: number;
  /** Set when opening upward: distance from the viewport bottom. Anchoring by
   *  bottom keeps the menu flush to the input as the filtered list shrinks. */
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
}

/**
 * Decide where a fixed-position menu should sit relative to its input, so it
 * never gets clipped by the window edge. Opens downward normally; flips up
 * when there is not enough room below and more room above. Pure (no DOM), so
 * the geometry is unit-tested. Coordinates are viewport-relative (for
 * position: fixed), which escapes the settings panel's overflow clipping.
 */
export function computeMenuPlacement(
  input: MenuRect,
  viewportHeight: number,
  desiredHeight = MENU_DESIRED_HEIGHT,
): MenuPlacement {
  const spaceBelow = viewportHeight - input.bottom - MENU_GAP - MENU_MARGIN;
  const spaceAbove = input.top - MENU_GAP - MENU_MARGIN;
  const openUp = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
  const room = Math.max(0, openUp ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(desiredHeight, room);
  const base = { left: input.left, width: input.width, maxHeight, openUp };
  return openUp
    ? { ...base, bottom: viewportHeight - input.top + MENU_GAP }
    : { ...base, top: input.bottom + MENU_GAP };
}

export interface FontPickerOpts {
  /** The .font-picker wrapper containing the input and the .font-menu div. */
  root: HTMLElement;
  /** Called with the trimmed committed value; '' means clear to default. */
  onCommit: (value: string) => void;
}

export interface FontPicker {
  setFamilies(families: string[]): void;
}

export function createFontPicker(opts: FontPickerOpts): FontPicker {
  const input = opts.root.querySelector('input') as HTMLInputElement;
  const menu = opts.root.querySelector('.font-menu') as HTMLElement;
  let families: string[] = [];
  let open = false;
  let activeIndex = -1; // highlighted row, -1 = none

  const rows = (): HTMLElement[] => Array.from(menu.querySelectorAll('.font-option'));

  // showAll ignores the current input text so the whole list is browsable on
  // open (otherwise a committed value pre-filters the list to just itself and
  // you can never pick a different family). Typing then filters normally.
  function renderMenu(showAll = false): void {
    const query = showAll ? '' : input.value;
    menu.textContent = '';
    const def = document.createElement('div');
    def.className = 'font-option default';
    def.dataset.value = '';
    def.textContent = 'Default (Inter)';
    menu.appendChild(def);
    for (const family of filterFamilies(families, query)) {
      const row = document.createElement('div');
      row.className = 'font-option';
      row.dataset.value = family;
      row.textContent = family;
      menu.appendChild(row);
    }
    activeIndex = -1;
  }

  // Pre-highlight the currently committed family (if listed) so it is the
  // starting point for arrow keys and is scrolled into view on open.
  function highlightCurrent(): void {
    const val = input.value.trim();
    if (!val) return;
    const all = rows();
    const idx = all.findIndex((r) => r.dataset.value === val);
    if (idx < 0) return;
    activeIndex = idx;
    all[idx].classList.add('active');
    all[idx].scrollIntoView({ block: 'nearest' });
  }

  // The menu is position: fixed (see CSS) so it escapes the settings panel's
  // overflow clipping and the window edge. We must therefore place it in
  // viewport coordinates ourselves and keep it anchored as the panel scrolls.
  function positionMenu(): void {
    const r = input.getBoundingClientRect();
    const p = computeMenuPlacement(r, window.innerHeight);
    menu.style.left = `${p.left}px`;
    menu.style.width = `${p.width}px`;
    menu.style.maxHeight = `${p.maxHeight}px`;
    if (p.openUp) {
      menu.style.top = 'auto';
      menu.style.bottom = `${p.bottom}px`;
    } else {
      menu.style.bottom = 'auto';
      menu.style.top = `${p.top}px`;
    }
  }

  const reposition = (): void => { if (open) positionMenu(); };

  function openMenu(showAll = true): void {
    if (families.length === 0) return; // degraded free-text mode
    renderMenu(showAll);
    menu.hidden = false;
    open = true;
    positionMenu();
    if (showAll) highlightCurrent();
    // Reposition (not close) so the menu tracks the input while the panel
    // scrolls or the window resizes. Capture phase catches the scrolling
    // ancestor's scroll events too.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
  }

  function closeMenu(): void {
    menu.hidden = true;
    open = false;
    activeIndex = -1;
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
  }

  function commit(value: string): void {
    closeMenu();
    opts.onCommit(value.trim());
  }

  function setActive(next: number): void {
    const all = rows();
    if (all.length === 0) return;
    activeIndex = ((next % all.length) + all.length) % all.length;
    all.forEach((row, i) => row.classList.toggle('active', i === activeIndex));
    all[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('focus', () => {
    // Select the text so the first keystroke replaces the committed value, and
    // open the full list so any family is reachable.
    input.select();
    openMenu(true);
  });
  input.addEventListener('input', () => {
    if (open) { renderMenu(false); positionMenu(); }
    else openMenu(false);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) openMenu();
      setActive(e.key === 'ArrowDown' ? activeIndex + 1 : activeIndex - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = open && activeIndex >= 0 ? rows()[activeIndex] : null;
      commit(active ? (active.dataset.value ?? '') : input.value);
    } else if (e.key === 'Escape') {
      closeMenu();
    }
  });
  // mousedown, not click: it fires before focusout would commit the raw text.
  menu.addEventListener('mousedown', (e) => {
    const row = (e.target as HTMLElement).closest('.font-option') as HTMLElement | null;
    if (!row) return;
    e.preventDefault(); // keep focus on the input
    commit(row.dataset.value ?? '');
  });
  opts.root.addEventListener('focusout', (e) => {
    if (opts.root.contains(e.relatedTarget as Node | null)) return;
    closeMenu();
    commit(input.value);
  });

  return {
    setFamilies(next: string[]): void {
      families = next;
      if (open) renderMenu();
    },
  };
}
