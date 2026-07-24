import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INBOX_DEFAULT_FOLDER,
  buildInboxFolderOptions,
  normalizeSaveFolder,
  persistSaveFolder,
  readPersistedSaveFolder,
} from "./inboxSaveFolder";

describe("inboxSaveFolder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes blank values to the default folder", () => {
    expect(normalizeSaveFolder("")).toBe(INBOX_DEFAULT_FOLDER);
    expect(normalizeSaveFolder("  Forms  ")).toBe("Forms");
  });

  it("builds a deduplicated folder list with the default first", () => {
    expect(buildInboxFolderOptions(["Forms", "Components", "Forms"])).toEqual([
      INBOX_DEFAULT_FOLDER,
      "Forms",
    ]);
  });

  it("persists and reads the last chosen folder", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });

    persistSaveFolder("Forms");
    expect(readPersistedSaveFolder()).toBe("Forms");
  });
});
