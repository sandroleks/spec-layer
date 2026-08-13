import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest, corsHeaders } from "@/lib/specApi";
import { writeInboxMarkdown, writeInboxSpec } from "@/lib/specWriter";
import { selectSpecArchiveEntries, unzipWithLimits } from "@/lib/zipImport";
import { assertContentLength, PayloadTooLargeError } from "@/lib/requestLimits";
import { parseMarkdown } from "@spec-layer/format";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Safety caps — basic zip-bomb / oversized-payload guard.
// ---------------------------------------------------------------------------

/**
 * Maximum number of entries in the zip (files + directories). A sidecar-aware
 * export emits two entries per component (`<slug>.md` + `.spec-data/<slug>.json`),
 * so this is sized to allow ~1000 components, not 1000 files.
 */
const MAX_ENTRIES = 2000;

/** Maximum decompressed size of a single file (2 MB). */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Maximum total decompressed size across all files (50 MB). */
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** Maximum compressed request size (10 MB). */
const MAX_ZIP_BYTES = 10 * 1024 * 1024;

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

/**
 * The format version the imported markdown says produced it.
 *
 * A zip can carry documents exported by an older plugin, and the sidecar has to
 * record the version that actually produced the extraction rather than the
 * version of the app doing the import. Stamping our own would make a 0.1
 * extraction look current, and the regenerate route would then happily re-render
 * it under a 0.2 stamp. Falls back to undefined (meaning "assume this build's
 * version") when the frontmatter cannot be read at all.
 */
function declaredSpecVersion(markdown: string): string | undefined {
  try {
    // parseMarkdown, not parseFrontmatter: this is the same lenient read the
    // importer already used to accept the file, and a document that declares
    // its version while failing some other frontmatter rule is still telling
    // the truth about which extractor wrote it.
    const declared = parseMarkdown(markdown).data.spec_version;
    return typeof declared === "string" ? declared : undefined;
  } catch {
    return undefined;
  }
}

/**
 * POST /api/specs/upload-zip
 *
 * Accepts a `.zip` file via multipart form-data (`file` field).
 * Decompresses the zip, filters for `.md` entries, pairs mirrored
 * `.spec-data/*.json` sidecars when present, and writes each kept file to the
 * `_inbox` folder. Markdown-only files remain valid imports.
 *
 * Returns:
 *   { ok: true, imported: number, skipped: Array<{name, reason}>, slugs: string[] }
 *
 * Errors are returned as JSON with an appropriate HTTP status.
 */
export async function POST(req: NextRequest) {
  const access = authorizeApiRequest(req);
  if (access.response) return access.response;
  const { headers } = access;

  try {
    assertContentLength(req.headers, MAX_ZIP_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413, headers });
    }
    throw error;
  }

  const contentType = req.headers.get("content-type") ?? "";

  let zipBytes: Uint8Array;

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "Could not parse multipart body" }, { status: 400, headers });
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' field in form data" }, { status: 400, headers });
    }

    if (file.size > MAX_ZIP_BYTES) {
      return NextResponse.json(
        { error: `Zip file exceeds ${MAX_ZIP_BYTES} bytes` },
        { status: 413, headers },
      );
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "zip" && file.type !== "application/zip" && file.type !== "application/x-zip-compressed") {
      return NextResponse.json(
        { error: "File must be a .zip archive" },
        { status: 400, headers },
      );
    }

    try {
      zipBytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      return NextResponse.json({ error: "Could not read file contents" }, { status: 400, headers });
    }
  } else if (contentType.includes("application/zip") || contentType.includes("application/x-zip-compressed")) {
    // Raw binary body (application/zip).
    try {
      zipBytes = new Uint8Array(await req.arrayBuffer());
    } catch {
      return NextResponse.json({ error: "Could not read request body" }, { status: 400, headers });
    }
  } else {
    return NextResponse.json(
      { error: "Expected multipart/form-data with a .zip file field, or a raw application/zip body" },
      { status: 400, headers },
    );
  }

  // Decompress.
  let rawEntries: Record<string, Uint8Array>;
  try {
    rawEntries = unzipWithLimits(zipBytes, {
      maxEntries: MAX_ENTRIES,
      maxFileBytes: MAX_FILE_BYTES,
      maxTotalBytes: MAX_TOTAL_BYTES,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400, headers },
    );
  }

  // Filter, decode, and pair mirrored `.spec-data` sidecars when present.
  const { files, skipped } = selectSpecArchiveEntries(rawEntries);

  // Write each kept file; collect per-file failures without aborting the batch.
  const slugs: string[] = [];
  let imported = 0;
  const writeFailures: Array<{ name: string; reason: string }> = [];

  for (const { name, markdown, spec } of files) {
    try {
      const written = spec
        ? writeInboxSpec(name, markdown, { spec, specVersion: declaredSpecVersion(markdown) })
        : writeInboxMarkdown(name, markdown);
      slugs.push(written.slug);
      imported++;
    } catch (e) {
      writeFailures.push({
        name,
        reason: e instanceof Error ? e.message : "Failed to write file",
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      imported,
      skipped: [...skipped, ...writeFailures],
      slugs,
    },
    { headers },
  );
}
