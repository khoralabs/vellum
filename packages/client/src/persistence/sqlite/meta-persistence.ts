import type { Database } from "bun:sqlite";

import type { VellumMetaPersistence } from "../core/types";

const META_DDL = `
CREATE TABLE IF NOT EXISTS vellum_chains (
  session_id TEXT PRIMARY KEY NOT NULL,
  genesis_hash TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vellum_roster (
  principal_uri TEXT NOT NULL PRIMARY KEY,
  actor_pubkey TEXT NOT NULL,
  updated_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vellum_prekey_secrets (
  spk_id INTEGER NOT NULL PRIMARY KEY,
  spk_priv_hex TEXT NOT NULL,
  updated_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vellum_prekey_otk_secrets (
  otk_id INTEGER NOT NULL PRIMARY KEY,
  otk_priv_hex TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vellum_session_keys (
  session_id TEXT NOT NULL PRIMARY KEY,
  session_key_hex TEXT NOT NULL,
  updated_ms INTEGER NOT NULL
);`;

function hexToBytes(hex: string): Uint8Array {
  const h = hex.trim();
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Reference {@link VellumMetaPersistence} on an open Bun SQLite database
 * (typically the same file as the OBP channel store).
 */
export function createVellumMetaPersistence(db: Database): VellumMetaPersistence {
  return {
    ensureSchema(): void {
      db.run(META_DDL);
    },

    upsertChain(sessionId: string, genesisHash: string, createdMs: number): void {
      db.run(
        `INSERT INTO vellum_chains (session_id, genesis_hash, created_ms)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO NOTHING`,
        [sessionId, genesisHash, createdMs],
      );
    },

    upsertRosterEntry(principalUri: string, actorPubkey: string, updatedMs: number): void {
      db.run(
        `INSERT INTO vellum_roster (principal_uri, actor_pubkey, updated_ms)
         VALUES (?, ?, ?)
         ON CONFLICT(principal_uri) DO UPDATE SET
           actor_pubkey = excluded.actor_pubkey,
           updated_ms = excluded.updated_ms`,
        [principalUri, actorPubkey, updatedMs],
      );
    },

    getRosterActor(principalUri: string): string | undefined {
      const row = db
        .query<{ actor_pubkey: string }, [string]>(
          `SELECT actor_pubkey FROM vellum_roster WHERE principal_uri = ?`,
        )
        .get(principalUri);
      return row?.actor_pubkey;
    },

    upsertPreKeySecrets(
      spkId: number,
      spkPrivHex: string,
      otks: Array<{ otkId: number; otkPrivHex: string }>,
      updatedMs: number,
    ): void {
      db.run("BEGIN");
      try {
        db.run(`DELETE FROM vellum_prekey_otk_secrets`);
        db.run(
          `INSERT INTO vellum_prekey_secrets (spk_id, spk_priv_hex, updated_ms)
           VALUES (?, ?, ?)
           ON CONFLICT(spk_id) DO UPDATE SET
             spk_priv_hex = excluded.spk_priv_hex,
             updated_ms = excluded.updated_ms`,
          [spkId, spkPrivHex, updatedMs],
        );
        const insert = db.prepare(
          `INSERT INTO vellum_prekey_otk_secrets (otk_id, otk_priv_hex) VALUES (?, ?)`,
        );
        for (const otk of otks) {
          insert.run(otk.otkId, otk.otkPrivHex);
        }
        db.run("COMMIT");
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
    },

    loadPreKeySecrets(otkId: number | null): { spkPriv: Uint8Array; otkPriv?: Uint8Array } {
      const spk = db
        .query<{ spk_priv_hex: string }, []>(
          `SELECT spk_priv_hex FROM vellum_prekey_secrets LIMIT 1`,
        )
        .get();
      if (spk === undefined || spk === null) {
        throw new Error("prekey secrets not found");
      }
      const spkPriv = hexToBytes(spk.spk_priv_hex);
      if (otkId === null) return { spkPriv };
      const otk = db
        .query<{ otk_priv_hex: string }, [number]>(
          `SELECT otk_priv_hex FROM vellum_prekey_otk_secrets WHERE otk_id = ?`,
        )
        .get(otkId);
      if (otk === undefined || otk === null) {
        throw new Error(`OTK secret not found for id ${otkId}`);
      }
      return { spkPriv, otkPriv: hexToBytes(otk.otk_priv_hex) };
    },

    upsertSessionKey(sessionId: string, sessionKeyHex: string, updatedMs: number): void {
      db.run(
        `INSERT INTO vellum_session_keys (session_id, session_key_hex, updated_ms)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           session_key_hex = excluded.session_key_hex,
           updated_ms = excluded.updated_ms`,
        [sessionId, sessionKeyHex, updatedMs],
      );
    },

    listChains(): Array<{ session_id: string; genesis_hash: string; created_ms: number }> {
      return db
        .query<{ session_id: string; genesis_hash: string; created_ms: number }, []>(
          `SELECT session_id, genesis_hash, created_ms FROM vellum_chains ORDER BY created_ms ASC`,
        )
        .all();
    },
  };
}
