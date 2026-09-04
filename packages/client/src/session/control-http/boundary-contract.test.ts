import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createInMemoryObpPersistenceClient } from "@khoralabs/obp-core/persistence";
import {
  VELLUM_CONTROL_HTTP_PATH,
  VELLUM_CONTROL_PROTOCOL_VERSION,
  VELLUM_ERROR_CODE,
  zVellumControlHealth,
} from "../../contracts";
import { createVellumPersistence } from "../../persistence/sqlite/vellum-persistence";
import { InProcessControlTransport } from "../../transport";
import { VellumClient, VellumClientError } from "../../vellum-client";
import { createVellumControlDispatch, type VellumControlServerState } from "../core";
import { testControlSigner } from "../testing/test-signer";

function createBoundaryStack() {
  const db = new Database(":memory:");
  const meta = createVellumPersistence(db);
  meta.ensureSchema();
  try {
    db.run("CREATE TABLE obp_parties (id TEXT)");
    db.run("CREATE TABLE obp_offers (id TEXT)");
    db.run("CREATE TABLE obp_exposes (id TEXT)");
    db.run("CREATE TABLE obp_binds (id TEXT)");
  } catch {
    // ignore
  }
  const state: VellumControlServerState = { conn: undefined, handles: new Map() };
  const dispatch = createVellumControlDispatch({
    state,
    db,
    meta,
    persistence: createInMemoryObpPersistenceClient(),
    signer: testControlSigner(),
    myActorPubkeyHex: "aa".repeat(32),
  });
  const transport = new InProcessControlTransport(dispatch);
  return { db, transport };
}

describe("control-plane boundary contracts", () => {
  test("health path constant returns versioned JSON", async () => {
    const { db, transport } = createBoundaryStack();
    const res = await transport.fetch(VELLUM_CONTROL_HTTP_PATH.health);
    expect(res.status).toBe(200);
    const body = zVellumControlHealth.parse(await res.json());
    expect(body.version).toBe(VELLUM_CONTROL_PROTOCOL_VERSION);
    db.close();
  });

  test("VellumClient surfaces not_found code for unknown session", async () => {
    const { db, transport } = createBoundaryStack();
    const client = new VellumClient({
      relayBaseUrl: "http://relay.test",
      channelId: "ch",
      controlTransport: transport,
      signer: testControlSigner(),
    });
    try {
      await client.getSessionSnapshot("missing-session");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(VellumClientError);
      expect((e as VellumClientError).status).toBe(404);
      expect((e as VellumClientError).code).toBe(VELLUM_ERROR_CODE.not_found);
      expect((e as VellumClientError).message).toContain("unknown session");
    }
    db.close();
  });

  test("VellumClient getChainSnapshot uses shared /chain path", async () => {
    const { db, transport } = createBoundaryStack();
    const client = new VellumClient({
      relayBaseUrl: "http://relay.test",
      channelId: "ch",
      controlTransport: transport,
      signer: testControlSigner(),
    });
    const snap = await client.getChainSnapshot();
    expect(snap.chains).toEqual([]);
    db.close();
  });
});
