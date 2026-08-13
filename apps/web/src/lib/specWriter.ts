import fs from "node:fs";
import path from "node:path";
import type { IntermediateSpec } from "@spec-layer/extractor";
import { SPEC_VERSION } from "@spec-layer/format";
import { getContentDir } from "./config";

/**
 * Kebab-case a component name for use as a filename slug.
 * Mirrors the slug logic in the extractor's renderSpec so cross-links resolve.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[/\\\s,=]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Resolve the `_inbox` folder under the content dir, creating it if missing. */
export function getInboxDir(): string {
  const dir = path.join(getContentDir(), "_inbox");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface WriteSpecOptions {
  /** Overwrite an existing file with the same slug instead of suffixing. */
  overwrite?: boolean;
  /** Persist the source extraction for future regenerations. */
  spec?: IntermediateSpec;
  /**
   * The format version that PRODUCED this extraction. Defaults to this build's
   * SPEC_VERSION, which is right for a spec posted straight from a current
   * plugin. An importer that knows better (a zip whose markdown declares an
   * older `spec_version`) must pass that instead, or the sidecar claims the
   * content is current when it is not.
   */
  specVersion?: string;
}

export interface WrittenSpec {
  path: string;
  slug: string;
}

function getSpecDataDir(): string {
  const dir = path.join(getContentDir(), ".spec-data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSpecDataPath(slug: string[]): string {
  return path.join(getSpecDataDir(), ...slug) + ".json";
}

/**
 * The on-disk sidecar shape: the extraction plus the format version that
 * produced it.
 *
 * The version has to live in an envelope AROUND the spec, not as an extra key
 * inside it: `specContentHash` and the prose cache key both hash the spec object
 * as a whole, so a stray field there would move every hash it touches.
 *
 * Sidecars written before this envelope existed are bare `IntermediateSpec`
 * objects with no version at all. They are still readable (readStoredSpec
 * handles both shapes) but they report a null version, which is what lets the
 * regenerate route refuse to re-stamp 0.1-era content as 0.2 output.
 */
interface SpecSidecar {
  spec_version: string;
  spec: IntermediateSpec;
}

export interface StoredSpec {
  spec: IntermediateSpec;
  /** null for a legacy sidecar written before the version envelope. */
  specVersion: string | null;
}

function writeSpecData(slug: string[], spec: IntermediateSpec, specVersion: string): void {
  const filePath = getSpecDataPath(slug);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sidecar: SpecSidecar = { spec_version: specVersion, spec };
  fs.writeFileSync(filePath, JSON.stringify(sidecar, null, 2), "utf-8");
}

/**
 * Write a rendered spec `.md` into the `_inbox` folder using a kebab-case
 * filename derived from the component name. By default, never overwrites an
 * existing file silently: a numeric suffix (`-2`, `-3`, …) is appended until a
 * free name is found. Pass `overwrite: true` to write in place.
 */
export function writeInboxSpec(
  name: string,
  markdown: string,
  opts: WriteSpecOptions = {},
): WrittenSpec {
  const inbox = getInboxDir();
  const base = slugify(name) || "component";

  let slug = base;
  if (!opts.overwrite) {
    let n = 2;
    while (fs.existsSync(path.join(inbox, `${slug}.md`))) {
      slug = `${base}-${n}`;
      n++;
    }
  }

  const filePath = path.join(inbox, `${slug}.md`);
  fs.writeFileSync(filePath, markdown, "utf-8");
  if (opts.spec) writeSpecData(["_inbox", slug], opts.spec, opts.specVersion ?? SPEC_VERSION);
  return { path: filePath, slug };
}

/**
 * Write a raw markdown file into the `_inbox` folder without requiring a
 * structured spec. Used for manual uploads/pastes where no IntermediateSpec
 * is available. The slug/collision logic is identical to `writeInboxSpec`.
 * No `.spec-data` sidecar is written because there is no structured spec to
 * persist — that is intentional, not an oversight.
 */
export function writeInboxMarkdown(
  name: string,
  markdown: string,
  opts: Pick<WriteSpecOptions, "overwrite"> = {},
): WrittenSpec {
  return writeInboxSpec(name, markdown, { overwrite: opts.overwrite });
}

/**
 * Read a sidecar and report which format wrote it.
 *
 * Accepts both shapes: the versioned envelope, and the bare spec objects written
 * before it (reported as `specVersion: null`). Callers that only render what is
 * already there keep working with a legacy sidecar; the one caller that would
 * re-stamp it with a fresh version and content hash (the regenerate route) uses
 * the version to refuse instead.
 */
export function readStoredSpecEnvelope(slug: string[]): StoredSpec | null {
  try {
    const raw = fs.readFileSync(getSpecDataPath(slug), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "spec" in parsed && "spec_version" in parsed) {
      const envelope = parsed as SpecSidecar;
      return { spec: envelope.spec, specVersion: envelope.spec_version };
    }
    return { spec: parsed as IntermediateSpec, specVersion: null };
  } catch {
    return null;
  }
}

export function readStoredSpec(slug: string[]): IntermediateSpec | null {
  return readStoredSpecEnvelope(slug)?.spec ?? null;
}
