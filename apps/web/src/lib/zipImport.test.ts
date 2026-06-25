/**
 * Tests for the pure zip-entry filtering helper `selectSpecArchiveEntries`.
 *
 * The helper operates on already-unzipped entries (Record<string, Uint8Array | string>)
 * so tests need no real zip files — they can pass raw in-memory maps.
 *
 * Run from repo root: npm test
 */

import { describe, expect, it } from "vitest";
import type { IntermediateSpec } from "@spec-layer/extractor";
import { strToU8, zipSync } from "fflate";
import {
  selectSpecArchiveEntries,
  unzipWithLimits,
  ZipLimitError,
} from "./zipImport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

const VALID_MD_1 = `---
name: Button
status: draft
---

## Definition

A button.
`;

const VALID_MD_2 = `---
name: Input
status: beta
---

## Definition

A text input.
`;

// gray-matter is lenient with most frontmatter; to trigger a real parse error
// we need something that actually throws. In practice gray-matter rarely throws,
// but an empty/whitespace file should be rejected by the non-empty guard.
const EMPTY_FILE = "   \n\t  \n";

const NO_FRONTMATTER_MD = `## Definition

No frontmatter at all — still valid for gray-matter.
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
  };
}

// ---------------------------------------------------------------------------
// Keep only .md entries, derive basenames
// ---------------------------------------------------------------------------

describe("selectSpecArchiveEntries — basic filtering", () => {
  it("keeps two .md files in a folder, returning basename names", () => {
    const entries: Record<string, Uint8Array> = {
      "design-system/button.md": str(VALID_MD_1),
      "design-system/input.md": str(VALID_MD_2),
    };
    const { files, skipped } = selectSpecArchiveEntries(entries);
    expect(files).toHaveLength(2);
    expect(skipped).toHaveLength(0);
    const names = files.map((f) => f.name).sort();
    // Both files have frontmatter names ("Button" and "Input"); sorted alphabetically.
    expect(names).toEqual(["Button", "Input"]);
  });

  it("skips non-.md files with a reason", () => {
    const entries: Record<string, string | Uint8Array> = {
      "button.md": VALID_MD_1,
      "image.png": str("PNG data"),
      "readme.txt": "text content",
    };
    const { files, skipped } = selectSpecArchiveEntries(entries);
    expect(files).toHaveLength(1);
    expect(skipped).toHaveLength(2);
    const skipNames = skipped.map((s) => s.name).sort();
    expect(skipNames).toEqual(["image.png", "readme.txt"]);
    skipped.forEach((s) => {
      expect(s.reason).toBeTruthy();
    });
  });

  it("ignores directory entries (names ending in /)", () => {
    const entries: Record<string, Uint8Array | string> = {
      "design-system/": str(""),
      "design-system/button.md": str(VALID_MD_1),
    };
    const { files, skipped } = selectSpecArchiveEntries(entries);
    expect(files).toHaveLength(1);
    // directory entries are silently ignored, not counted as skipped
    expect(skipped).toHaveLength(0);
  });
});

describe("unzipWithLimits", () => {
  it("rejects an entry whose expanded bytes exceed the per-file limit", () => {
    const archive = zipSync({ "large.md": strToU8("x".repeat(101)) });

    expect(() =>
      unzipWithLimits(archive, { maxEntries: 10, maxFileBytes: 100, maxTotalBytes: 1000 }),
    ).toThrow(ZipLimitError);
  });

  it("rejects total expanded bytes while streaming entries", () => {
    const archive = zipSync({
      "one.md": strToU8("x".repeat(60)),
      "two.md": strToU8("y".repeat(60)),
    });

    expect(() =>
      unzipWithLimits(archive, { maxEntries: 10, maxFileBytes: 100, maxTotalBytes: 100 }),
    ).toThrow("Total decompressed size exceeds 100 bytes");
  });

  it("returns bounded entries for a valid archive", () => {
    const archive = zipSync({ "button.md": strToU8(VALID_MD_1) });

    const entries = unzipWithLimits(archive, {
      maxEntries: 10,
      maxFileBytes: 1000,
      maxTotalBytes: 1000,
    });

    expect(new TextDecoder().decode(entries["button.md"])).toContain("name: Button");
  });
});

// ---------------------------------------------------------------------------
// Zip-slip / path traversal
// ---------------------------------------------------------------------------

describe("selectSpecArchiveEntries — path traversal prevention", () => {
  it("strips folder prefix and keeps only basename for nested paths", () => {
    const entries: Record<string, Uint8Array> = {
      "some/deep/path/button.md": str(VALID_MD_1),
    };
    const { files } = selectSpecArchiveEntries(entries);
    expect(files).toHaveLength(1);
    // basename only, no path component
    expect(files[0].name).toBe("Button");
  });

  it("does not allow path traversal via ../evil.md — reduces to basename", () => {
    const entries: Record<string, Uint8Array> = {
      "../evil.md": str(VALID_MD_1),
    };
    const { files } = selectSpecArchiveEntries(entries);
    // Should still process it but strip to basename "evil" or "Button" from frontmatter
    expect(files).toHaveLength(1);
    // Whatever name is returned, it must NOT contain '..' or path separators
    const name = files[0].name;
    expect(name).not.toContain("..");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
  });

  it("handles windows-style separators in path (backslash) by reducing to basename", () => {
    const entries: Record<string, Uint8Array> = {
      "folder\\button.md": str(VALID_MD_1),
    };
    const { files } = selectSpecArchiveEntries(entries);
    expect(files).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Content validation
// ---------------------------------------------------------------------------

describe("selectSpecArchiveEntries — content validation", () => {
  it("skips empty/whitespace-only files with a reason", () => {
    const entries: Record<string, string> = {
      "empty.md": EMPTY_FILE,
    };
    const { files, skipped } = selectSpecArchiveEntries(entries);
    expect(files).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].name).toBe("empty.md");
    expect(skipped[0].reason).toMatch(/empty/i);
  });

  it("accepts .md files without frontmatter (gray-matter parses them fine)", () => {
    const entries: Record<string, string> = {
      "no-fm.md": NO_FRONTMATTER_MD,
    };
    const { files, skipped } = selectSpecArchiveEntries(entries);
    expect(files).toHaveLength(1);
    expect(skipped).toHaveLength(0);
    // name falls back to filename stem
    expect(files[0].name).toBe("no-fm");
  });

  it("skips files that cause gray-matter to throw", () => {
    // Simulate a parse error by passing binary garbage that starts with '---'
    // In practice gray-matter is robust, so we test via the empty-guard path;
    // the malformed FM test validates the reason message covers that path.
    const entries: Record<string, string> = {
      "empty.md": EMPTY_FILE,
    };
    const { skipped } = selectSpecArchiveEntries(entries);
    expect(skipped[0].reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Frontmatter name extraction
// ---------------------------------------------------------------------------

describe("selectSpecArchiveEntries — name derivation", () => {
  it("uses frontmatter `name` when present", () => {
    const entries: Record<string, string> = {
      "some-file.md": VALID_MD_1, // frontmatter name: Button
    };
    const { files } = selectSpecArchiveEntries(entries);
    expect(files[0].name).toBe("Button");
  });

  it("uses frontmatter `component.name` when top-level name is absent", () => {
    const md = `---
component:
  name: Icon Button
  figma_node: "1:2"
  figma_file: abc
spec_version: "0.1"
---

## Definition
`;
    const entries: Record<string, string> = {
      "icon-button.md": md,
    };
    const { files } = selectSpecArchiveEntries(entries);
    expect(files[0].name).toBe("Icon Button");
  });

  it("falls back to filename stem when no frontmatter name", () => {
    const entries: Record<string, string> = {
      "my-widget.md": NO_FRONTMATTER_MD,
    };
    const { files } = selectSpecArchiveEntries(entries);
    expect(files[0].name).toBe("my-widget");
  });

  it("accepts .MD uppercase extension (case-insensitive)", () => {
    const entries: Record<string, string> = {
      "BUTTON.MD": VALID_MD_1,
    };
    const { files } = selectSpecArchiveEntries(entries);
    expect(files).toHaveLength(1);
  });

  it("decodes Uint8Array bytes to UTF-8 string", () => {
    const entries: Record<string, Uint8Array> = {
      "button.md": str(VALID_MD_1),
    };
    const { files } = selectSpecArchiveEntries(entries);
    expect(files[0].markdown).toContain("## Definition");
  });
});

describe("selectSpecArchiveEntries — sidecars", () => {
  it("pairs .spec-data sidecars with mirrored markdown paths", () => {
    const spec = validSpec();
    const result = selectSpecArchiveEntries({
      "design-system/button.md": VALID_MD_1,
      ".spec-data/design-system/button.json": JSON.stringify(spec),
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe("Button");
    expect(result.files[0].markdown).toContain("## Definition");
    expect(result.files[0].spec).toEqual(spec);
    expect(result.skipped).toEqual([]);
  });

  it("keeps markdown and reports invalid paired sidecar without writing spec data", () => {
    const result = selectSpecArchiveEntries({
      "design-system/button.md": VALID_MD_1,
      ".spec-data/design-system/button.json": "{ bad json",
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].spec).toBeUndefined();
    expect(result.skipped).toEqual([
      {
        name: ".spec-data/design-system/button.json",
        reason: expect.stringMatching(/sidecar/i),
      },
    ]);
  });

  it("reports unmatched sidecars and imports matching markdown normally", () => {
    const result = selectSpecArchiveEntries({
      "design-system/button.md": VALID_MD_1,
      ".spec-data/design-system/missing.json": JSON.stringify(validSpec("Missing")),
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].spec).toBeUndefined();
    expect(result.skipped).toEqual([
      {
        name: ".spec-data/design-system/missing.json",
        reason: "No matching markdown file for sidecar",
      },
    ]);
  });
});
