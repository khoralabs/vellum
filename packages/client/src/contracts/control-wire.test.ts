import { describe, expect, test } from "bun:test";

import { ChainInitRequestSchema } from "./control-wire";

const sampleInit = {
  session_id: "sess-1",
  genesis_hash: "aa".repeat(32),
  party_dids: ["did:key:alice", "did:key:bob"] as [string, string],
  peer_identity_key: "11".repeat(32),
};

describe("ChainInitRequestSchema", () => {
  test("accepts party_dids + peer_identity_key", () => {
    const r = ChainInitRequestSchema.safeParse({ init: sampleInit });
    expect(r.success).toBe(true);
  });

  test("rejects missing peer_identity_key", () => {
    const r = ChainInitRequestSchema.safeParse({
      init: {
        session_id: "s",
        genesis_hash: "aa".repeat(32),
        party_dids: ["did:key:a", "did:key:b"],
      },
      genesis_turn: {},
    });
    expect(r.success).toBe(false);
  });
});
