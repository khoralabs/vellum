import { describe, expect, test } from "bun:test";

import type { NbcChainGraph } from "@khoralabs/obp-nbc";

import { protocolSignature, slope } from "./protocol-signature.ts";

function emptyGraph(over: Partial<NbcChainGraph> = {}): NbcChainGraph {
  return {
    parties: [],
    offers: [],
    ports: [],
    exposes: [],
    binds: [],
    extends: [],
    ...over,
  };
}

describe("protocol signature helpers", () => {
  test("binder role follows binding offer party, not port owner inversion", () => {
    const graph = emptyGraph({
      offers: [
        {
          id: "o-init",
          type: "service.Price",
          partyId: "did:lab:a",
          expires_turn: 0,
          expires_at_ms: 0,
        },
        {
          id: "o-counter",
          type: "service.slot",
          partyId: "did:lab:b",
          expires_turn: 0,
          expires_at_ms: 0,
        },
      ],
      ports: [
        {
          id: "p1",
          kind: "Price",
          promise: "offer",
          expires_turn: 0,
          expires_at_ms: 0,
          bind_policy: null,
          ref: "",
          exposedOnOfferIds: ["o-init"],
          bindCount: 1,
          terminal: true,
        },
      ],
      binds: [{ offerId: "o-counter", portId: "p1", bind_payload: { Price: "$3.98" } }],
    });

    const sig = protocolSignature(graph, "did:lab:a");
    expect(sig).toContain("binds=counterparty:T:{Price}");
  });

  test("slope ignores non-finite values and uses valid sample count", () => {
    expect(slope([1, 2, 3])).toBeCloseTo(1, 5);
    expect(slope([1, Number.NaN, 3])).toBeCloseTo(2, 5);
    expect(slope([1, Number.POSITIVE_INFINITY])).toBeNull();
    expect(slope([4, 3, 2])).toBeCloseTo(-1, 5);
  });
});
