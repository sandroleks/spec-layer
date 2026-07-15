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

  function renderMenu(): void {
    menu.textContent = '';
    const def = document.createElement('div');
    def.className = 'font-option default';
    def.dataset.value = '';
    def.textContent = 'Default (Inter)';
    menu.appendChild(def);
    for (const family of filterFamilies(families, input.value)) {
      const row = document.createElement('div');
      row.className = 'font-option';
      row.dataset.value = family;
      row.textContent = family;
      menu.appendChild(row);
    }
    activeIndex = -1;
  }

  function openMenu(): void {
    if (families.length === 0) return; // degraded free-text mode
    renderMenu();
    menu.hidden = false;
    open = true;
  }

  function closeMenu(): void {
    menu.hidden = true;
    open = false;
    activeIndex = -1;
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

  input.addEventListener('focus', openMenu);
  input.addEventListener('input', () => {
    if (open) renderMenu();
    else openMenu();
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
