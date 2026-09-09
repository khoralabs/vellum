import { createHash } from "node:crypto";

import type { NbcChainGraph, NbcChainOfferRow, NbcChainPortRow } from "@khoralabs/obp-nbc";

import type { EpisodeOutcome, OfferPortLibraryEntry } from "./types.ts";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function fingerprint(parts: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(parts)).digest("hex").slice(0, 24);
}

function offerFingerprint(offer: NbcChainOfferRow): string {
  return fingerprint({ kind: "offer", type: offer.type, partyId: offer.partyId });
}

function portFingerprint(port: NbcChainPortRow): string {
  return fingerprint({
    kind: "port",
    portKind: port.kind,
    promise: port.promise,
    terminal: port.terminal ?? false,
    max_bindings: port.max_bindings ?? null,
    bind_policy: port.bind_policy ?? null,
    ref: port.ref,
  });
}

function bindFingerprint(port: NbcChainPortRow, payload: unknown): string {
  return fingerprint({
    kind: "bound-peer-port",
    portKind: port.kind,
    promise: port.promise,
    terminal: port.terminal ?? false,
    bind_policy: port.bind_policy ?? null,
    payload,
  });
}

/** Observe authored offers/ports and bound peer ports for one agent from a completed chain. */
export function observeLibraryFromGraph(input: {
  actorDid: string;
  episodeId: string;
  peerDid: string;
  role: "initiator" | "counterparty";
  outcome: EpisodeOutcome;
  graph: NbcChainGraph;
}): OfferPortLibraryEntry[] {
  const { actorDid, episodeId, peerDid, role, outcome, graph } = input;
  const authoredOfferIds = new Set(
    graph.offers.filter((o) => o.partyId === actorDid).map((o) => o.id),
  );
  const entries: OfferPortLibraryEntry[] = [];

  for (const offer of graph.offers) {
    if (offer.partyId !== actorDid) continue;
    entries.push({
      fingerprint: offerFingerprint(offer),
      kind: "offer",
      raw: {
        type: offer.type,
        partyId: offer.partyId,
      },
      episodeId,
      peerDid,
      role,
      outcome,
      authored: true,
      exposed: true,
      bound: false,
      useCount: 1,
      firstEpisodeId: episodeId,
      lastEpisodeId: episodeId,
    });
  }

  for (const port of graph.ports) {
    const exposedOnMine = port.exposedOnOfferIds.some((id) => authoredOfferIds.has(id));
    if (!exposedOnMine) continue;
    entries.push({
      fingerprint: portFingerprint(port),
      kind: "port",
      raw: {
        portKind: port.kind,
        promise: port.promise,
        terminal: port.terminal ?? false,
        max_bindings: port.max_bindings ?? null,
        bind_policy: port.bind_policy ?? null,
        ref: port.ref,
      },
      episodeId,
      peerDid,
      role,
      outcome,
      authored: true,
      exposed: true,
      bound: graph.binds.some((b) => b.portId === port.id),
      useCount: 1,
      firstEpisodeId: episodeId,
      lastEpisodeId: episodeId,
    });
  }

  for (const bind of graph.binds) {
    const bindingOffer = graph.offers.find((o) => o.id === bind.offerId);
    if (bindingOffer?.partyId !== actorDid) continue;
    const port = graph.ports.find((p) => p.id === bind.portId);
    if (port === undefined) continue;
    // Skip if this agent also authored the port (self-bind attribution already covered).
    const authoredPort = port.exposedOnOfferIds.some((id) => authoredOfferIds.has(id));
    if (authoredPort) continue;
    entries.push({
      fingerprint: bindFingerprint(port, bind.bind_payload),
      kind: "bound-peer-port",
      raw: {
        portKind: port.kind,
        promise: port.promise,
        terminal: port.terminal ?? false,
        bind_policy: port.bind_policy ?? null,
        payload: bind.bind_payload,
      },
      episodeId,
      peerDid,
      role,
      outcome,
      authored: false,
      exposed: false,
      bound: true,
      useCount: 1,
      firstEpisodeId: episodeId,
      lastEpisodeId: episodeId,
    });
  }

  const byFp = new Map<string, OfferPortLibraryEntry>();
  for (const e of entries) {
    const prev = byFp.get(e.fingerprint);
    if (prev === undefined) {
      byFp.set(e.fingerprint, e);
      continue;
    }
    byFp.set(e.fingerprint, {
      ...prev,
      authored: prev.authored || e.authored,
      exposed: prev.exposed || e.exposed,
      bound: prev.bound || e.bound,
      // Same episode: keep useCount at 1 so reuse metrics stay cross-episode.
      useCount: 1,
    });
  }
  return [...byFp.values()];
}

/** Merge observed entries into an existing library, counting fingerprint reuse. */
export function mergeLibraryEntries(
  existing: readonly OfferPortLibraryEntry[],
  observed: readonly OfferPortLibraryEntry[],
): OfferPortLibraryEntry[] {
  const byFp = new Map<string, OfferPortLibraryEntry>();
  for (const e of existing) byFp.set(e.fingerprint, { ...e });
  for (const e of observed) {
    const prev = byFp.get(e.fingerprint);
    if (prev === undefined) {
      byFp.set(e.fingerprint, { ...e });
      continue;
    }
    byFp.set(e.fingerprint, {
      ...prev,
      useCount: prev.useCount + 1,
      lastEpisodeId: e.episodeId,
      authored: prev.authored || e.authored,
      exposed: prev.exposed || e.exposed,
      bound: prev.bound || e.bound,
      outcome: e.outcome,
      peerDid: e.peerDid,
      role: e.role,
    });
  }
  return [...byFp.values()];
}

export function libraryReuseRate(entries: readonly OfferPortLibraryEntry[]): number {
  if (entries.length === 0) return 0;
  const reused = entries.filter((e) => e.useCount > 1).length;
  return reused / entries.length;
}
