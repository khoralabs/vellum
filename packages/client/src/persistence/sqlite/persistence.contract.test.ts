import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { VellumPersistence } from "../core/types";
import { createVellumPersistence, createVellumPersistenceAtPath } from "./vellum-persistence";

const OBP_READ_DDL = `
CREATE TABLE IF NOT EXISTS obp_offers (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  nbc_expires_turn INTEGER NOT NULL,
  nbc_expires_at_ms INTEGER NOT NULL,
  created_seq INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS obp_ports (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  promise TEXT NOT NULL,
  ref TEXT NOT NULL,
  nbc_expires_turn INTEGER NOT NULL,
  nbc_expires_at_ms INTEGER NOT NULL,
  bind_policy_json TEXT
);
CREATE TABLE IF NOT EXISTS obp_exposes (
  offer_id TEXT NOT NULL,
  port_id TEXT NOT NULL
);`;

function runVellumPersistenceContract(name: string, create: () => VellumPersistence): void {
  describe(`${name} VellumPersistence`, () => {
    test("ensureSchema + upsertChain is idempotent", () => {
      const store = create();
      store.ensureSchema();
      store.upsertChain("s1", "gen", 1);
      store.upsertChain("s1", "gen-other", 2);
      const chains = store.listChains();
      expect(chains).toEqual([
        { session_id: "s1", genesis_hash: "gen", created_ms: 1, initiator_did: "" },
      ]);
    });

    test("upsertChain fills empty initiator_did and getChain reads it", () => {
      const store = create();
      store.ensureSchema();
      store.upsertChain("s1", "gen", 1);
      store.upsertChain("s1", "gen-other", 2, "did:key:alice");
      store.upsertChain("s1", "gen-other", 3, "did:key:bob");
      expect(store.getChain("s1")).toEqual({
        session_id: "s1",
        genesis_hash: "gen",
        created_ms: 1,
        initiator_did: "did:key:alice",
      });
      expect(store.getChain("missing")).toBeUndefined();
    });

    test("roster upsert + get", () => {
      const store = create();
      store.ensureSchema();
      store.upsertRosterEntry("did:key:a", "aa".repeat(32), 10);
      store.upsertRosterEntry("did:key:a", "bb".repeat(32), 20);
      expect(store.getRosterActor("did:key:a")).toBe("bb".repeat(32));
      expect(store.getRosterActor("missing")).toBeUndefined();
    });

    test("prekey secrets round-trip", () => {
      const store = create();
      store.ensureSchema();
      const spk = "cc".repeat(32);
      const otk = "dd".repeat(32);
      store.upsertPreKeySecrets(1, spk, [{ otkId: 7, otkPrivHex: otk }], 1);
      const loaded = store.loadPreKeySecrets(7);
      expect(Buffer.from(loaded.spkPriv).toString("hex")).toBe(spk);
      expect(loaded.otkPriv).toBeDefined();
      expect(Buffer.from(loaded.otkPriv as Uint8Array).toString("hex")).toBe(otk);
    });

    test("offer / port graph reads", () => {
      const db = new Database(":memory:");
      db.run(OBP_READ_DDL);
      const store = createVellumPersistence(db);
      store.ensureSchema();
      db.run(
        `INSERT INTO obp_offers (id, type, nbc_expires_turn, nbc_expires_at_ms, created_seq)
         VALUES ('o1', 'capability', 0, 0, 1)`,
      );
      db.run(
        `INSERT INTO obp_ports (id, kind, promise, ref, nbc_expires_turn, nbc_expires_at_ms, bind_policy_json)
         VALUES ('p1', 'promise', 'x', 'r', 0, 0, '{"k":1}')`,
      );
      db.run(`INSERT INTO obp_exposes (offer_id, port_id) VALUES ('o1', 'p1')`);

      expect(store.listOffers()).toEqual([
        { id: "o1", type: "capability", nbc_expires_turn: 0, nbc_expires_at_ms: 0 },
      ]);
      expect(store.readOffer("o1")?.id).toBe("o1");
      expect(store.listPortIdsForOffer("o1")).toEqual(["p1"]);
      expect(store.readPort("p1")).toEqual({
        id: "p1",
        kind: "promise",
        promise: "x",
        ref: "r",
        nbc_expires_turn: 0,
        nbc_expires_at_ms: 0,
        bind_policy: { k: 1 },
      });
    });
  });
}

runVellumPersistenceContract("bun:sqlite", () => {
  const db = new Database(":memory:");
  return createVellumPersistence(db);
});

describe("createVellumPersistenceAtPath", () => {
  test("ensureSchema creates missing database file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vellum-persist-"));
    const sqlitePath = path.join(dir, "obp.sqlite");
    expect(fs.existsSync(sqlitePath)).toBe(false);
    const store = createVellumPersistenceAtPath(sqlitePath);
    store.ensureSchema();
    expect(fs.existsSync(sqlitePath)).toBe(true);
    store.upsertChain("s1", "gen", 1);
    expect(store.listChains()).toEqual([
      { session_id: "s1", genesis_hash: "gen", created_ms: 1, initiator_did: "" },
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("readonly ops throw when file is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vellum-persist-"));
    const sqlitePath = path.join(dir, "missing.sqlite");
    const store = createVellumPersistenceAtPath(sqlitePath);
    expect(() => store.listChains()).toThrow(/channel database not found/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
