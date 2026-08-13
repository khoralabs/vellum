import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createInMemoryObpPersistenceClient } from "@khoralabs/obp-core/persistence";
import { ChainInitWireSchema, DEFAULT_GENESIS_TURN_WIRE } from "../../contracts";
import { createVellumPersistence } from "../../persistence/sqlite/vellum-persistence";
import { testControlSigner } from "../testing/test-signer";
import { startVellumControlServer } from "./server";

test("chain/init rejects without relay allocation when check enabled", async () => {
  const db = new Database(":memory:");
  const meta = createVellumPersistence(db);
  meta.ensureSchema();
  const allocated = new Set<string>();
  const signer = testControlSigner("did:key:alice");

  const server = startVellumControlServer({
    state: { conn: undefined, handles: new Map() },
    db,
    meta,
    persistence: createInMemoryObpPersistenceClient(),
    signer,
    myActorPubkeyHex: "bb".repeat(32),
    isSessionAllocated: (sessionId) => allocated.has(sessionId),
  });

  const sampleInit = ChainInitWireSchema.parse({
    session_id: "unallocated",
    genesis_hash: "aa".repeat(32),
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
  expect(res.status).toBe(409);
  server.stop();
  db.close();
});
