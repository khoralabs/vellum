import { describe, expect, test } from "bun:test";

import type { NbcChainGraph } from "@khoralabs/obp-nbc";

import { mergeLibraryEntries, observeLibraryFromGraph } from "./library.ts";

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

describe("offer/port library observation", () => {
  test("dedupes identical ports within one episode so useCount stays 1", () => {
    const graph = emptyGraph({
      offers: [
        {
          id: "o1",
          type: "service.Price",
          partyId: "did:lab:a",
          expires_turn: 0,
          expires_at_ms: 0,
        },
      ],
      ports: [
        {
          id: "p1",
          kind: "Price",
          promise: "same",
          expires_turn: 0,
          expires_at_ms: 0,
          bind_policy: null,
          ref: "",
          exposedOnOfferIds: ["o1"],
          bindCount: 0,
          terminal: false,
        },
        {
          id: "p2",
          kind: "Price",
          promise: "same",
          expires_turn: 0,
          expires_at_ms: 0,
          bind_policy: null,
          ref: "",
          exposedOnOfferIds: ["o1"],
          bindCount: 0,
          terminal: false,
        },
      ],
    });

    const observed = observeLibraryFromGraph({
      actorDid: "did:lab:a",
      episodeId: "ep1",
      peerDid: "did:lab:b",
      role: "initiator",
      outcome: "bound",
      graph,
    });
    const ports = observed.filter((e) => e.kind === "port");
    expect(ports).toHaveLength(1);
    expect(ports[0]?.useCount).toBe(1);

    const merged = mergeLibraryEntries([], observed);
    expect(merged.filter((e) => e.kind === "port")[0]?.useCount).toBe(1);

    const again = observeLibraryFromGraph({
      actorDid: "did:lab:a",
      episodeId: "ep2",
      peerDid: "did:lab:b",
      role: "initiator",
      outcome: "bound",
      graph,
    });
    const reused = mergeLibraryEntries(merged, again).filter((e) => e.kind === "port")[0];
    expect(reused?.useCount).toBe(2);
  });
});
