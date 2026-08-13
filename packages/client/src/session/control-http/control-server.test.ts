import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createInMemoryObpPersistenceClient } from "@khoralabs/obp-core/persistence";
import type {
  FrameMultiplexOpenerApi,
  FrameSessionHandle,
  SessionInitNormalized,
} from "@khoralabs/obp-wire";
import { ChainInitWireSchema, DEFAULT_GENESIS_TURN_WIRE } from "../../contracts";
import { createVellumPersistence } from "../../persistence/sqlite/vellum-persistence";
import { testControlSigner } from "../testing/test-signer";
import { startVellumControlServer } from "./server";

const testSigner = testControlSigner("did:key:alice");

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

function mkConn(opts: { turns: unknown[] }): FrameMultiplexOpenerApi {
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
        terminate: async (): Promise<void> => {},
      };
      return stub as FrameSessionHandle;
    },
    close(): void {},
  };
}

describe("POST /chain/init genesis_turn", () => {
  test("400 when genesis_turn missing (schema)", async () => {
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
      expect(res.status).toBe(400);
      expect(turns.length).toBe(0);
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
            ...DEFAULT_GENESIS_TURN_WIRE,
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
            ...DEFAULT_GENESIS_TURN_WIRE,
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

  test("init then sendTurn with default genesis shape", async () => {
    const db = new Database(":memory:");
    const opts = mkOpts(db);
    opts.meta.upsertRosterEntry("did:key:bob", "ff".repeat(32), Date.now());
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
          genesis_turn: DEFAULT_GENESIS_TURN_WIRE,
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
