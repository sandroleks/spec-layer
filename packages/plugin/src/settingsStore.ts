/**
 * clientStorage writes that report instead of throwing. figma.clientStorage
 * rejects when unavailable or over quota; each write resolves to whether it
 * landed, so main.ts can tell the user. Figma-free: hosts are injected.
 */

/** `figma.clientStorage` satisfies it. */
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
 * The pull key per user in clientStorage, then the id in the file. The id is
 * written even if the key fails: the library exists on the server, and a file
 * that does not say so mints a duplicate next publish. A file without a local
 * key is a second editor's state. Returns whether the key landed.
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
