/**
 * fontPicker.ts — where the theme font menu opens.
 *
 * Only the placement maths lives here. The menu's markup belongs to
 * screens/settings.ts and its listeners to ui-vnext.ts, because every paint
 * replaces the screen's DOM and a component that binds to its own elements
 * cannot survive that. Keeping this pure is what lets the choice of "above or
 * below the input" be unit-tested without a layout engine.
 */

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
