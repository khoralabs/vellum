import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PersistableSigner } from "@khoralabs/did-key-identity";
import { VellumPool } from "../../../pool/vellum-pool";
import type { FabricByteChannel } from "../../core/fabric";
import type { VellumAttachmentHandle } from "../../runner/open-vellum-attachment";
import { createSharedUplinkChannelFabric } from "./shared-uplink-channel-fabric";

function stubSigner(did: string): PersistableSigner {
  return {
    did,
    export: () => "dGVzdA==",
    sign: async () => new Uint8Array(64),
  };
}

function fakeUplink() {
  const sent: Uint8Array[] = [];
  const queue: Uint8Array[] = [];
  let wait: ((v: IteratorResult<Uint8Array>) => void) | undefined;
  let closed = false;
  const channel: FabricByteChannel = {
    async *read() {
      while (!closed || queue.length > 0) {
        if (queue.length > 0) {
          const next = queue.shift();
          if (next !== undefined) yield next;
          continue;
        }
        if (closed) break;
        const chunk = await new Promise<IteratorResult<Uint8Array>>((resolve) => {
          wait = resolve;
        });
        if (chunk.done === true) break;
        yield chunk.value;
      }
    },
    write: async (b) => {
      sent.push(b.slice());
    },
    close: async () => {
      closed = true;
      if (wait !== undefined) {
        const w = wait;
        wait = undefined;
        w({ value: undefined as unknown as Uint8Array, done: true });
      }
    },
  };
  return {
    channel,
    sent,
    dispose: () => {
      void channel.close();
    },
  };
}

describe("VellumPool + SharedUplinkChannelFabric", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  test("pool threads fabric into openAttachment; two binds share one uplink open", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vellum-pool-fabric-"));
    let uplinkOpens = 0;
    const uplink = fakeUplink();
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => true },
      openUplink: async () => {
        uplinkOpens++;
        return { channel: uplink.channel, dispose: uplink.dispose };
      },
    });

    const fabricsSeen: unknown[] = [];
    const pool = new VellumPool({
      relayBaseUrl: "http://127.0.0.1:9",
      dataDirRoot: dir,
      fabric,
      openAttachment: (opts) => {
        fabricsSeen.push(opts.fabric);
        // Exercise fabric wiring without full relay/OBP boot.
        let closed = false;
        let frameClose: (() => void) | undefined;
        const ready = (async () => {
          const ticket = await (opts.fabric ?? fabric)
            .ensureAttached({
              channelId: opts.channelId,
              signer: opts.signer,
            })
            .catch(() => ({
              webSocketUrl: "ws://test",
              webSocketNonce: "nonce",
            }));
          const frame = await (opts.fabric ?? fabric).openFrameChannel({
            channelId: opts.channelId,
            signer: opts.signer,
            webSocketUrl: ticket.webSocketUrl ?? "ws://test",
            webSocketNonce: ticket.webSocketNonce ?? "nonce",
          });
          frameClose = frame.close;
        })();
        const handle: VellumAttachmentHandle = {
          did: opts.signer.did,
          channelId: opts.channelId,
          ready,
          get controlTransport() {
            return undefined as unknown as import("../../../transport").VellumControlTransport;
          },
          close: () => {
            if (closed) return;
            closed = true;
            frameClose?.();
          },
        };
        return handle;
      },
    });

    // ensureAttached will call real RelayClient — stub fabric.ensureAttached
    fabric.ensureAttached = async () => ({
      webSocketUrl: "ws://test",
      webSocketNonce: "nonce",
    });

    const alice = stubSigner("did:key:alice");
    const bob = stubSigner("did:key:bob");
    await pool.bind({ signer: alice, channelId: "ch" });
    await pool.bind({ signer: bob, channelId: "ch" });
    expect(fabricsSeen).toHaveLength(2);
    expect(fabricsSeen[0]).toBe(fabric);
    expect(fabricsSeen[1]).toBe(fabric);
    expect(uplinkOpens).toBe(1);
    expect(pool.list()).toHaveLength(2);

    await pool.unbind({ did: alice.did, channelId: "ch" });
    expect(uplinkOpens).toBe(1);
    expect(pool.list()).toHaveLength(1);

    await pool.unbind({ did: bob.did, channelId: "ch" });
    expect(pool.list()).toHaveLength(0);
    await pool.close();
  });
});
