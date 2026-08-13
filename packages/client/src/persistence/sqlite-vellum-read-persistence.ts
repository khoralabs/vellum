import fs from "node:fs";
import Database from "better-sqlite3";
import type { VellumChainRow, VellumOfferRow, VellumPortRow } from "../contracts";

import type { VellumReadModel } from "./vellum-read-persistence";

/** Read-only SQLite projection for the channel `obp.sqlite` schema. */
export class SqliteVellumReadModel implements VellumReadModel {
  constructor(private readonly sqlitePath: string) {}

  private withDb<T>(fn: (db: Database.Database) => T): T {
    if (!fs.existsSync(this.sqlitePath)) {
      throw new Error(`channel database not found at ${this.sqlitePath}`);
    }
    const db = new Database(this.sqlitePath, { readonly: true, fileMustExist: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  listChains(): VellumChainRow[] {
    return this.withDb(
      (db) =>
        db
          .prepare(
            `SELECT session_id, genesis_hash, created_ms FROM vellum_chains ORDER BY created_ms ASC`,
          )
          .all() as VellumChainRow[],
    );
  }

  listOffers(): VellumOfferRow[] {
    return this.withDb(
      (db) =>
        db
          .prepare(
            `SELECT id, type, nbc_expires_turn, nbc_expires_at_relay_ms FROM obp_offers ORDER BY created_seq ASC`,
          )
          .all() as VellumOfferRow[],
    );
  }

  readOffer(offerId: string): VellumOfferRow | undefined {
    return this.withDb((db) => {
      const row = db
        .prepare(
          `SELECT id, type, nbc_expires_turn, nbc_expires_at_relay_ms FROM obp_offers WHERE id = ?`,
        )
        .get(offerId) as VellumOfferRow | undefined;
      return row;
    });
  }

  listPortIdsForOffer(offerId: string): string[] {
    return this.withDb((db) => {
      const rows = db
        .prepare(`SELECT port_id FROM obp_exposes WHERE offer_id = ?`)
        .all(offerId) as Array<{ port_id: string }>;
      return rows.map((r) => r.port_id);
    });
  }

  readPort(portId: string): VellumPortRow | undefined {
    return this.withDb((db) => {
      const r = db
        .prepare(
          `SELECT id, type, promise, ref, nbc_expires_turn, nbc_expires_at_relay_ms, bind_policy_json FROM obp_ports WHERE id = ?`,
        )
        .get(portId) as
        | {
            id: string;
            type: string;
            promise: string;
            ref: string;
            nbc_expires_turn: number;
            nbc_expires_at_relay_ms: number;
            bind_policy_json: string | null;
          }
        | undefined;
      if (r == null) return undefined;
      let bind_policy: unknown | null = null;
      if (r.bind_policy_json !== null && r.bind_policy_json.length > 0) {
        try {
          bind_policy = JSON.parse(r.bind_policy_json) as unknown;
        } catch {
          bind_policy = null;
        }
      }
      return {
        id: r.id,
        type: r.type,
        promise: r.promise,
        ref: r.ref,
        nbc_expires_turn: r.nbc_expires_turn,
        nbc_expires_at_relay_ms: r.nbc_expires_at_relay_ms,
        bind_policy,
      };
    });
  }
}
