/**
 * Component-naming helpers.
 */

/**
 * Atom components are named with a leading dot (e.g. `.button-base`). They're
 * building blocks not meant to be documented on their own, so the UI surfaces a
 * notice when one is selected.
 */
export function isAtomComponentName(name: string): boolean {
  return name.startsWith('.');
}
