import { describe, expect, test } from "bun:test";
import { hostTurnToNbcBody, openingTurnSchema } from "@khoralabs/obp-nbc";
import { negotiationOutputToWire } from "@khoralabs/obp-nbc/host";

import type { VellumClient } from "../vellum-client";
import { VellumChain } from "./vellum-chain";

describe("opening profile", () => {
  test("maps expose to NBC genesis body", () => {
    const result = openingTurnSchema["~standard"].validate({
      expose: [{ kind: "slot", promise: "hello" }],
    });
    expect("value" in result).toBe(true);
    if (!("value" in result)) return;
    const wire = hostTurnToNbcBody(result.value, "opening");
    expect(wire.bind_port_id).toBe("");
    expect(wire.ports[0]?.kind).toBe("slot");
    expect(wire.offer.expires_at_ms).toBe(0);
  });
});

describe("VellumChain.commit", () => {
  test("maps host opening turn via negotiationOutputToWire", async () => {
    const sent: Record<string, unknown>[] = [];
    const client = {
      actorDid: async () => "did:key:alice",
      sendTurn: async (_sessionId: string, body: Record<string, unknown>) => {
        sent.push(body);
      },
      getSessionSnapshot: async () => ({
        session_id: "s1",
        graph: { offers: [], exposes: [], binds: [], parties: [], extends: [], ports: [] },
        whoShouldAct: "did:key:alice",
        portsICanBind: [],
        needsTurn: true,
        schema: openingTurnSchema,
      }),
    } as unknown as VellumClient;
    const chain = new VellumChain(client, "s1", "did:key:bob");
    await chain.commit({ expose: [{ kind: "slot", promise: "hello" }] });
    expect(sent).toHaveLength(1);
    const wired = negotiationOutputToWire({
      raw: { expose: [{ kind: "slot", promise: "hello" }] },
      opening: true,
      peerPorts: [],
    });
    expect(wired.kind).toBe("offer");
    if (wired.kind === "offer") expect(sent[0]).toEqual(wired.body);
  });

  test("sends wire-formatted NBC turns without host schema validation", async () => {
    const sent: Record<string, unknown>[] = [];
    const client = {
      sendTurn: async (_sessionId: string, body: Record<string, unknown>) => {
        sent.push(body);
      },
      getSessionSnapshot: async () => {
        throw new Error("snapshot should not run for wire bodies");
      },
    } as unknown as VellumClient;
    const chain = new VellumChain(client, "s1", "did:key:bob");
    await chain.commit({
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
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.offer).toEqual({
      id: "",
      type: "opening",
      expires_turn: 0,
      expires_at_ms: 0,
    });
  });
});
