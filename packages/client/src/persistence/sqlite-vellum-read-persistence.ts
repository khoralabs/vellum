import { Database } from "bun:sqlite";
import fs from "node:fs";
import type { VellumChainRow, VellumOfferRow, VellumPortRow } from "@khoralabs/vellum-contracts";

import type { VellumReadModel } from "./vellum-read-persistence";

/** Read-only SQLite projection for the channel `obp.sqlite` schema. */
export class SqliteVellumReadModel implements VellumReadModel {
  constructor(private readonly sqlitePath: string) {}

  private withDb<T>(fn: (db: Database) => T): T {
    if (!fs.existsSync(this.sqlitePath)) {
      throw new Error(`channel database not found at ${this.sqlitePath}`);
    }
    const db = new Database(this.sqlitePath, { readonly: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  listChains(): VellumChainRow[] {
    return this.withDb((db) =>
      db
        .query<{ session_id: string; genesis_hash: string; created_ms: number }, []>(
          `SELECT session_id, genesis_hash, created_ms FROM vellum_chains ORDER BY created_ms ASC`,
        )
        .all(),
    );
  }

  listOffers(): VellumOfferRow[] {
    return this.withDb((db) =>
      db
        .query<
          {
            id: string;
            type: string;
            nbc_expires_turn: number;
            nbc_expires_at_relay_ms: number;
          },
          []
        >(
          `SELECT id, type, nbc_expires_turn, nbc_expires_at_relay_ms FROM obp_offers ORDER BY created_seq ASC`,
        )
        .all(),
    );
  }

  readOffer(offerId: string): VellumOfferRow | undefined {
    return this.withDb((db) => {
      const row = db
        .query<
          {
            id: string;
            type: string;
            nbc_expires_turn: number;
            nbc_expires_at_relay_ms: number;
          },
          [string]
        >(`SELECT id, type, nbc_expires_turn, nbc_expires_at_relay_ms FROM obp_offers WHERE id = ?`)
        .get(offerId);
      return row ?? undefined;
    });
  }

  listPortIdsForOffer(offerId: string): string[] {
    return this.withDb((db) => {
      const rows = db
        .query<{ port_id: string }, [string]>(`SELECT port_id FROM obp_exposes WHERE offer_id = ?`)
        .all(offerId);
      return rows.map((r) => r.port_id);
    });
  }

  readPort(portId: string): VellumPortRow | undefined {
    return this.withDb((db) => {
      const r = db
        .query<
          {
            id: string;
            type: string;
            promise: string;
            ref: string;
            nbc_expires_turn: number;
            nbc_expires_at_relay_ms: number;
            bind_policy_json: string | null;
          },
          [string]
        >(
          `SELECT id, type, promise, ref, nbc_expires_turn, nbc_expires_at_relay_ms, bind_policy_json FROM obp_ports WHERE id = ?`,
        )
        .get(portId);
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
