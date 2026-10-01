/**
 * Placement maths for the theme font menu, pure so it tests without a layout
 * engine. Markup is screens/settings.ts's and listeners ui-vnext.ts's, since
 * every paint replaces the screen's DOM.
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
  /** Opening down: distance from the viewport top. */
  top?: number;
  /** Opening up: distance from the viewport bottom, so the menu stays flush
   *  to the input as the list shrinks. */
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  openUp: boolean;
}

/** Opens down unless there is too little room below and more above.
 *  Viewport coordinates, for position: fixed, escape the panel's clipping. */
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
