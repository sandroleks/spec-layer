import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { IntermediateSpec } from "@spec-layer/extractor";
import { SPEC_VERSION } from "@spec-layer/format";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStoredSpec, readStoredSpecEnvelope } from "@/lib/specWriter";
import { POST } from "./route";

let contentDir: string;

beforeEach(() => {
  contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-figma-file-route-"));
  process.env.DS_CONTENT_DIR = contentDir;
});

afterEach(() => {
  delete process.env.DS_CONTENT_DIR;
  fs.rmSync(contentDir, { recursive: true, force: true });
});

const VALID_MD = [
  "---",
  `spec_version: "${SPEC_VERSION}"`,
  "component:",
  "  name: Button",
  "  figma_key: component-key",
  "  figma_file: old-file-key",
  '  figma_node: "12:34"',
  // Quoted: an unquoted run of zero digits parses as the YAML integer 0,
  // which is falsy and trips parseFrontmatter's "Missing content_hash" check.
  'content_hash: "' + "0".repeat(64) + '"',
  'extracted_at: "2026-06-10T00:00:00.000Z"',
  "---",
  "",
  "## Definition",
  "",
  "A button.",
  "",
].join("\n");

function storedSpec(): IntermediateSpec {
  return {
    name: "Button",
    figmaKey: "component-key",
    figmaFile: "old-file-key",
    figmaNode: "12:34",
    anatomy: [],
    anatomyComponentId: "",
    props: [],
    variants: [],
    variantInstances: [],
    states: [],
    tokens: [],
    related: [],
    gaps: [],
    layout: [],
    rawValues: [],
    contrast: { evaluated: 0, skipped: 0, findings: [] },
  };
}

/** Write the markdown doc plus a sidecar in the shape a given era produced. */
function seed(sidecar: unknown): void {
  const md = path.join(contentDir, "_inbox", "button.md");
  fs.mkdirSync(path.dirname(md), { recursive: true });
  fs.writeFileSync(md, VALID_MD, "utf-8");
  const data = path.join(contentDir, ".spec-data", "_inbox", "button.json");
  fs.mkdirSync(path.dirname(data), { recursive: true });
  fs.writeFileSync(data, JSON.stringify(sidecar), "utf-8");
}

function request(fileKeyOrUrl: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/specs/figma-file", {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
    }),
    body: JSON.stringify({ slug: ["_inbox", "button"], fileKeyOrUrl }),
  });
}

const NEW_FILE_KEY = "brandnewfilekey123";

describe("POST /api/specs/figma-file", () => {
  // This is the regression the route previously shipped: it parsed the sidecar
  // with `JSON.parse(...) as IntermediateSpec` and wrote `figmaFile` onto that
  // *envelope*, leaving the real `spec.figmaFile` (what every other reader
  // uses) untouched. The response still said `{ ok: true }`, so nothing ever
  // surfaced the failure — this is the assertion that would have caught it.
  it("updates the figmaFile that readStoredSpec actually returns, not a stray top-level key", async () => {
    seed({ spec_version: SPEC_VERSION, spec: storedSpec() });

    const response = await POST(request(NEW_FILE_KEY));
    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: boolean; fileKey: string };
    expect(json.ok).toBe(true);
    expect(json.fileKey).toBe(NEW_FILE_KEY);

    const rehydrated = readStoredSpec(["_inbox", "button"]);
    expect(rehydrated?.figmaFile).toBe(NEW_FILE_KEY);

    // The sidecar must still be a well-formed envelope with nothing stray
    // bolted on next to it.
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(contentDir, ".spec-data", "_inbox", "button.json"), "utf-8"),
    );
    expect(onDisk).toEqual({ spec_version: SPEC_VERSION, spec: { ...storedSpec(), figmaFile: NEW_FILE_KEY } });
    expect(Object.keys(onDisk)).toEqual(["spec_version", "spec"]);
  });

  it("updates figmaFile on a legacy bare sidecar without stamping it with the current version", async () => {
    // Every sidecar written before the version envelope existed looks like
    // this. If the route (or the helper behind it) upgraded it to
    // { spec_version: SPEC_VERSION, spec } while making this one-field edit,
    // it would tell regenerate/route.ts's 409 guard that a current extractor
    // produced this spec — exactly the lie the envelope exists to prevent.
    seed(storedSpec()); // bare spec, the pre-envelope shape

    const response = await POST(request(NEW_FILE_KEY));
    expect(response.status).toBe(200);

    const rehydrated = readStoredSpec(["_inbox", "button"]);
    expect(rehydrated?.figmaFile).toBe(NEW_FILE_KEY);

    expect(readStoredSpecEnvelope(["_inbox", "button"])?.specVersion).toBeNull();

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(contentDir, ".spec-data", "_inbox", "button.json"), "utf-8"),
    );
    expect(onDisk).toEqual({ ...storedSpec(), figmaFile: NEW_FILE_KEY });
  });

  it("still succeeds and updates only the markdown when there is no sidecar", async () => {
    const md = path.join(contentDir, "_inbox", "button.md");
    fs.mkdirSync(path.dirname(md), { recursive: true });
    fs.writeFileSync(md, VALID_MD, "utf-8");

    const response = await POST(request(NEW_FILE_KEY));
    expect(response.status).toBe(200);
    expect(fs.existsSync(path.join(contentDir, ".spec-data", "_inbox", "button.json"))).toBe(false);

    const rewritten = fs.readFileSync(md, "utf-8");
    expect(rewritten).toContain(NEW_FILE_KEY);
  });
});
