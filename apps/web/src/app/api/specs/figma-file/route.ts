import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { parseFrontmatter, serializeFrontmatter } from "@spec-layer/format";
import { getContentDir } from "@/lib/config";
import { authorizeApiRequest, corsHeaders, isSafeSlug } from "@/lib/specApi";
import { updateStoredSpec } from "@/lib/specWriter";

export const dynamic = "force-dynamic";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

interface Body {
  slug?: string[];
  fileKeyOrUrl?: string;
}

/**
 * Accept either a full Figma URL ("https://www.figma.com/design/{key}/...") or
 * a bare file key. Returns the canonical key or null.
 */
function parseFileKey(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[A-Za-z0-9]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * POST /api/specs/figma-file — attach a Figma file key to an existing spec.
 *
 * Updates two artifacts so previews work everywhere:
 *  - the markdown frontmatter (`component.figma_file`) — what the page reads
 *  - the `.spec-data/*.json` sidecar (`figmaFile`)       — what the Specs tab reads
 */
export async function POST(req: NextRequest) {
  const access = authorizeApiRequest(req);
  if (access.response) return access.response;
  const { headers } = access;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers });
  }

  if (!isSafeSlug(body.slug)) {
    return NextResponse.json({ error: "Missing or invalid 'slug'" }, { status: 400, headers });
  }
  if (typeof body.fileKeyOrUrl !== "string") {
    return NextResponse.json({ error: "Missing 'fileKeyOrUrl'" }, { status: 400, headers });
  }

  const fileKey = parseFileKey(body.fileKeyOrUrl);
  if (!fileKey) {
    return NextResponse.json(
      { error: "Couldn't detect a Figma file key — paste the full Figma URL." },
      { status: 400, headers },
    );
  }

  const contentDir = getContentDir();
  const mdPath = path.join(contentDir, ...body.slug) + ".md";
  if (!fs.existsSync(mdPath)) {
    return NextResponse.json({ error: "Component not found" }, { status: 404, headers });
  }

  // Update markdown frontmatter
  try {
    const raw = fs.readFileSync(mdPath, "utf-8");
    const { frontmatter, body: docBody } = parseFrontmatter(raw);
    const next = {
      ...frontmatter,
      component: { ...frontmatter.component, figma_file: fileKey },
    };
    fs.writeFileSync(mdPath, serializeFrontmatter(next, docBody), "utf-8");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not update markdown frontmatter" },
      { status: 400, headers },
    );
  }

  // Update JSON sidecar when present. updateStoredSpec is a no-op (returns
  // false) when there is no sidecar for this slug, and preserves whatever
  // version envelope (or lack of one) the sidecar already carries — see the
  // helper's doc comment for why that matters.
  try {
    updateStoredSpec(body.slug, (spec) => {
      spec.figmaFile = fileKey;
    });
  } catch {
    // Sidecar update is best-effort — the markdown is the source of truth
    // for the page, so we don't fail the request on this.
  }

  return NextResponse.json({ ok: true, fileKey }, { headers });
}
