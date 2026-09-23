/**
 * componentFormat.ts — how component context leaves the plugin: YAML or
 * Markdown.
 *
 * Shared by the main thread, which stores the choice, and the UI, which uses
 * it. It imports nothing and touches no global, so it is safe in Figma's
 * sandbox. The values are the CLI's own (`--component-format yaml|md`), so a
 * setup command can carry the plugin's value through unchanged.
 */

export const COMPONENT_FORMATS = ['yaml', 'md'] as const;

export type ComponentFormat = (typeof COMPONENT_FORMATS)[number];

/** YAML, on both sides: every existing repository and guide names YAML files. */
export const DEFAULT_COMPONENT_FORMAT: ComponentFormat = 'yaml';

export function isComponentFormat(value: unknown): value is ComponentFormat {
  return typeof value === 'string' && (COMPONENT_FORMATS as readonly string[]).includes(value);
}

/**
 * A stored value as a format. Missing or unrecognised reads as the default
 * rather than as a guess at what was meant.
 */
export function storedComponentFormat(value: unknown): ComponentFormat {
  return isComponentFormat(value) ? value : DEFAULT_COMPONENT_FORMAT;
}

/** What the plugin calls each format on screen. It never shows `md`. */
export const COMPONENT_FORMAT_NAME: Record<ComponentFormat, string> = {
  yaml: 'YAML',
  md: 'Markdown',
};
