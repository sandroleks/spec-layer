import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { IntermediateSpec } from "@spec-layer/extractor";
import { SPEC_VERSION } from "@spec-layer/format";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";

let contentDir: string;

beforeEach(() => {
  contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-regenerate-route-"));
  process.env.DS_CONTENT_DIR = contentDir;
});

afterEach(() => {
  delete process.env.DS_CONTENT_DIR;
  fs.rmSync(contentDir, { recursive: true, force: true });
});

function storedSpec(): IntermediateSpec {
  return {
    name: "Button",
    figmaKey: "component-key",
    figmaFile: "file-key",
    figmaNode: "12:34",
    anatomy: [], anatomyComponentId: "",
    props: [], variants: [], variantInstances: [],
    states: [], tokens: [], related: [], gaps: [], layout: [], rawValues: [],
    contrast: { evaluated: 0, skipped: 0, findings: [] },
  };
}

/** Write the rendered doc plus a sidecar in the shape a given era produced. */
function seed(sidecar: unknown): void {
  const md = path.join(contentDir, "_inbox", "button.md");
  fs.mkdirSync(path.dirname(md), { recursive: true });
  fs.writeFileSync(md, "---\nname: Button\n---\n\n## Definition\n\nA button.\n", "utf-8");
  const data = path.join(contentDir, ".spec-data", "_inbox", "button.json");
  fs.mkdirSync(path.dirname(data), { recursive: true });
  fs.writeFileSync(data, JSON.stringify(sidecar), "utf-8");
}

function request(): NextRequest {
  return new NextRequest("http://localhost:3000/api/specs/regenerate", {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
    }),
    body: JSON.stringify({ slug: ["_inbox", "button"] }),
  });
}

describe("POST /api/specs/regenerate", () => {
  // renderSpec hard-writes the CURRENT spec version and a fresh content hash, so
  // re-rendering a pre-0.2 extraction would stamp 0.1-era output (merged
  // same-named parts, the old state detection, fabricated token bindings) as if
  // this extractor had made it, and nothing would ever prompt a rebuild.
  it("refuses a legacy sidecar that carries no format version", async () => {
    seed(storedSpec()); // bare spec, the pre-envelope shape
    const res = await POST(request());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("0.1");
    expect(body.error).toContain("re-import from the plugin");
  });

  it("refuses a sidecar stamped with an older version", async () => {
    seed({ spec_version: "0.1", spec: storedSpec() });
    const res = await POST(request());
    expect(res.status).toBe(409);
  });

  it("regenerates a sidecar written by the current extractor", async () => {
    seed({ spec_version: SPEC_VERSION, spec: storedSpec() });
    const res = await POST(request());
    expect(res.status).toBe(200);
    const rewritten = fs.readFileSync(path.join(contentDir, "_inbox", "button.md"), "utf-8");
    expect(rewritten).toContain(`spec_version: "${SPEC_VERSION}"`);
  });
});
