/**
 * icons.ts — the shell's icon set as inner SVG markup.
 *
 * Hand-authored in the same 24-viewBox stroked style the plugin already uses
 * (theme.ts, dom.ts) rather than pulled from an icon package: the UI ships as
 * one embedded HTML file and takes no runtime dependencies. `world` is an
 * existing path from dom.ts; `sun` and `moon` are existing paths from theme.ts.
 * `brandLinkedin` is intentionally a stroked badge rather than the solid logo
 * in dom.ts, because a solid fill cannot survive the shared `fill="none"` stroke
 * wrapper.
 *
 * Values are inner markup only. `icon()` owns the wrapper so every glyph gets
 * the same sizing, stroke, and aria treatment.
 */

import type { FoundationIconKind } from '../../foundationIcon';

export const ICON_PATHS = {
  /** Generate component docs. */
  fileDescription:
    '<path d="M14 3v4a1 1 0 0 0 1 1h4"/>' +
    '<path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>' +
    '<path d="M9 13h6"/><path d="M9 17h6"/>',
  /** Generate foundation docs. */
  layoutGrid:
    '<rect x="4" y="4" width="6" height="6" rx="1"/>' +
    '<rect x="14" y="4" width="6" height="6" rx="1"/>' +
    '<rect x="4" y="14" width="6" height="6" rx="1"/>' +
    '<rect x="14" y="14" width="6" height="6" rx="1"/>',
  /** Library. A familiar folder, not a database. */
  folder:
    '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  settings:
    '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>' +
    '<circle cx="12" cy="12" r="3"/>',
  key:
    '<circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4"/>' +
    '<path d="M18 5l2 2"/><path d="M15 8l2 2"/>',
  search:
    '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:
    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  world:
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/>' +
    '<path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  brandLinkedin:
    '<rect x="3" y="3" width="18" height="18" rx="2"/>' +
    '<path d="M8 11v5"/><path d="M8 8v.01"/>' +
    '<path d="M12 16v-5"/><path d="M16 16v-3a2 2 0 0 0-4 0"/>',
  /** Disclosure affordance. The CSS rotates it 180deg when expanded. */
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  infoCircle:
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>',
  /** Section group: component anatomy and specifications. */
  box:
    '<path d="M12 3l8 4.5l0 9l-8 4.5l-8-4.5l0-9l8-4.5"/>' +
    '<path d="M12 12l8-4.5"/><path d="M12 12l0 9"/><path d="M12 12l-8-4.5"/>',
  /** Section group: accessibility guidance. */
  accessible:
    '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0"/>' +
    '<path d="M10 16.5l2-3l2 3m-2-3v-2l3-1m-6 0l3 1"/>' +
    '<path d="M11.5 7.5a.5.5 0 1 0 1 0a.5.5 0 1 0-1 0" fill="currentColor"/>',
  download:
    '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>' +
    '<path d="M7 11l5 5l5-5"/><path d="M12 4l0 12"/>',
  helpCircle:
    '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0-18 0"/>' +
    '<path d="M12 16v.01"/>' +
    '<path d="M12 13a2 2 0 0 0 .914-3.782a1.98 1.98 0 0 0-2.414 .483"/>',
  puzzle:
    '<path d="M4 7h3a1 1 0 0 0 1-1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1a2 2 0 0 0-4 0v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a2 2 0 0 0 0-4h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1"/>',
  /** Foundation row: a collection whose variables are all COLOR. */
  swatch:
    '<circle cx="9" cy="9" r="5"/><circle cx="15" cy="9" r="5"/><circle cx="12" cy="15" r="5"/>',
  /** Foundation row: a collection whose variables are all FLOAT (spacing,
   *  radius, density — a measured scale, not a single number). */
  ruler:
    '<g transform="rotate(45 12 12)">' +
    '<rect x="4" y="9" width="16" height="6" rx="1"/>' +
    '<path d="M8 9v3"/><path d="M12 9v3"/><path d="M16 9v3"/>' +
    '</g>',
  /** Foundation row: the Text styles entry. */
  typography:
    '<path d="M4.5 20l7.5-15l7.5 15"/><path d="M8 14h8"/>',
  adjustments:
    '<path d="M4 8h4v4H4z"/><path d="M6 4v4"/><path d="M6 12v8"/>' +
    '<path d="M10 14h4v4h-4z"/><path d="M12 4v10"/><path d="M12 18v2"/>' +
    '<path d="M16 5h4v4h-4z"/><path d="M18 4v1"/><path d="M18 9v11"/>',
  check: '<path d="M5 12l5 5l10-10"/>',
  bolt: '<path d="M13 3l-9 10h7l-1 8l9-11h-7l1-7"/>',
  externalLink:
    '<path d="M12 6h-6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>' +
    '<path d="M11 13l9-9"/><path d="M15 4h5v5"/>',
  alertCircle:
    '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16v.01"/>',
  circleCheck:
    '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3l5-6"/>',
  refresh:
    '<path d="M20 11a8.1 8.1 0 0 0-15.5-2m-.5-5v5h5"/>' +
    '<path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 5v-5h-5"/>',
  dots:
    '<path d="M5 12h.01"/><path d="M12 12h.01"/><path d="M19 12h.01"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6l-12 12"/>',
  chevronRight: '<path d="M9 6l6 6l-6 6"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/**
 * The glyph for a foundation source, shared by every list that shows one: the
 * Foundations tab's picker and My Library's foundation rows. One map, so a
 * collection of colors is a swatch in both places and the user learns it once.
 *
 * `box` reads as "a bundle of tokens" without borrowing `puzzle`, which the
 * Library list already owns as "this is a component."
 */
export const FOUNDATION_ICON: Record<FoundationIconKind, IconName> = {
  color: 'swatch',
  dimension: 'ruler',
  mixed: 'box',
  typography: 'typography',
};

/** A complete decorative svg. Icon-only controls carry their own aria-label. */
export function icon(name: IconName, size = 17): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`
  );
}
