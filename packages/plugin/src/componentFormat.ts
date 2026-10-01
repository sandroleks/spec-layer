/**
 * How component context leaves the plugin: YAML or Markdown. Shared by the main
 * thread and the UI, so it imports nothing and touches no global (Figma's
 * sandbox). The values are the CLI's (`--component-format yaml|md`), so a setup
 * command carries the plugin's value through unchanged.
 */

export const COMPONENT_FORMATS = ['yaml', 'md'] as const;

export type ComponentFormat = (typeof COMPONENT_FORMATS)[number];

/** YAML, on both sides: every existing repository and guide names YAML files. */
export const DEFAULT_COMPONENT_FORMAT: ComponentFormat = 'yaml';

export function isComponentFormat(value: unknown): value is ComponentFormat {
  return typeof value === 'string' && (COMPONENT_FORMATS as readonly string[]).includes(value);
}

/** Missing or unrecognised reads as the default, never as a guess. */
export function storedComponentFormat(value: unknown): ComponentFormat {
  return isComponentFormat(value) ? value : DEFAULT_COMPONENT_FORMAT;
}

/** What the plugin calls each format on screen. It never shows `md`. */
export const COMPONENT_FORMAT_NAME: Record<ComponentFormat, string> = {
  yaml: 'YAML',
  md: 'Markdown',
};
