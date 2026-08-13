import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PersistableSigner } from "@khoralabs/did-key-identity";
import type { VellumAttachmentHandle } from "../session";
import type { VellumControlTransport } from "../transport";
import { VellumPool, type VellumPoolEvent } from "./vellum-pool";

function stubSigner(did: string): PersistableSigner {
  return {
    did,
    export: () => "dGVzdA==",
    sign: async () => new Uint8Array(64),
  };
}

function stubTransport(tag: string): VellumControlTransport {
  return {
    fetch(p) {
      return Promise.resolve(
        Response.json({ ok: true, tag, path: p.startsWith("/") ? p : `/${p}` }),
      );
    },
  };
}

function stubAttachment(
  opts: { signer: PersistableSigner; channelId: string },
  transport: VellumControlTransport,
  hooks?: { onClose?: () => void; ready?: Promise<void> },
): VellumAttachmentHandle {
  let closed = false;
  return {
    did: opts.signer.did,
    channelId: opts.channelId,
    ready: hooks?.ready ?? Promise.resolve(),
    get controlTransport() {
      if (closed) throw new Error("closed");
      return transport;
    },
    close() {
      if (closed) return;
      closed = true;
      hooks?.onClose?.();
    },
  };
}

describe("VellumPool", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  test("rejects empty dataDirRoot", () => {
    expect(
      () =>
        new VellumPool({
          relayBaseUrl: "http://127.0.0.1:9",
          dataDirRoot: "   ",
        }),
    ).toThrow(/dataDirRoot is required/);
  });

  test("bind/unbind/list/subscribe demux by did+channelId", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vellum-pool-"));
    const events: VellumPoolEvent[] = [];
    const alice = stubSigner("did:key:alice");
    const bob = stubSigner("did:key:bob");
    const channelId = "ch-1";

    const pool = new VellumPool({
      relayBaseUrl: "http://127.0.0.1:9",
      dataDirRoot: dir,
      openAttachment: (opts) =>
        stubAttachment(opts, stubTransport(`${opts.signer.did}:${opts.channelId}`)),
    });
    pool.subscribe((e) => events.push(e));

    await pool.bind({ signer: alice, channelId });
    await pool.bind({ signer: bob, channelId });
    // idempotent
    await pool.bind({ signer: alice, channelId });

    expect(pool.list()).toEqual([
      { did: "did:key:alice", channelId },
      { did: "did:key:bob", channelId },
    ]);
    expect(events.filter((e) => e.kind === "ready")).toEqual([
      { kind: "ready", did: "did:key:alice", channelId },
      { kind: "ready", did: "did:key:bob", channelId },
    ]);

    const aliceHandle = pool.handle({ did: alice.did, channelId });
    const bobHandle = pool.handle({ did: bob.did, channelId });
    expect(aliceHandle).not.toBe(bobHandle);

    await pool.unbind({ did: alice.did, channelId });
    expect(pool.list()).toEqual([{ did: "did:key:bob", channelId }]);
    expect(events.some((e) => e.kind === "closed" && e.did === alice.did)).toBe(true);
    expect(() => pool.handle({ did: alice.did, channelId })).toThrow(/not bound/);

    pool.close();
    expect(pool.list()).toEqual([]);
    await expect(pool.bind({ signer: alice, channelId })).rejects.toThrow(/closed/);
  });

  test("concurrent bind for same key opens one attachment", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vellum-pool-"));
    const alice = stubSigner("did:key:alice");
    let opens = 0;
    let resolveReady!: () => void;
    const readyGate = new Promise<void>((r) => {
      resolveReady = r;
    });

    const pool = new VellumPool({
      relayBaseUrl: "http://127.0.0.1:9",
      dataDirRoot: dir,
      openAttachment: (opts) => {
        opens += 1;
        return stubAttachment(opts, stubTransport("t"), { ready: readyGate });
      },
    });

    const a = pool.bind({ signer: alice, channelId: "c" });
    const b = pool.bind({ signer: alice, channelId: "c" });
    expect(opens).toBe(1);
    resolveReady();
    await Promise.all([a, b]);
    expect(opens).toBe(1);
    expect(pool.list()).toEqual([{ did: alice.did, channelId: "c" }]);
    pool.close();
  });

  test("close during bind discards session and does not keep attachment", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vellum-pool-"));
    const alice = stubSigner("did:key:alice");
    let closedCount = 0;
    let resolveReady!: () => void;
    const readyGate = new Promise<void>((r) => {
      resolveReady = r;
    });

    const pool = new VellumPool({
      relayBaseUrl: "http://127.0.0.1:9",
      dataDirRoot: dir,
      openAttachment: (opts) =>
        stubAttachment(opts, stubTransport("t"), {
          ready: readyGate,
          onClose: () => {
            closedCount += 1;
          },
        }),
    });

    const bindP = pool.bind({ signer: alice, channelId: "c" });
    pool.close();
    resolveReady();
    await expect(bindP).rejects.toThrow(/closed/);
    expect(pool.list()).toEqual([]);
    expect(closedCount).toBeGreaterThanOrEqual(1);
  });

  test("unbind during bind discards session without leaking attachment", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vellum-pool-"));
    const alice = stubSigner("did:key:alice");
    let closedCount = 0;
    let resolveReady!: () => void;
    const readyGate = new Promise<void>((r) => {
      resolveReady = r;
    });

    const pool = new VellumPool({
      relayBaseUrl: "http://127.0.0.1:9",
      dataDirRoot: dir,
      openAttachment: (opts) =>
        stubAttachment(opts, stubTransport("t"), {
          ready: readyGate,
          onClose: () => {
            closedCount += 1;
          },
        }),
    });

    const bindP = pool.bind({ signer: alice, channelId: "c" });
    await pool.unbind({ did: alice.did, channelId: "c" });
    resolveReady();
    await bindP;
    expect(pool.list()).toEqual([]);
    expect(closedCount).toBeGreaterThanOrEqual(1);
    pool.close();
  });

  test("handle routes ops to the bound attachment transport", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vellum-pool-"));
    const seen: string[] = [];
    const alice = stubSigner("did:key:alice");
    const bob = stubSigner("did:key:bob");

    const pool = new VellumPool({
      relayBaseUrl: "http://relay.test",
      dataDirRoot: dir,
      openAttachment: (opts) =>
        stubAttachment(opts, {
          fetch(p) {
            seen.push(`${opts.signer.did}:${p}`);
            if (p.includes("/turn")) {
              return Promise.resolve(Response.json({ ok: true }));
            }
            return Promise.resolve(
              Response.json({
                chains: [],
                graphSummary: { parties: 0, offers: 0, exposes: 0, binds: 0 },
              }),
            );
          },
        }),
    });

    await pool.bind({ signer: alice, channelId: "c" });
    await pool.bind({ signer: bob, channelId: "c" });

    await pool.handle({ did: alice.did, channelId: "c" }).sendTurn("s", { x: 1 });
    await pool.handle({ did: bob.did, channelId: "c" }).getChainSnapshot();

    expect(seen).toContain("did:key:alice:/turn");
    expect(seen).toContain("did:key:bob:/chain");
    pool.close();
  });
});
