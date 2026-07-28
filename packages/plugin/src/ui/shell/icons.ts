/**
 * icons.ts — the shell's icon set as inner SVG markup.
 *
 * Hand-authored in the same 24-viewBox stroked style the plugin already uses
 * (theme.ts, dom.ts) rather than pulled from an icon package: the UI ships as
 * one embedded HTML file and takes no runtime dependencies. `world` and
 * `brandLinkedin` are the existing paths from dom.ts; `sun` and `moon` are the
 * existing paths from theme.ts.
 *
 * Values are inner markup only. `icon()` owns the wrapper so every glyph gets
 * the same sizing, stroke, and aria treatment.
 */

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
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** A complete decorative svg. Icon-only controls carry their own aria-label. */
export function icon(name: IconName, size = 17): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`
  );
}
