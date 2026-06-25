"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import InboxFolderSelect from "./InboxFolderSelect";
import { useInboxSaveFolder } from "./useInboxSaveFolder";
import { clearInboxItems } from "./inboxClearRequest";
import { enrichInboxItems } from "./inboxBulkRequest";
import { saveInboxItem } from "./inboxSaveRequest";

type Action = "enrich" | "save" | "delete" | null;

export default function InboxDocActions({
  slug,
  name,
  folderOptions,
}: {
  slug: string[];
  name: string;
  folderOptions: string[];
}) {
  const router = useRouter();
  const { folder, setFolder, folderLabel } = useInboxSaveFolder();

  const [busy, setBusy] = useState<Action>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onEnrich() {
    if (busy) return;
    setBusy("enrich");
    setError(null);
    setNotice(null);
    try {
      const { httpOk, data } = await enrichInboxItems([slug]);
      if (!httpOk || !data.ok) {
        setError(data.error ?? "Could not add guidelines.");
        return;
      }
      const entry = data.enriched?.[0];
      if (entry && entry.filled.length > 0) {
        setNotice(
          entry.usedVisual
            ? "Added guidelines using the Figma visual."
            : "Added guidelines.",
        );
        router.refresh();
      } else {
        setNotice("No empty guideline sections to fill.");
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onSave() {
    if (busy) return;
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const { httpOk, data } = await saveInboxItem({ slug, name }, folder);
      if (!httpOk || !data.ok) {
        setError(data.error ?? `Could not save ${name}.`);
        return;
      }
      router.push(`/components/${(data.slug ?? slug).map(encodeURIComponent).join("/")}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (busy) return;
    const confirmed = window.confirm(
      `Permanently delete ${name}? This cannot be undone.`,
    );
    if (!confirmed) return;

    setBusy("delete");
    setError(null);
    setNotice(null);
    try {
      const { httpOk, data } = await clearInboxItems([slug]);
      if (!httpOk || !data.ok) {
        setError(data.error ?? `Could not delete ${name}.`);
        return;
      }
      const failure = data.failures?.[0];
      if (failure) {
        setError(`${name}: ${failure.error}`);
        return;
      }
      router.push("/inbox");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="inbox-doc-header-side">
      <div className="header-actions inbox-doc-actions">
        <Link className="btn-link" href="/inbox">
          Back to inbox
        </Link>
        <InboxFolderSelect
          id="inbox-doc-folder"
          folderOptions={folderOptions}
          value={folder}
          onChange={setFolder}
          disabled={busy !== null}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={onEnrich}
          disabled={busy !== null}
        >
          {busy === "enrich" ? "Adding…" : "Add guidelines with AI"}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onSave}
          disabled={busy !== null}
          title={`Save to ${folderLabel}`}
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="btn-secondary inbox-danger"
          onClick={onDelete}
          disabled={busy !== null}
        >
          {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
      {notice || error ? (
        <p
          className={error ? "inbox-doc-feedback inbox-doc-feedback-error" : "inbox-doc-feedback"}
          role={error ? "alert" : "status"}
        >
          {error ?? notice}
        </p>
      ) : null}
    </div>
  );
}
