import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createInMemoryObpPersistenceClient } from "@khoralabs/obp-core/persistence";
import type {
  FrameMultiplexOpenerApi,
  FrameSessionHandle,
  SessionInitNormalized,
} from "@khoralabs/obp-wire";
import { ChainInitWireSchema } from "../../contracts";
import { createVellumPersistence } from "../../persistence/sqlite/vellum-persistence";
import { testControlSigner } from "../testing/test-signer";
import { startVellumControlServer } from "./server";

const testSigner = testControlSigner("did:key:alice");

const SAMPLE_OPENING_TURN = {
  offer: { id: "", type: "opening", expires_turn: 0, expires_at_ms: 0 },
  ports: [
    {
      id: "",
      kind: "slot",
      promise: "open",
      expires_turn: 0,
      expires_at_ms: 0,
      bind_policy: null,
      ref: "",
    },
  ],
  bind_port_id: "",
  bind_payload: null,
};

function mkOpts(db: Database) {
  const meta = createVellumPersistence(db);
  meta.ensureSchema();
  return {
    meta,
    signer: testSigner,
    myActorPubkeyHex: "ee".repeat(32),
    persistence: createInMemoryObpPersistenceClient(),
  };
}

function mkConn(opts: { turns: unknown[]; ended?: string[] }): FrameMultiplexOpenerApi {
  return {
    async init(norm: SessionInitNormalized): Promise<FrameSessionHandle> {
      const sid = norm.session_id;
      const stub = {
        sessionId: sid,
        init: norm,
        remoteActor: "",
        get tipHash(): string {
          return norm.genesis_hash;
        },
        sendTurn: async (b: unknown): Promise<void> => {
          opts.turns.push(b);
        },
        endOffers: async (): Promise<void> => {
          opts.ended?.push(sid);
        },
        terminate: async (): Promise<void> => {},
      };
      return stub as FrameSessionHandle;
    },
    close(): void {},
  };
}

describe("POST /chain/init genesis_turn", () => {
  test("init without genesis_turn does not sendTurn", async () => {
    const db = new Database(":memory:");
    const turns: unknown[] = [];
    const state = { conn: mkConn({ turns }), handles: new Map() };
    const server = startVellumControlServer({ state, db, ...mkOpts(db) });
    try {
      const sampleInit = ChainInitWireSchema.parse({
        session_id: "s1",
        genesis_hash: "33".repeat(32),
        party_dids: ["did:key:alice", "did:key:bob"],
        peer_identity_key: "ff".repeat(32),
      });
      const res = await fetch(`http://${server.hostname}:${server.port}/chain/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ init: sampleInit }),
      });
      expect(res.ok).toBe(true);
      expect(turns.length).toBe(0);
    } finally {
      server.stop();
      db.close();
    }
  });

  test("trusts peer_identity_key when roster cache misses", async () => {
    const db = new Database(":memory:");
    const turns: unknown[] = [];
    const opts = mkOpts(db);
    const state = { conn: mkConn({ turns }), handles: new Map() };
    const server = startVellumControlServer({ state, db, ...opts });
    try {
      const sampleInit = ChainInitWireSchema.parse({
        session_id: "s-roster",
        genesis_hash: "11".repeat(32),
        party_dids: ["did:key:alice", "did:key:bob"],
        peer_identity_key: "ff".repeat(32),
      });
      const res = await fetch(`http://${server.hostname}:${server.port}/chain/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ init: sampleInit }),
      });
      expect(res.ok).toBe(true);
      expect(opts.meta.getRosterActor("did:key:bob")).toBe("ff".repeat(32));
    } finally {
      server.stop();
      db.close();
    }
  });

  test("400 when genesis ports empty", async () => {
    const db = new Database(":memory:");
    const turns: unknown[] = [];
    const state = { conn: mkConn({ turns }), handles: new Map() };
    const server = startVellumControlServer({ state, db, ...mkOpts(db) });
    try {
      const sampleInit = ChainInitWireSchema.parse({
        session_id: "s2",
        genesis_hash: "66".repeat(32),
        party_dids: ["did:key:alice", "did:key:bob"],
        peer_identity_key: "ff".repeat(32),
      });
      const res = await fetch(`http://${server.hostname}:${server.port}/chain/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          init: sampleInit,
          genesis_turn: {
            ...SAMPLE_OPENING_TURN,
            ports: [],
          },
        }),
      });
      expect(res.status).toBe(400);
      const j = (await res.json()) as { error?: string };
      expect(j.error).toContain("at least one exposed port");
      expect(turns.length).toBe(0);
    } finally {
      server.stop();
      db.close();
    }
  });

  test("400 when genesis bind_port_id set", async () => {
    const db = new Database(":memory:");
    const turns: unknown[] = [];
    const state = { conn: mkConn({ turns }), handles: new Map() };
    const server = startVellumControlServer({ state, db, ...mkOpts(db) });
    try {
      const sampleInit = ChainInitWireSchema.parse({
        session_id: "s3",
        genesis_hash: "aa".repeat(32),
        party_dids: ["did:key:alice", "did:key:bob"],
        peer_identity_key: "ff".repeat(32),
      });
      const res = await fetch(`http://${server.hostname}:${server.port}/chain/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          init: sampleInit,
          genesis_turn: {
            ...SAMPLE_OPENING_TURN,
            bind_port_id: "port-x",
          },
        }),
      });
      expect(res.status).toBe(400);
      expect(turns.length).toBe(0);
    } finally {
      server.stop();
      db.close();
    }
  });

  test("init then sendTurn with opening genesis", async () => {
    const db = new Database(":memory:");
    const opts = mkOpts(db);
    const turns: unknown[] = [];
    const state = { conn: mkConn({ turns }), handles: new Map() };
    const server = startVellumControlServer({ state, db, ...opts });
    try {
      const sampleInit = ChainInitWireSchema.parse({
        session_id: "s4",
        genesis_hash: "dd".repeat(32),
        party_dids: ["did:key:alice", "did:key:bob"],
        peer_identity_key: "ff".repeat(32),
      });
      const res = await fetch(`http://${server.hostname}:${server.port}/chain/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          init: sampleInit,
          genesis_turn: SAMPLE_OPENING_TURN,
        }),
      });
      expect(res.ok).toBe(true);
      expect(turns.length).toBe(1);
      const body = turns[0] as { ports?: unknown[] };
      expect(Array.isArray(body.ports)).toBe(true);
      expect(body.ports?.length).toBe(1);
    } finally {
      server.stop();
      db.close();
    }
  });
});

describe("GET /chain/:sessionId", () => {
  test("empty graph snapshot: initiator needsTurn", async () => {
    const db = new Database(":memory:");
    const turns: unknown[] = [];
    const state = { conn: mkConn({ turns }), handles: new Map() };
    const server = startVellumControlServer({ state, db, ...mkOpts(db) });
    try {
      const sampleInit = ChainInitWireSchema.parse({
        session_id: "s-snap",
        genesis_hash: "33".repeat(32),
        party_dids: ["did:key:alice", "did:key:bob"],
        peer_identity_key: "ff".repeat(32),
      });
      const initRes = await fetch(`http://${server.hostname}:${server.port}/chain/init`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ init: sampleInit }),
      });
      expect(initRes.ok).toBe(true);
      const snapRes = await fetch(`http://${server.hostname}:${server.port}/chain/s-snap`);
      expect(snapRes.ok).toBe(true);
      const snap = (await snapRes.json()) as {
        whoShouldAct: string | null;
        needsTurn: boolean;
        portsICanBind: unknown[];
      };
      expect(snap.whoShouldAct).toBe("did:key:alice");
      expect(snap.needsTurn).toBe(true);
      expect(snap.portsICanBind).toEqual([]);
    } finally {
      server.stop();
      db.close();
    }
  });

  test("unknown sessionId returns 404", async () => {
    const db = new Database(":memory:");
    const turns: unknown[] = [];
    const state = { conn: mkConn({ turns }), handles: new Map() };
    const server = startVellumControlServer({ state, db, ...mkOpts(db) });
    try {
      const snapRes = await fetch(`http://${server.hostname}:${server.port}/chain/no-such`);
      expect(snapRes.status).toBe(404);
    } finally {
      server.stop();
      db.close();
    }
  });
});
