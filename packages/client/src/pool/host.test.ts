import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PersistableSigner } from "@khoralabs/did-key-identity";
import type { VellumAttachmentHandle } from "../session";
import type { VellumControlTransport } from "../transport";
import {
  createSharedUplinkVellumPool,
  vellumPoolAttachmentDataDir,
  wrapVellumPoolClient,
} from "./host.ts";
import { VellumPool } from "./vellum-pool";

function stubSigner(did: string): PersistableSigner {
  return {
    did,
    export: () => "dGVzdA==",
    sign: async () => new Uint8Array(64),
  };
}

function stubTransport(): VellumControlTransport {
  return {
    fetch(p) {
      return Promise.resolve(Response.json({ ok: true, path: p.startsWith("/") ? p : `/${p}` }));
    },
  };
}

function stubAttachment(
  opts: { signer: PersistableSigner; channelId: string },
  hooks?: { onClose?: () => void },
): VellumAttachmentHandle {
  let closed = false;
  return {
    did: opts.signer.did,
    channelId: opts.channelId,
    ready: Promise.resolve(),
    get controlTransport() {
      if (closed) throw new Error("closed");
      return stubTransport();
    },
    close() {
      if (closed) return;
      closed = true;
      hooks?.onClose?.();
    },
  };
}

describe("vellumPoolAttachmentDataDir", () => {
  test("encodes did and channel id path segments", () => {
    expect(vellumPoolAttachmentDataDir("/data", "did:key:abc", "channel-1")).toBe(
      path.join("/data", encodeURIComponent("did:key:abc"), encodeURIComponent("channel-1")),
    );
  });

  test("resolves relative dataDirRoot like VellumPool", () => {
    const relative = "./relative-vellum-data";
    const expected = path.join(
      path.resolve(relative),
      encodeURIComponent("did:key:abc"),
      encodeURIComponent("ch"),
    );
    expect(vellumPoolAttachmentDataDir(relative, "did:key:abc", "ch")).toBe(expected);
  });
});

describe("createSharedUplinkVellumPool", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  test("constructs a pool with shared uplink fabric", () => {
    dir = mkdtempSync(path.join(tmpdir(), "vellum-host-pool-"));
    const pool = createSharedUplinkVellumPool({
      relayBaseUrl: "http://127.0.0.1:9",
      dataDirRoot: dir,
      isOnHost: () => true,
    });
    expect(pool.list()).toEqual([]);
    pool.close();
  });
});

describe("wrapVellumPoolClient", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  test("delegates ops to the bound pool handle and disconnect unbinds", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vellum-host-wrap-"));
    let closed = 0;
    const signer = stubSigner("did:key:alice");
    const channelId = "ch-1";
    const pool = new VellumPool({
      relayBaseUrl: "http://127.0.0.1:9",
      dataDirRoot: dir,
      openAttachment: (opts) =>
        stubAttachment(opts, {
          onClose: () => {
            closed += 1;
          },
        }),
    });

    await pool.bind({ signer, channelId });
    const handle = wrapVellumPoolClient(pool, signer.did, channelId);
    expect(await handle.connect()).toBe("already-running");
    expect(pool.list()).toEqual([{ did: signer.did, channelId }]);

    handle.disconnect();
    await Promise.resolve();
    expect(pool.list()).toEqual([]);
    expect(closed).toBe(1);
    expect(() => pool.handle({ did: signer.did, channelId })).toThrow(/not bound/);

    pool.close();
  });
});
