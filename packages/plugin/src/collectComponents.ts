/**
 * Component-naming helpers.
 */

/**
 * Atom components start with a dot (`.button-base`): building blocks not meant
 * to be documented alone, so the UI shows a notice when one is selected.
 */
export function isAtomComponentName(name: string): boolean {
  return name.startsWith('.');
}
