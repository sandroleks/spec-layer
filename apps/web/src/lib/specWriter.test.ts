import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IntermediateSpec } from "@spec-layer/extractor";
import { SPEC_VERSION } from "@spec-layer/format";
import {
  getInboxDir,
  readStoredSpec,
  readStoredSpecEnvelope,
  slugify,
  updateStoredSpec,
  writeInboxMarkdown,
  writeInboxSpec,
} from "./specWriter";

let contentDir: string;

beforeEach(() => {
  contentDir = fs.mkdtempSync(path.join(os.tmpdir(), "spec-writer-"));
  process.env.DS_CONTENT_DIR = contentDir;
});

afterEach(() => {
  delete process.env.DS_CONTENT_DIR;
  fs.rmSync(contentDir, { recursive: true, force: true });
});

function inboxFile(slug: string): string {
  return path.join(contentDir, "_inbox", `${slug}.md`);
}

// A minimal stand-in; readStoredSpec only round-trips JSON, so the exact
// shape is irrelevant beyond being serializable.
const fakeSpec = { component: { name: "Button" } } as unknown as IntermediateSpec;

describe("slugify", () => {
  it("kebab-cases a component name", () => {
    expect(slugify("Primary Button")).toBe("primary-button");
  });

  it("neutralizes path-traversal sequences", () => {
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("..")).toBe("");
  });
});

describe("getInboxDir", () => {
  it("creates the _inbox directory under the content dir", () => {
    const dir = getInboxDir();
    expect(dir).toBe(path.join(contentDir, "_inbox"));
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });
});

describe("writeInboxSpec", () => {
  it("writes markdown under a slugified filename and returns its path/slug", () => {
    const result = writeInboxSpec("Primary Button", "# Button\n");
    expect(result.slug).toBe("primary-button");
    expect(result.path).toBe(inboxFile("primary-button"));
    expect(fs.readFileSync(result.path, "utf-8")).toBe("# Button\n");
  });

  it("falls back to 'component' when the name slugifies to nothing", () => {
    const result = writeInboxSpec("...", "# x\n");
    expect(result.slug).toBe("component");
    expect(fs.existsSync(inboxFile("component"))).toBe(true);
  });

  it("suffixes the slug to avoid clobbering an existing file", () => {
    const first = writeInboxSpec("Button", "# first\n");
    const second = writeInboxSpec("Button", "# second\n");
    const third = writeInboxSpec("Button", "# third\n");

    expect(first.slug).toBe("button");
    expect(second.slug).toBe("button-2");
    expect(third.slug).toBe("button-3");
    // The original file is never overwritten by the collision path.
    expect(fs.readFileSync(inboxFile("button"), "utf-8")).toBe("# first\n");
  });

  it("overwrites in place when overwrite: true", () => {
    writeInboxSpec("Button", "# original\n");
    const result = writeInboxSpec("Button", "# replaced\n", { overwrite: true });

    expect(result.slug).toBe("button");
    expect(fs.readFileSync(inboxFile("button"), "utf-8")).toBe("# replaced\n");
    expect(fs.existsSync(inboxFile("button-2"))).toBe(false);
  });

  it("persists a .spec-data sidecar stamped with the format version that wrote it", () => {
    const result = writeInboxSpec("Button", "# Button\n", { spec: fakeSpec });
    const sidecar = path.join(contentDir, ".spec-data", "_inbox", `${result.slug}.json`);
    expect(fs.existsSync(sidecar)).toBe(true);
    // The version sits in an envelope AROUND the spec: an extra key inside it
    // would move specContentHash and the prose cache key.
    expect(JSON.parse(fs.readFileSync(sidecar, "utf-8")))
      .toEqual({ spec_version: SPEC_VERSION, spec: fakeSpec });
  });

  it("records an importer-supplied version instead of this build's", () => {
    // A zip can carry docs an older plugin exported; the sidecar has to say so.
    const result = writeInboxSpec("Button", "# Button\n", { spec: fakeSpec, specVersion: "0.1" });
    const sidecar = path.join(contentDir, ".spec-data", "_inbox", `${result.slug}.json`);
    expect(JSON.parse(fs.readFileSync(sidecar, "utf-8")).spec_version).toBe("0.1");
  });

  it("writes no sidecar when no spec is provided", () => {
    const result = writeInboxSpec("Button", "# Button\n");
    const sidecar = path.join(contentDir, ".spec-data", "_inbox", `${result.slug}.json`);
    expect(fs.existsSync(sidecar)).toBe(false);
  });
});

describe("writeInboxMarkdown", () => {
  it("writes markdown without a sidecar even when collisions occur", () => {
    const first = writeInboxMarkdown("Button", "# a\n");
    const second = writeInboxMarkdown("Button", "# b\n");

    expect(first.slug).toBe("button");
    expect(second.slug).toBe("button-2");
    expect(
      fs.existsSync(path.join(contentDir, ".spec-data", "_inbox", "button.json")),
    ).toBe(false);
  });
});

describe("readStoredSpec", () => {
  it("round-trips a persisted spec", () => {
    const { slug } = writeInboxSpec("Button", "# Button\n", { spec: fakeSpec });
    expect(readStoredSpec(["_inbox", slug])).toEqual(fakeSpec);
  });

  it("reports the version a sidecar was written with", () => {
    const { slug } = writeInboxSpec("Button", "# Button\n", { spec: fakeSpec });
    expect(readStoredSpecEnvelope(["_inbox", slug]))
      .toEqual({ spec: fakeSpec, specVersion: SPEC_VERSION });
  });

  it("reads a legacy bare-spec sidecar and reports no version for it", () => {
    // Every sidecar written before the envelope existed looks like this. It
    // still renders, but callers that would re-stamp it can now tell.
    const dir = path.join(contentDir, ".spec-data", "_inbox");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "legacy.json"), JSON.stringify(fakeSpec), "utf-8");
    expect(readStoredSpec(["_inbox", "legacy"])).toEqual(fakeSpec);
    expect(readStoredSpecEnvelope(["_inbox", "legacy"])?.specVersion).toBeNull();
  });

  it("returns null when no sidecar exists", () => {
    expect(readStoredSpec(["_inbox", "missing"])).toBeNull();
  });

  it("returns null for an unreadable/corrupt sidecar instead of throwing", () => {
    const dir = path.join(contentDir, ".spec-data", "_inbox");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not json", "utf-8");
    expect(readStoredSpec(["_inbox", "broken"])).toBeNull();
  });
});

describe("updateStoredSpec", () => {
  it("mutates the spec and preserves the version envelope it already had", () => {
    const { slug } = writeInboxSpec("Button", "# Button\n", { spec: fakeSpec });
    const ok = updateStoredSpec(["_inbox", slug], (spec) => {
      spec.figmaFile = "new-file-key";
    });
    expect(ok).toBe(true);

    const sidecar = path.join(contentDir, ".spec-data", "_inbox", `${slug}.json`);
    const onDisk = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
    expect(onDisk).toEqual({
      spec_version: SPEC_VERSION,
      spec: { ...fakeSpec, figmaFile: "new-file-key" },
    });
    // The whole point: reading it back through the normal helper sees the edit.
    expect(readStoredSpec(["_inbox", slug])).toEqual({
      ...fakeSpec,
      figmaFile: "new-file-key",
    });
  });

  it("keeps a legacy bare sidecar bare instead of stamping it with the current version", () => {
    // Every sidecar written before the envelope existed looks like this. A
    // one-field edit must not upgrade it to a current-looking envelope: that
    // would tell regenerate/route.ts's 409 guard a modern extractor produced
    // it, which is the exact lie the envelope exists to prevent.
    const dir = path.join(contentDir, ".spec-data", "_inbox");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "legacy.json"), JSON.stringify(fakeSpec), "utf-8");

    const ok = updateStoredSpec(["_inbox", "legacy"], (spec) => {
      spec.figmaFile = "new-file-key";
    });
    expect(ok).toBe(true);

    const sidecar = path.join(dir, "legacy.json");
    const onDisk = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
    // Still a bare spec, not { spec_version, spec }.
    expect(onDisk).toEqual({ ...fakeSpec, figmaFile: "new-file-key" });
    expect(readStoredSpecEnvelope(["_inbox", "legacy"])?.specVersion).toBeNull();
  });

  it("returns false and touches nothing when there is no sidecar for this slug", () => {
    const ok = updateStoredSpec(["_inbox", "missing"], (spec) => {
      spec.figmaFile = "new-file-key";
    });
    expect(ok).toBe(false);
  });
});
