/**
 * settingsStore.ts: clientStorage writes that report instead of throwing.
 *
 * figma.clientStorage rejects when the store is unavailable or over quota. An
 * `await` on it inside the message handler with no catch was an unhandled
 * rejection: the setting was lost and nothing told the user. Every write here
 * resolves to whether it landed, so main.ts can say so.
 *
 * Figma-free: the store and the plugin-data host are injected.
 */

/** The two calls this module makes. `figma.clientStorage` satisfies it. */
export interface KeyValueStore {
  setAsync(key: string, value: unknown): Promise<void>;
  deleteAsync(key: string): Promise<void>;
}

/** Where the library id lives. `figma.root` satisfies it. */
export interface PluginDataHost {
  setPluginData(key: string, value: string): void;
}

export async function writeSetting(store: KeyValueStore, key: string, value: unknown): Promise<boolean> {
  try {
    await store.setAsync(key, value);
    return true;
  } catch (err) {
    console.error('[Spec Layer] could not save', key, err);
    return false;
  }
}

export async function deleteSetting(store: KeyValueStore, key: string): Promise<boolean> {
  try {
    await store.deleteAsync(key);
    return true;
  } catch (err) {
    console.error('[Spec Layer] could not clear', key, err);
    return false;
  }
}

/**
 * Record a published library: the pull key per user in clientStorage, then
 * the id in the file.
 *
 * The key goes first so that a store rejection is known before the file is
 * touched, and the id is written either way: the library exists on the server
 * from the moment the publish succeeded, and a file that does not say so would
 * mint a duplicate on the next publish. A file that names a library this
 * device holds no key for is the same state a second editor's device is in,
 * and the Publish screen already explains it. Returns whether the key landed.
 */
export async function storePublishIdentity(
  store: KeyValueStore,
  root: PluginDataHost,
  keys: { libraryIdKey: string; pullKeyStorageKey: string },
  libraryId: string,
  pullKey: string,
): Promise<boolean> {
  const keyStored = await writeSetting(store, keys.pullKeyStorageKey, pullKey);
  root.setPluginData(keys.libraryIdKey, libraryId);
  return keyStored;
}
