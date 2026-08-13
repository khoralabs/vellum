import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import type { VellumMetaPersistence } from "../core/types";
import { createVellumMetaPersistence } from "./meta-persistence";

function runVellumMetaPersistenceContract(name: string, create: () => VellumMetaPersistence): void {
  describe(`${name} VellumMetaPersistence`, () => {
    test("ensureSchema + upsertChain is idempotent", () => {
      const meta = create();
      meta.ensureSchema();
      meta.upsertChain("s1", "gen", 1);
      meta.upsertChain("s1", "gen-other", 2);
      const chains = meta.listChains();
      expect(chains).toEqual([{ session_id: "s1", genesis_hash: "gen", created_ms: 1 }]);
    });

    test("roster upsert + get", () => {
      const meta = create();
      meta.ensureSchema();
      meta.upsertRosterEntry("did:key:a", "aa".repeat(32), 10);
      meta.upsertRosterEntry("did:key:a", "bb".repeat(32), 20);
      expect(meta.getRosterActor("did:key:a")).toBe("bb".repeat(32));
      expect(meta.getRosterActor("missing")).toBeUndefined();
    });

    test("prekey secrets round-trip", () => {
      const meta = create();
      meta.ensureSchema();
      const spk = "cc".repeat(32);
      const otk = "dd".repeat(32);
      meta.upsertPreKeySecrets(1, spk, [{ otkId: 7, otkPrivHex: otk }], 1);
      const loaded = meta.loadPreKeySecrets(7);
      expect(Buffer.from(loaded.spkPriv).toString("hex")).toBe(spk);
      expect(loaded.otkPriv).toBeDefined();
      expect(Buffer.from(loaded.otkPriv as Uint8Array).toString("hex")).toBe(otk);
    });
  });
}

runVellumMetaPersistenceContract("bun:sqlite", () => {
  const db = new Database(":memory:");
  return createVellumMetaPersistence(db);
});
