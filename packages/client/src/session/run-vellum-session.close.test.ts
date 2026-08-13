import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { generateIdentity } from "@khoralabs/did-key-identity";
import { runVellumSession } from "./run-vellum-session";

describe("runVellumSession close during startup", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  test("ready rejects when close is called before startup completes", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vellum-session-"));
    const signer = await generateIdentity();
    const handle = runVellumSession({
      relayBaseUrl: "http://127.0.0.1:9",
      signer,
      channelId: "test-channel",
      webSocketUrl: "ws://127.0.0.1:9",
      cfg: { dataDir: dir },
    });
    handle.close();
    await expect(handle.ready).rejects.toMatchObject({ name: "AbortError" });
  });
});
