import { describe, expect, test } from "bun:test";
import {
  matchVellumControlChainSnapshotPath,
  VELLUM_CONTROL_HTTP_PATH,
  vellumControlChainByIdPath,
} from "./control-http";

describe("vellumControlChainByIdPath", () => {
  test("encodes session id under /chain", () => {
    expect(vellumControlChainByIdPath("abc")).toBe("/chain/abc");
    expect(vellumControlChainByIdPath("a/b")).toBe("/chain/a%2Fb");
  });
});

describe("matchVellumControlChainSnapshotPath", () => {
  test("extracts session ids and rejects reserved action paths", () => {
    expect(matchVellumControlChainSnapshotPath("/chain/s1")).toBe("s1");
    expect(matchVellumControlChainSnapshotPath("/chain/a%2Fb")).toBe("a/b");
    expect(matchVellumControlChainSnapshotPath(VELLUM_CONTROL_HTTP_PATH.chainInit)).toBeUndefined();
    expect(
      matchVellumControlChainSnapshotPath(VELLUM_CONTROL_HTTP_PATH.chainEndOffers),
    ).toBeUndefined();
    expect(
      matchVellumControlChainSnapshotPath(VELLUM_CONTROL_HTTP_PATH.chainClose),
    ).toBeUndefined();
    expect(matchVellumControlChainSnapshotPath("/chain/")).toBeUndefined();
    expect(matchVellumControlChainSnapshotPath("/chain/a/b")).toBeUndefined();
    expect(matchVellumControlChainSnapshotPath("/health")).toBeUndefined();
  });

  test("returns undefined on invalid percent-encoding", () => {
    expect(matchVellumControlChainSnapshotPath("/chain/%E0%A4%A")).toBeUndefined();
  });
});
