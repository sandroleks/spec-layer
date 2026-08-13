import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { draftProse, renderSpec } from "@spec-layer/extractor";
import { getContentDir } from "@/lib/config";
import { createSpecCache } from "@/lib/specCache";
import { readStoredSpecEnvelope } from "@/lib/specWriter";
import { SPEC_VERSION } from "@spec-layer/format";
import { authorizeApiRequest, corsHeaders, isSafeSlug } from "@/lib/specApi";
import { getAnthropicKey } from "@/lib/settings";

export const dynamic = "force-dynamic";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

interface RegenerateBody {
  slug?: string[];
}

export async function POST(req: NextRequest) {
  const access = authorizeApiRequest(req);
  if (access.response) return access.response;
  const { headers } = access;

  let body: RegenerateBody;
  try {
    body = (await req.json()) as RegenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers });
  }

  if (!isSafeSlug(body.slug)) {
    return NextResponse.json({ error: "Missing or invalid 'slug'" }, { status: 400, headers });
  }

  const filePath = path.join(getContentDir(), ...body.slug) + ".md";
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Spec file not found" }, { status: 400, headers });
  }

  const stored = readStoredSpecEnvelope(body.slug);
  if (!stored) {
    return NextResponse.json(
      { error: "no stored extraction for this spec; re-import from the plugin" },
      { status: 409, headers },
    );
  }
  const storedSpec = stored.spec;

  // renderSpec hard-writes the CURRENT SPEC_VERSION and a fresh content hash, so
  // re-rendering an older extraction stamps 0.1-era output as if this extractor
  // had produced it: merged same-named sibling parts, the old State-only state
  // detection, and token rules from the minimizer that fabricated bindings. The
  // document then looks current and nothing will ever prompt a rebuild for it,
  // which is precisely what the version field exists to prevent.
  //
  // The token-shape guard below cannot catch this: `conditions` predates the 0.2
  // extractor, so every pre-0.2 sidecar sails straight through it.
  if (stored.specVersion !== SPEC_VERSION) {
    return NextResponse.json(
      {
        error:
          `stored extraction was produced by spec version ${stored.specVersion ?? "0.1"}, ` +
          `not ${SPEC_VERSION}; re-import from the plugin`,
      },
      { status: 409, headers },
    );
  }

  // Extractions stored before the token-rule format carry flat bindings
  // without a `conditions` field — they can't be re-rendered faithfully.
  const staleTokens = storedSpec.tokens.some(
    (t) => typeof t !== "object" || t === null || !("conditions" in t),
  );
  if (staleTokens) {
    return NextResponse.json(
      { error: "stored extraction uses an outdated format; re-import from the plugin" },
      { status: 409, headers },
    );
  }

  let warning: string | undefined;
  const apiKey = getAnthropicKey() ?? null;
  let prose = null;

  if (apiKey) {
    try {
      prose = await draftProse(storedSpec, {
        apiKey,
        fetcher: fetch,
        cacheStore: createSpecCache(),
      });
    } catch (error) {
      warning = `AI enrichment failed; regenerated structural-only draft. ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  } else {
    warning = "No Anthropic API key configured; regenerated structural-only draft.";
  }

  try {
    const markdown = renderSpec(storedSpec, {
      prose,
      extractedAt: new Date().toISOString(),
    });
    fs.writeFileSync(filePath, markdown, "utf-8");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to regenerate spec" },
      { status: 500, headers },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      slug: body.slug,
      enriched: prose !== null,
      ...(warning ? { warning } : {}),
    },
    { headers },
  );
}
