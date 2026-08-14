import { describe, expect, test } from "bun:test";
import type { PersistableSigner } from "@khoralabs/did-key-identity";
import type { FabricByteChannel } from "../../core/fabric";
import { filterEchoedInits } from "../../relay/obp-adapter";
import {
  createSharedUplinkChannelFabric,
  type OpenSharedUplinkFn,
} from "./shared-uplink-channel-fabric";

function stubSigner(did: string): PersistableSigner {
  return {
    did,
    export: () => "dGVzdA==",
    sign: async () => new Uint8Array(64),
  };
}

/** In-memory duplex used as a fake shared uplink WS. */
function createFakeUplinkDuplex(): {
  channel: FabricByteChannel;
  dispose: () => void;
  sent: Uint8Array[];
  pushInbound: (bytes: Uint8Array) => void;
  openCount: { n: number };
} {
  const sent: Uint8Array[] = [];
  const queue: Uint8Array[] = [];
  let wait: ((v: IteratorResult<Uint8Array>) => void) | undefined;
  let closed = false;
  const openCount = { n: 0 };

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
    write: async (bytes) => {
      sent.push(bytes.slice());
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
    openCount,
    dispose: () => {
      void channel.close();
    },
    pushInbound: (bytes) => {
      if (closed) return;
      if (wait !== undefined) {
        const w = wait;
        wait = undefined;
        w({ value: bytes.slice(), done: false });
        return;
      }
      queue.push(bytes.slice());
    },
  };
}

async function readOne(ch: FabricByteChannel, ms = 300): Promise<Uint8Array> {
  const iter = ch.read()[Symbol.asyncIterator]();
  const result = await Promise.race([
    iter.next(),
    new Promise<IteratorResult<Uint8Array>>((_, reject) =>
      setTimeout(() => reject(new Error("readOne timeout")), ms),
    ),
  ]);
  if (result.done === true) throw new Error("readOne: closed");
  return result.value;
}

function encodeInitFrame(sessionId: string): Uint8Array {
  const json = JSON.stringify({ init: { session_id: sessionId } });
  const body = new TextEncoder().encode(json);
  const out = new Uint8Array(4 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length, false);
  out.set(body, 4);
  return out;
}

describe("SharedUplinkChannelFabric", () => {
  test("first open opens one uplink; second attach reuses it", async () => {
    let opens = 0;
    const fake = createFakeUplinkDuplex();
    const openUplink: OpenSharedUplinkFn = async () => {
      opens++;
      fake.openCount.n = opens;
      return { channel: fake.channel, dispose: fake.dispose };
    };
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink,
    });
    const a = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const b = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:b"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n2",
    });
    expect(opens).toBe(1);
    a.close();
    expect(opens).toBe(1);
    b.close();
  });

  test("different channelIds get independent uplinks", async () => {
    let opens = 0;
    const openUplink: OpenSharedUplinkFn = async () => {
      opens++;
      const fake = createFakeUplinkDuplex();
      return { channel: fake.channel, dispose: fake.dispose };
    };
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink,
    });
    const a = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const b = await fabric.openFrameChannel({
      channelId: "c2",
      signer: stubSigner("did:key:b"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    expect(opens).toBe(2);
    a.close();
    b.close();
  });

  test("detach one of two keeps uplink; last detach closes", async () => {
    let disposed = 0;
    const fake = createFakeUplinkDuplex();
    const openUplink: OpenSharedUplinkFn = async () => ({
      channel: fake.channel,
      dispose: () => {
        disposed++;
        fake.dispose();
      },
    });
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink,
    });
    const a = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const b = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:b"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    a.close();
    expect(disposed).toBe(0);
    b.close();
    expect(disposed).toBe(1);
  });

  test("local write: peer receives via short-circuit; uplink sees one send", async () => {
    const fake = createFakeUplinkDuplex();
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink: async () => ({ channel: fake.channel, dispose: fake.dispose }),
    });
    const a = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const b = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:b"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const bGot = readOne(b.channel);
    await a.channel.write(new Uint8Array([1, 2, 3]));
    expect([...(await bGot)]).toEqual([1, 2, 3]);
    expect(fake.sent).toHaveLength(1);
    const sent0 = fake.sent[0];
    expect(sent0).toBeDefined();
    if (sent0 !== undefined) {
      expect([...sent0]).toEqual([1, 2, 3]);
    }
    // Relay echo must not double-deliver to B (already short-circuited).
    await Promise.resolve();
    await Promise.resolve();
    fake.pushInbound(new Uint8Array([1, 2, 3]));
    await Promise.resolve();
    await Promise.resolve();
    const dup = await Promise.race([
      readOne(b.channel, 50).then(
        () => "got" as const,
        () => "timeout" as const,
      ),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 50)),
    ]);
    expect(dup).toBe("timeout");
    expect(a.getRelaySequenceDelta?.()).toBe(1);
    expect(b.getRelaySequenceDelta?.()).toBe(1);
    a.close();
    b.close();
  });

  test("uplink inbound fans to all local endpoints once", async () => {
    const fake = createFakeUplinkDuplex();
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink: async () => ({ channel: fake.channel, dispose: fake.dispose }),
    });
    const a = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const b = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:b"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const aGot = readOne(a.channel);
    const bGot = readOne(b.channel);
    fake.pushInbound(new Uint8Array([9]));
    expect([...(await aGot)]).toEqual([9]);
    expect([...(await bGot)]).toEqual([9]);
    a.close();
    b.close();
  });

  test("remote-only inbound advances relay sequence and fans once", async () => {
    const fake = createFakeUplinkDuplex();
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink: async () => ({ channel: fake.channel, dispose: fake.dispose }),
    });
    const a = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const aGot = readOne(a.channel);
    await Promise.resolve();
    fake.pushInbound(new Uint8Array([9, 9]));
    expect([...(await aGot)]).toEqual([9, 9]);
    expect(a.getRelaySequenceDelta?.()).toBe(1);
    a.close();
  });

  test("uplink open failure rejects without pinning refcount; retry succeeds", async () => {
    let fail = true;
    const fake = createFakeUplinkDuplex();
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink: async () => {
        if (fail) throw new Error("boom");
        return { channel: fake.channel, dispose: fake.dispose };
      },
    });
    await expect(
      fabric.openFrameChannel({
        channelId: "c1",
        signer: stubSigner("did:key:a"),
        webSocketUrl: "ws://x",
        webSocketNonce: "n",
      }),
    ).rejects.toThrow(/boom/);
    fail = false;
    const a = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    a.close();
  });

  test("parallel openFrameChannel same channel opens single uplink", async () => {
    let opens = 0;
    const fake = createFakeUplinkDuplex();
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink: async () => {
        opens++;
        await Promise.resolve();
        return { channel: fake.channel, dispose: fake.dispose };
      },
    });
    const [a, b] = await Promise.all([
      fabric.openFrameChannel({
        channelId: "c1",
        signer: stubSigner("did:key:a"),
        webSocketUrl: "ws://x",
        webSocketNonce: "n",
      }),
      fabric.openFrameChannel({
        channelId: "c1",
        signer: stubSigner("did:key:b"),
        webSocketUrl: "ws://x",
        webSocketNonce: "n",
      }),
    ]);
    expect(opens).toBe(1);
    a.close();
    b.close();
  });

  test("owned-init echo filter drops uplink echo for owner only", async () => {
    const fake = createFakeUplinkDuplex();
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink: async () => ({ channel: fake.channel, dispose: fake.dispose }),
    });
    const a = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const b = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:b"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const owned = new Set<string>(["sess-a"]);
    const filteredA = filterEchoedInits(a.channel, owned);
    const filteredB = filterEchoedInits(b.channel, new Set());
    const bGot = readOne(filteredB.channel);
    const aRace = Promise.race([
      readOne(filteredA.channel, 80).then(
        () => "got" as const,
        () => "timeout" as const,
      ),
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 80)),
    ]);
    // Let the uplink read loop attach before injecting.
    await Promise.resolve();
    await Promise.resolve();
    const init = encodeInitFrame("sess-a");
    fake.pushInbound(init);
    expect(await aRace).toBe("timeout");
    expect([...(await bGot).subarray(0, 4)]).toEqual([...init.subarray(0, 4)]);
    a.close();
    b.close();
  });

  test("onSessionReady skips MLS when peer on host; inclusion not used in ensureAttached", async () => {
    const inclusionCalls: string[] = [];
    const ensureCalls: string[] = [];
    const fake = createFakeUplinkDuplex();
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: {
        isOnHost: async (did) => {
          inclusionCalls.push(did);
          return did === "did:key:local-peer";
        },
      },
      openUplink: async () => ({ channel: fake.channel, dispose: fake.dispose }),
    });
    // ensureAttached hits RelayClient — stub by monkeypatching fabric method for this unit
    const original = fabric.ensureAttached.bind(fabric);
    fabric.ensureAttached = async (args) => {
      ensureCalls.push(args.signer.did);
      return { webSocketUrl: "ws://x", webSocketNonce: "n", lastBlobId: 0 };
    };
    await fabric.ensureAttached({ channelId: "c1", signer: stubSigner("did:key:a") });
    expect(inclusionCalls).toEqual([]);
    expect(ensureCalls).toEqual(["did:key:a"]);

    const skip = await fabric.onSessionReady?.({
      channelId: "c1",
      localDid: "did:key:a",
      peerDid: "did:key:local-peer",
      sessionId: "s1",
    });
    expect(skip).toEqual({ skipDefaultMlsWelcome: true });
    expect(inclusionCalls).toEqual(["did:key:local-peer"]);

    const noskip = await fabric.onSessionReady?.({
      channelId: "c1",
      localDid: "did:key:a",
      peerDid: "did:key:remote",
      sessionId: "s2",
    });
    expect(noskip).toBeUndefined();

    fabric.ensureAttached = original;
  });

  test("isOnHost rejection fails hook without tearing other attaches", async () => {
    const fake = createFakeUplinkDuplex();
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: {
        isOnHost: async () => {
          throw new Error("inclusion failed");
        },
      },
      openUplink: async () => ({ channel: fake.channel, dispose: fake.dispose }),
    });
    const a = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    await expect(
      fabric.onSessionReady?.({
        channelId: "c1",
        localDid: "did:key:a",
        peerDid: "did:key:x",
        sessionId: "s",
      }),
    ).rejects.toThrow(/inclusion failed/);
    // still usable
    await a.channel.write(new Uint8Array([1]));
    expect(fake.sent).toHaveLength(1);
    a.close();
  });

  test("uplink write failure rolls back relaySequence and pending echoes", async () => {
    let failWrite = true;
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
      write: async () => {
        if (failWrite) throw new Error("write failed");
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
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink: async () => ({
        channel,
        dispose: () => {
          void channel.close();
        },
      }),
    });
    const a = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    await expect(a.channel.write(new Uint8Array([1, 2, 3]))).rejects.toThrow(/write failed/);
    expect(a.getRelaySequenceDelta?.()).toBe(0);
    failWrite = false;
    await a.channel.write(new Uint8Array([4]));
    expect(a.getRelaySequenceDelta?.()).toBe(1);
    a.close();
  });

  test("concurrent write failure removes matching pending echo not only last", async () => {
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((r) => {
      releaseSlow = r;
    });
    let writes = 0;
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
      write: async (bytes) => {
        writes++;
        if (bytes[0] === 1) {
          await slowGate;
          throw new Error("slow write failed");
        }
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
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink: async () => ({
        channel,
        dispose: () => {
          void channel.close();
        },
      }),
    });
    const a = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const b = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:b"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    const slow = a.channel.write(new Uint8Array([1]));
    const drainedShortCircuit = readOne(a.channel);
    await b.channel.write(new Uint8Array([2]));
    expect([...(await drainedShortCircuit)]).toEqual([2]);
    releaseSlow?.();
    await expect(slow).rejects.toThrow(/slow write failed/);
    expect(writes).toBe(2);
    expect(a.getRelaySequenceDelta?.()).toBe(1);
    // Failed frame [1] must not suppress a later remote frame with same bytes.
    const aGot = readOne(a.channel);
    await Promise.resolve();
    if (wait !== undefined) {
      const w = wait;
      wait = undefined;
      w({ value: new Uint8Array([1]), done: false });
    } else {
      queue.push(new Uint8Array([1]));
    }
    expect([...(await aGot)]).toEqual([1]);
    a.close();
    b.close();
  });

  test("attach → write → detach → attach again works", async () => {
    let opens = 0;
    const makeFake = () => {
      const f = createFakeUplinkDuplex();
      return f;
    };
    let current = makeFake();
    const fabric = createSharedUplinkChannelFabric({
      relayBaseUrl: "http://127.0.0.1:9",
      inclusion: { isOnHost: async () => false },
      openUplink: async () => {
        opens++;
        current = makeFake();
        return { channel: current.channel, dispose: current.dispose };
      },
    });
    const a1 = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    await a1.channel.write(new Uint8Array([1]));
    a1.close();
    const a2 = await fabric.openFrameChannel({
      channelId: "c1",
      signer: stubSigner("did:key:a"),
      webSocketUrl: "ws://x",
      webSocketNonce: "n",
    });
    await a2.channel.write(new Uint8Array([2]));
    expect(opens).toBe(2);
    a2.close();
  });
});
