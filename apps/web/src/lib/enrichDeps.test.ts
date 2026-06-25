import { describe, expect, it, vi } from "vitest";
import type { IntermediateSpec } from "@spec-layer/extractor";
import { createBatchImageResolver } from "./enrichDeps";

function spec(figmaFile: string, figmaNode: string): IntermediateSpec {
  return {
    name: `${figmaFile}-${figmaNode}`,
    figmaKey: "key",
    figmaFile,
    figmaNode,
    anatomy: [], anatomyComponentId: "",
    props: [],
    variants: [],
    states: [],
    tokens: [],
    layout: [],
    variantInstances: [],
    related: [],
    gaps: [],
  };
}

describe("createBatchImageResolver", () => {
  it("groups and deduplicates node requests by Figma file", async () => {
    const fetchImages = vi.fn(async (fileKey: string, nodeIds: string[]) => ({
      status: "ok" as const,
      images: Object.fromEntries(nodeIds.map((nodeId) => [nodeId, `${fileKey}/${nodeId}`])),
    }));
    const first = spec("FILE-A", "1:1");
    const duplicate = spec("FILE-A", "1:1");
    const second = spec("FILE-A", "1:2");
    const third = spec("FILE-B", "2:1");
    const unknown = spec("unknown", "3:1");

    const resolve = await createBatchImageResolver(
      [first, duplicate, second, third, unknown],
      fetchImages,
    );

    expect(fetchImages).toHaveBeenCalledTimes(2);
    expect(fetchImages).toHaveBeenCalledWith("FILE-A", ["1:1", "1:2"]);
    expect(fetchImages).toHaveBeenCalledWith("FILE-B", ["2:1"]);
    await expect(resolve(first)).resolves.toBe("FILE-A/1:1");
    await expect(resolve(third)).resolves.toBe("FILE-B/2:1");
    await expect(resolve(unknown)).resolves.toBeNull();
  });
});
