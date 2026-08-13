import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { strToU8, zipSync } from "fflate";
import type { IntermediateSpec } from "@spec-layer/extractor";
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
    contrast: [],
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
    expect(JSON.parse(fs.readFileSync(sidecarPath("button"), "utf-8"))).toEqual(spec);
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
