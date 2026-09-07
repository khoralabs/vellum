import type { JsonDocument } from "@khoralabs/obp-core";
import { createInMemoryObpPersistenceClient } from "@khoralabs/obp-core/persistence";
import {
  applyNbcTurn,
  collectNbcChainGraph,
  type NbcChainGraph,
  parseNbcTurnBody,
  validateBindPolicyAtExpose,
} from "@khoralabs/obp-nbc";
import { validateNbcBindPayloadForPort } from "@khoralabs/obp-nbc/bind-policy";
import { availablePeerPorts, negotiationOutputToWire } from "@khoralabs/obp-nbc/host";

import type { MarkdownMemoryStore } from "./memory.ts";
import { protocolSignature } from "./protocol-signature.ts";
import type {
  EpisodeOutcome,
  EpisodeRecord,
  MemoryDiff,
  NegotiationPolicy,
  ScopedMemory,
  TokenUsage,
} from "./types.ts";

/** Bilateral ping-pong using known DIDs (graph.parties only lists offer extenders). */
function nextActorDid(
  graph: NbcChainGraph,
  initiatorDid: string,
  counterpartyDid: string,
  turnsCompleted: number,
  maxTurns: number,
  left: boolean,
): { did: string | null; reason: EpisodeOutcome | "continue" } {
  if (left) return { did: null, reason: "left" };
  if (graph.binds.length > 0) return { did: null, reason: "bound" };
  if (turnsCompleted >= maxTurns) return { did: null, reason: "turn-limit" };
  if (graph.offers.length === 0) return { did: initiatorDid, reason: "continue" };
  const last = graph.offers[graph.offers.length - 1];
  if (last === undefined) return { did: initiatorDid, reason: "continue" };
  const next = last.partyId === initiatorDid ? counterpartyDid : initiatorDid;
  if (availablePeerPorts(graph, next).length === 0) {
    return { did: null, reason: "error" };
  }
  return { did: next, reason: "continue" };
}

export type ReflectFn = (input: {
  actorDid: string;
  peerDid: string;
  purpose: string;
  outcome: EpisodeOutcome;
  protocolSignature: string;
  memory: ScopedMemory;
  graph: NbcChainGraph;
}) => Promise<{ generalNote: string; peerNote: string; modelCalls?: number; tokens?: TokenUsage }>;

export type RunEpisodeInput = {
  id: string;
  condition: string;
  initiatorDid: string;
  counterpartyDid: string;
  purpose: string;
  maxTurns: number;
  timeoutMs: number;
  memory: MarkdownMemoryStore;
  policyFor: (did: string) => NegotiationPolicy;
  reflect?: ReflectFn;
};

const emptyTokens = (): TokenUsage => ({ input: 0, output: 0, total: 0 });

function addTokens(a: TokenUsage, b: TokenUsage | undefined): TokenUsage {
  if (b === undefined) return a;
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    total: a.total + b.total,
  };
}

/** One bilateral NBC episode: open → snapshot → commit until terminal. */
export async function runEpisode(input: RunEpisodeInput): Promise<EpisodeRecord> {
  const started = Date.now();
  const client = createInMemoryObpPersistenceClient({
    validateBindPolicyAtExpose,
  });

  await client.registerParty({ id: input.initiatorDid, name: input.initiatorDid });
  await client.registerParty({ id: input.counterpartyDid, name: input.counterpartyDid });

  const memoryShown = {
    initiator: input.memory.readScoped(input.initiatorDid, input.counterpartyDid),
    counterparty: input.memory.readScoped(input.counterpartyDid, input.initiatorDid),
  };

  let turnsCompleted = 0;
  let modelCalls = 0;
  let tokens = emptyTokens();
  let outcome: EpisodeOutcome = "error";
  let error: string | undefined;
  let left = false;
  const deadline = Date.now() + input.timeoutMs;

  try {
    while (true) {
      if (Date.now() > deadline) {
        outcome = "timeout";
        break;
      }

      const graph = await collectNbcChainGraph(client);
      const act = nextActorDid(
        graph,
        input.initiatorDid,
        input.counterpartyDid,
        turnsCompleted,
        input.maxTurns,
        left,
      );
      if (act.reason !== "continue") {
        outcome = act.reason;
        if (act.reason === "error") error = "no bindable peer ports for next actor";
        break;
      }
      if (act.did === null) {
        outcome = "error";
        error = "missing actor";
        break;
      }

      const actorDid = act.did;
      const peerDid = actorDid === input.initiatorDid ? input.counterpartyDid : input.initiatorDid;
      const opening = graph.offers.length === 0;
      const peerPorts = availablePeerPorts(graph, actorDid);
      const scoped = input.memory.readScoped(actorDid, peerDid);
      const policy = input.policyFor(actorDid);
      const decision = await policy({
        actorDid,
        peerDid,
        purpose: input.purpose,
        memory: scoped,
        opening,
        peerPorts,
        graph,
        turnsCompleted,
        maxTurns: input.maxTurns,
      });
      modelCalls += decision.modelCalls ?? 0;
      tokens = addTokens(tokens, decision.tokens);

      const wired = negotiationOutputToWire({
        raw: decision.turn,
        opening,
        peerPorts,
      });
      if (wired.kind === "disconnect") {
        left = true;
        outcome = "left";
        break;
      }

      const body = parseNbcTurnBody(wired.body);
      await applyNbcTurn({
        partyId: actorDid,
        body,
        client,
        timing: { turnSeq: turnsCompleted },
        validateBindPayload: (bindPolicy, bindPayload) =>
          validateNbcBindPayloadForPort(bindPolicy, bindPayload) as JsonDocument,
      });
      turnsCompleted += 1;
    }
  } catch (err) {
    outcome = "error";
    error = err instanceof Error ? err.message : String(err);
  }

  const graph = await collectNbcChainGraph(client);
  if (outcome === "error" && graph.binds.length > 0) outcome = "bound";
  const signature = protocolSignature(graph, input.initiatorDid);
  const memoryDiffs: MemoryDiff[] = [];

  if (input.reflect !== undefined && (outcome === "bound" || outcome === "left")) {
    try {
      for (const actorDid of [input.initiatorDid, input.counterpartyDid]) {
        const peerDid =
          actorDid === input.initiatorDid ? input.counterpartyDid : input.initiatorDid;
        const before = input.memory.readScoped(actorDid, peerDid);
        const reflection = await input.reflect({
          actorDid,
          peerDid,
          purpose: input.purpose,
          outcome,
          protocolSignature: signature,
          memory: before,
          graph,
        });
        modelCalls += reflection.modelCalls ?? 0;
        tokens = addTokens(tokens, reflection.tokens);
        input.memory.appendGeneral(actorDid, reflection.generalNote);
        input.memory.appendPeer(actorDid, peerDid, reflection.peerNote);
        memoryDiffs.push({
          actorDid,
          generalAppend: reflection.generalNote.trim(),
          peerAppend: reflection.peerNote.trim(),
        });
      }
    } catch (err) {
      outcome = "error";
      error = `reflection failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return {
    id: input.id,
    condition: input.condition,
    initiatorDid: input.initiatorDid,
    counterpartyDid: input.counterpartyDid,
    purpose: input.purpose,
    outcome,
    offers: graph.offers.length,
    turns: turnsCompleted,
    modelCalls,
    tokens,
    wallMs: Date.now() - started,
    protocolSignature: signature,
    memoryDiffs,
    memoryShown,
    ...(error !== undefined ? { error } : {}),
    graph,
  };
}
