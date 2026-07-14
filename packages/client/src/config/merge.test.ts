import { describe, expect, test } from "bun:test";
import { mergeVellumAppConfigLayers } from "./merge";

describe("mergeVellumAppConfigLayers", () => {
  test("last wins on overlapping keys", () => {
    const merged = mergeVellumAppConfigLayers([
      { relayBaseUrl: "http://a", dataDir: "/x" },
      { relayBaseUrl: "http://b" },
    ]);
    expect(merged.relayBaseUrl).toBe("http://b");
    expect(merged.dataDir).toBe("/x");
  });

  test("skips non-objects", () => {
    expect(mergeVellumAppConfigLayers([null, "x", { a: 1 }])).toEqual({ a: 1 });
  });
});
