import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createInMemoryObpPersistenceClient } from "@khoralabs/obp-core/persistence";
import { createVellumPersistence } from "../persistence/sqlite/vellum-persistence";
import { InProcessControlTransport } from "../transport";
import { createVellumControlDispatch, type VellumControlServerState } from "./control-server";
import { testControlSigner } from "./test-signer";

describe("InProcessControlTransport", () => {
  test("dispatches /health without Bun.serve", async () => {
    const db = new Database(":memory:");
    const meta = createVellumPersistence(db);
    meta.ensureSchema();
    const state: VellumControlServerState = { conn: undefined, handles: new Map() };
    const dispatch = createVellumControlDispatch({
      state,
      db,
      meta,
      persistence: createInMemoryObpPersistenceClient(),
      signer: testControlSigner(),
      myActorPubkeyHex: "ee".repeat(32),
    });
    const transport = new InProcessControlTransport(dispatch);
    const res = await transport.fetch("/health");
    expect(res.status).toBe(204);
    db.close();
  });

  test("GET /chain returns empty snapshot", async () => {
    const db = new Database(":memory:");
    const meta = createVellumPersistence(db);
    meta.ensureSchema();
    // OBP tables for counts — openObp schema not present; counts may throw.
    // create tables minimally or catch — control uses obpTableCount on missing tables.
    try {
      db.run("CREATE TABLE obp_parties (id TEXT)");
      db.run("CREATE TABLE obp_offers (id TEXT)");
      db.run("CREATE TABLE obp_exposes (id TEXT)");
      db.run("CREATE TABLE obp_binds (id TEXT)");
    } catch {
      // ignore
    }
    const state: VellumControlServerState = { conn: undefined, handles: new Map() };
    const transport = new InProcessControlTransport(
      createVellumControlDispatch({
        state,
        db,
        meta,
        persistence: createInMemoryObpPersistenceClient(),
        signer: testControlSigner(),
        myActorPubkeyHex: "aa".repeat(32),
      }),
    );
    const res = await transport.fetch("/chain");
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { chains: unknown[] };
    expect(body.chains).toEqual([]);
    db.close();
  });
});
