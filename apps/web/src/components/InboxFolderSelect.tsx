"use client";

import { useEffect, useMemo, useState } from "react";
import {
  INBOX_DEFAULT_FOLDER,
  buildInboxFolderOptions,
  normalizeSaveFolder,
} from "@/lib/inboxSaveFolder";

const CUSTOM_OPTION = "__custom__";

interface InboxFolderSelectProps {
  folderOptions: string[];
  value: string;
  onChange: (folder: string) => void;
  disabled?: boolean;
  id?: string;
  compact?: boolean;
}

export default function InboxFolderSelect({
  folderOptions,
  value,
  onChange,
  disabled,
  id,
  compact = false,
}: InboxFolderSelectProps) {
  const options = useMemo(() => buildInboxFolderOptions(folderOptions), [folderOptions]);
  const known = options.includes(value);
  const [customMode, setCustomMode] = useState(!known);

  useEffect(() => {
    if (options.includes(value)) setCustomMode(false);
  }, [value, options]);

  if (customMode) {
    return (
      <div className={`inbox-folder-field${compact ? " inbox-folder-field-compact" : ""}`}>
        <label className="inbox-destination" htmlFor={id}>
          <span className="inbox-destination-label">Save to</span>
          <input
            id={id}
            value={value}
            onChange={(event) => onChange(normalizeSaveFolder(event.target.value))}
            disabled={disabled}
            placeholder="Folder name"
            aria-label="New folder name"
          />
        </label>
        <button
          type="button"
          className="btn-link inbox-folder-mode-toggle"
          onClick={() => {
            onChange(INBOX_DEFAULT_FOLDER);
            setCustomMode(false);
          }}
          disabled={disabled}
        >
          Choose existing
        </button>
      </div>
    );
  }

  return (
    <label className={`inbox-destination${compact ? " inbox-destination-compact" : ""}`} htmlFor={id}>
      <span className="inbox-destination-label">Save to</span>
      <select
        id={id}
        value={known ? value : INBOX_DEFAULT_FOLDER}
        onChange={(event) => {
          if (event.target.value === CUSTOM_OPTION) {
            setCustomMode(true);
            onChange("");
            return;
          }
          onChange(event.target.value);
        }}
        disabled={disabled}
        aria-label="Destination folder"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value={CUSTOM_OPTION}>New folder…</option>
      </select>
    </label>
  );
}
