import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { strToU8, zipSync } from "fflate";
import type { IntermediateSpec } from "@spec-layer/extractor";
import { SPEC_VERSION } from "@spec-layer/format";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";

let contentDir: string;

beforeEach(() => {
  contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-upload-zip-route-"));
  process.env.DS_CONTENT_DIR = contentDir;
});

afterEach(() => {
  delete process.env.DS_CONTENT_DIR;
  fs.rmSync(contentDir, { recursive: true, force: true });
});

const VALID_MD = `---
name: Button
status: draft
---

## Definition

A button.
`;

function validSpec(name = "Button"): IntermediateSpec {
  return {
    name,
    figmaKey: "component-key",
    figmaFile: "file-key",
    figmaNode: "12:34",
    anatomy: [], anatomyComponentId: "",
    props: [],
    variants: [],
    variantInstances: [
      { nodeId: "12:35", name: "Primary", values: { Type: "Primary" } },
    ],
    states: [],
    tokens: [],
    related: [],
    gaps: [],
    layout: [],
    rawValues: [],
    contrast: { evaluated: 0, skipped: 0, findings: [] },
  };
}

function zipRequest(archive: Uint8Array): NextRequest {
  const body = archive.buffer instanceof ArrayBuffer
    ? archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength)
    : new Uint8Array(archive).buffer;
  return new NextRequest("http://localhost:3000/api/specs/upload-zip", {
    method: "POST",
    headers: new Headers({
      "content-type": "application/zip",
      host: "localhost:3000",
      origin: "http://localhost:3000",
    }),
    body: new Blob([body], { type: "application/zip" }),
  });
}

function markdownPath(slug: string): string {
  return path.join(contentDir, "_inbox", `${slug}.md`);
}

function sidecarPath(slug: string): string {
  return path.join(contentDir, ".spec-data", "_inbox", `${slug}.json`);
}

describe("POST /api/specs/upload-zip", () => {
  it("imports a mirrored .spec-data sidecar with its markdown", async () => {
    const spec = validSpec("Button");
    const zip = zipSync({
      "design-system/button.md": strToU8(VALID_MD),
      ".spec-data/design-system/button.json": strToU8(JSON.stringify(spec)),
    });

    const response = await POST(zipRequest(zip));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.imported).toBe(1);
    expect(body.slugs).toEqual(["button"]);
    expect(fs.existsSync(markdownPath("button"))).toBe(true);
    // The sidecar is an envelope: the extraction plus the format version that
    // produced it. This markdown declares none, so the importing build's own
    // version is the best available answer.
    expect(JSON.parse(fs.readFileSync(sidecarPath("button"), "utf-8")))
      .toEqual({ spec_version: SPEC_VERSION, spec });
  });

  it("records the version the imported markdown declares, not this build's", async () => {
    // A zip can carry documents an older plugin exported. Stamping them as
    // current would let the regenerate route re-render 0.1 content under a 0.2
    // header, and nothing would ever prompt a rebuild for it.
    const spec = validSpec("Button");
    const legacyMd = [
      "---",
      'spec_version: "0.1"',
      "component:",
      "  name: Button",
      "  figma_key: component-key",
      "  figma_file: file-key",
      "  figma_node: \"12:34\"",
      "content_hash: " + "0".repeat(64),
      'extracted_at: "2026-06-10T00:00:00.000Z"',
      "---",
      "",
      "## Definition",
      "",
      "A button.",
      "",
    ].join("\n");
    const zip = zipSync({
      "design-system/button.md": strToU8(legacyMd),
      ".spec-data/design-system/button.json": strToU8(JSON.stringify(spec)),
    });

    const response = await POST(zipRequest(zip));
    expect(response.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(sidecarPath("button"), "utf-8")).spec_version).toBe("0.1");
  });

  it("keeps the imported sidecar aligned with collision-resolved slugs", async () => {
    fs.mkdirSync(path.join(contentDir, "_inbox"), { recursive: true });
    fs.writeFileSync(markdownPath("button"), "# existing\n", "utf-8");

    const spec = validSpec("Button");
    const zip = zipSync({
      "design-system/button.md": strToU8(VALID_MD),
      ".spec-data/design-system/button.json": strToU8(JSON.stringify(spec)),
    });

    const response = await POST(zipRequest(zip));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.imported).toBe(1);
    expect(body.slugs).toEqual(["button-2"]);
    expect(fs.existsSync(markdownPath("button-2"))).toBe(true);
    expect(fs.existsSync(sidecarPath("button-2"))).toBe(true);
    expect(fs.existsSync(sidecarPath("button"))).toBe(false);
  });
});
