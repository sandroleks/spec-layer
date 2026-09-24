import { describe, it, expect, vi } from 'vitest';
import { writeSetting, deleteSetting, storePublishIdentity, type KeyValueStore } from '../src/settingsStore';

function store(failOn: string[] = []): KeyValueStore & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    async setAsync(key, value) {
      if (failOn.includes(key)) throw new Error(`quota exceeded for ${key}`);
      log.push(`set ${key}=${String(value)}`);
    },
    async deleteAsync(key) {
      if (failOn.includes(key)) throw new Error(`cannot delete ${key}`);
      log.push(`delete ${key}`);
    },
  };
}

describe('writeSetting / deleteSetting', () => {
  it('report success and never throw', async () => {
    const s = store();
    expect(await writeSetting(s, 'aiEnabled', true)).toBe(true);
    expect(await deleteSetting(s, 'licenseKey')).toBe(true);
    expect(s.log).toEqual(['set aiEnabled=true', 'delete licenseKey']);
  });

  it('turn a rejected write into false and a console error, not a throw', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = store(['brandTheme', 'licenseKey']);
    expect(await writeSetting(s, 'brandTheme', { headerBg: null })).toBe(false);
    expect(await deleteSetting(s, 'licenseKey')).toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});

describe('storePublishIdentity', () => {
  const keys = { libraryIdKey: 'speclayer.publish.libraryId', pullKeyStorageKey: 'publishKey:lib_1' };
  const root = () => {
    const writes: string[] = [];
    return { writes, setPluginData: (k: string, v: string) => { writes.push(`${k}=${v}`); } };
  };

  it('stores the pull key before the library id', async () => {
    const s = store();
    const r = root();
    const order: string[] = [];
    s.setAsync = async (key, value) => { order.push(`key ${key}=${String(value)}`); };
    r.setPluginData = (k, v) => { order.push(`id ${k}=${v}`); };
    expect(await storePublishIdentity(s, r, keys, 'lib_1', 'sl_secret')).toBe(true);
    expect(order).toEqual(['key publishKey:lib_1=sl_secret', 'id speclayer.publish.libraryId=lib_1']);
  });

  it('still records the library id when the key cannot be saved, and says the key was not', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = store(['publishKey:lib_1']);
    const r = root();
    expect(await storePublishIdentity(s, r, keys, 'lib_1', 'sl_secret')).toBe(false);
    // The library exists on the server whatever this device could store, so
    // the file must say so, or the next publish mints a duplicate library.
    expect(r.writes).toEqual(['speclayer.publish.libraryId=lib_1']);
    error.mockRestore();
  });
});
