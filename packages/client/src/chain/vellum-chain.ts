import {
  type ContinueTurn,
  type HostTurnBody,
  isNbcTurnBody,
  isOpeningTurn,
  type LeaveTurn,
  type NbcChainGraph,
  type NbcChainPortRow,
  type ObpStandardSchema,
  type OpeningTurn,
  serializeNbcTurnBodyForWire,
} from "@khoralabs/obp-nbc";
import { availablePeerPorts, negotiationOutputToWire } from "@khoralabs/obp-nbc/host";

import type { VellumClient } from "../vellum-client";

export type ChainSnapshot = {
  session_id: string;
  graph: NbcChainGraph;
  whoShouldAct: string | null;
  portsICanBind: NbcChainPortRow[];
  needsTurn: boolean;
  schema: ObpStandardSchema;
};

export type TurnCue = {
  youAct: boolean;
  schema: ObpStandardSchema;
  portsICanBind: NbcChainPortRow[];
  sessionId: string;
  snapshot: ChainSnapshot;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(
  body: OpeningTurn | ContinueTurn | LeaveTurn | Record<string, unknown>,
): Record<string, unknown> {
  return body as Record<string, unknown>;
}

export class VellumChain {
  constructor(
    private readonly client: VellumClient,
    readonly sessionId: string,
    readonly peerDid: string,
  ) {}

  static async open(
    client: VellumClient,
    opts: { peer: string; genesisTurn?: OpeningTurn | Record<string, unknown> },
  ): Promise<VellumChain> {
    let genesisTurn: Record<string, unknown> | undefined;
    if (opts.genesisTurn !== undefined) {
      if (isOpeningTurn(opts.genesisTurn as HostTurnBody)) {
        const wired = negotiationOutputToWire({
          raw: opts.genesisTurn,
          opening: true,
          peerPorts: [],
        });
        if (wired.kind !== "offer") {
          throw new Error("genesis turn must not disconnect");
        }
        genesisTurn = wired.body;
      } else {
        genesisTurn = opts.genesisTurn as Record<string, unknown>;
      }
    }
    const out = await client.chainCreate({
      counterpartyDid: opts.peer,
      ...(genesisTurn !== undefined ? { genesisTurn } : {}),
    });
    return new VellumChain(client, out.session_id, opts.peer);
  }

  async init(genesisTurn: OpeningTurn | Record<string, unknown>): Promise<void> {
    await this.commit(genesisTurn);
  }

  async snapshot(): Promise<ChainSnapshot> {
    return this.client.getSessionSnapshot(this.sessionId);
  }

  async waitForGraph(opts?: { timeoutMs?: number }): Promise<ChainSnapshot> {
    const deadline = Date.now() + (opts?.timeoutMs ?? 15_000);
    while (Date.now() < deadline) {
      const snap = await this.snapshot();
      if (snap.graph.offers.length > 0 || snap.graph.exposes.length > 0) return snap;
      await sleep(50);
    }
    throw new Error("waitForGraph timeout");
  }

  async *turns(opts?: { signal?: AbortSignal; pollMs?: number }): AsyncIterable<TurnCue> {
    const pollMs = opts?.pollMs ?? 50;
    let lastKey = "";
    while (opts?.signal?.aborted !== true) {
      const snapshot = await this.snapshot();
      const key = `${this.sessionId}:${snapshot.whoShouldAct ?? ""}:${snapshot.graph.offers.length}`;
      if (key !== lastKey) {
        lastKey = key;
        yield {
          youAct: snapshot.needsTurn,
          schema: snapshot.schema,
          portsICanBind: snapshot.portsICanBind,
          sessionId: this.sessionId,
          snapshot,
        };
      }
      if (snapshot.whoShouldAct === null && snapshot.graph.offers.length > 0) {
        return;
      }
      await sleep(pollMs);
    }
  }

  async commit(
    body: OpeningTurn | ContinueTurn | LeaveTurn | Record<string, unknown>,
  ): Promise<void> {
    const raw = asRecord(body);
    if (isNbcTurnBody(raw)) {
      await this.client.sendTurn(this.sessionId, serializeNbcTurnBodyForWire(raw));
      return;
    }
    const snap = await this.snapshot();
    const myDid = await this.client.actorDid();
    const wired = negotiationOutputToWire({
      raw: body,
      opening: snap.graph.offers.length === 0,
      peerPorts: availablePeerPorts(snap.graph, myDid),
    });
    if (wired.kind === "disconnect") {
      await this.client.endOffers(this.sessionId);
      return;
    }
    await this.client.sendTurn(this.sessionId, wired.body);
  }

  async close(): Promise<void> {
    try {
      await this.client.terminateChain(this.sessionId);
    } finally {
      await this.client.chainRelease(this.sessionId);
    }
  }
}
