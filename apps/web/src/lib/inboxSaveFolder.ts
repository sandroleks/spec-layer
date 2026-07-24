export const INBOX_DEFAULT_FOLDER = "Components";
export const INBOX_SAVE_FOLDER_KEY = "inbox-save-folder";

export function normalizeSaveFolder(value: string): string {
  const trimmed = value.trim();
  return trimmed || INBOX_DEFAULT_FOLDER;
}

export function readPersistedSaveFolder(): string {
  try {
    return normalizeSaveFolder(sessionStorage.getItem(INBOX_SAVE_FOLDER_KEY) ?? INBOX_DEFAULT_FOLDER);
  } catch {
    return INBOX_DEFAULT_FOLDER;
  }
}

export function persistSaveFolder(value: string): string {
  const normalized = normalizeSaveFolder(value);
  try {
    sessionStorage.setItem(INBOX_SAVE_FOLDER_KEY, normalized);
  } catch {
    // Ignore storage failures in private mode or during SSR.
  }
  return normalized;
}

export function buildInboxFolderOptions(folderOptions: string[]): string[] {
  return Array.from(new Set([INBOX_DEFAULT_FOLDER, ...folderOptions]));
}
