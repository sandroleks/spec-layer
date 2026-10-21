/**
 * The usage data setting as it is stored: the per-user switch and the random
 * install id events are counted under. Shared by the main thread, which owns
 * clientStorage, and the UI, which sends the events, so it imports nothing
 * and touches no global (Figma's sandbox).
 */

import { INSTALL_ID_RE } from '@spec-layer/extractor';

/** clientStorage keys. */
export const USAGE_DATA_KEY = 'usageData';
export const USAGE_INSTALL_KEY = 'usageInstallId';

/**
 * On until a person turns it off. The manifest's network reasoning, the
 * Settings copy and the privacy policy all say so; change them with this.
 */
export const USAGE_DATA_DEFAULT = true;

/** A stored boolean is the answer; anything else reads as the default. */
export function storedUsageDataEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : USAGE_DATA_DEFAULT;
}

/** A stored id of the right shape, else null, so a damaged entry is minted again. */
export function storedInstallId(value: unknown): string | null {
  return typeof value === 'string' && INSTALL_ID_RE.test(value) ? value : null;
}
