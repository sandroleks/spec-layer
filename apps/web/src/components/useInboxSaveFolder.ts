"use client";

import { useCallback, useEffect, useState } from "react";
import {
  normalizeSaveFolder,
  persistSaveFolder,
  readPersistedSaveFolder,
} from "@/lib/inboxSaveFolder";

export function useInboxSaveFolder() {
  const [folder, setFolderState] = useState(readPersistedSaveFolder);

  useEffect(() => {
    setFolderState(readPersistedSaveFolder());
  }, []);

  const setFolder = useCallback((value: string) => {
    setFolderState(persistSaveFolder(value));
  }, []);

  return {
    folder,
    setFolder,
    folderLabel: normalizeSaveFolder(folder),
  };
}
