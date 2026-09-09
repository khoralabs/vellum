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
import { availablePeerPorts } from "@khoralabs/obp-nbc/host";
import { fillPayloadFromBindPolicy } from "./bind-payload-fill.ts";
import { type DealValidityEvaluation, dealValidityEvaluation } from "./deal-validity.ts";
import { type AgreementResult, reconstructAgreement } from "./domain/itex-agreement.ts";
import type { ProfileId } from "./domain/itex-cypress.ts";
import { profileFor } from "./domain/itex-cypress.ts";
import type { MarkdownMemoryStore } from "./memory.ts";
import { domainContextFor } from "./policy.ts";
import { protocolSignature } from "./protocol-signature.ts";
import { labTurnToWire } from "./turn-wire.ts";
import type {
  EpisodeOutcome,
  EpisodeRecord,
  MemoryDiff,
  NegotiationPolicy,
  ScopedMemory,
  TokenUsage,
} from "./types.ts";

function hasTerminalBind(graph: NbcChainGraph): boolean {
  return graph.binds.some((bind) => {
    const port = graph.ports.find((p) => p.id === bind.portId);
    return port?.terminal === true;
  });
}

/** Bilateral ping-pong; only a terminal bind ends as bound. Expose-only turns are allowed. */
function nextActorDid(
  graph: NbcChainGraph,
  initiatorDid: string,
  counterpartyDid: string,
  turnsCompleted: number,
  maxTurns: number,
  left: boolean,
): { did: string | null; reason: EpisodeOutcome | "continue" } {
  if (left) return { did: null, reason: "left" };
  if (hasTerminalBind(graph)) return { did: null, reason: "bound" };
  if (turnsCompleted >= maxTurns) return { did: null, reason: "turn-limit" };
  if (graph.offers.length === 0) return { did: initiatorDid, reason: "continue" };
  const last = graph.offers[graph.offers.length - 1];
  if (last === undefined) return { did: initiatorDid, reason: "continue" };
  const next = last.partyId === initiatorDid ? counterpartyDid : initiatorDid;
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
  validityEvaluation: DealValidityEvaluation;
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
  roleForDid: (did: string) => ProfileId;
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

/** One bilateral NBC episode: open → snapshot → commit until terminal bind. */
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
  const experiencesShown = {
    initiator: input.memory.readScopedExperiences(input.initiatorDid, input.counterpartyDid),
    counterparty: input.memory.readScopedExperiences(input.counterpartyDid, input.initiatorDid),
  };

  let turnsCompleted = 0;
  let modelCalls = 0;
  let negotiationTokens = emptyTokens();
  let reflectionTokens = emptyTokens();
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
      const experiences = input.memory.readScopedExperiences(actorDid, peerDid);
      const policy = input.policyFor(actorDid);
      const decision = await policy({
        actorDid,
        peerDid,
        purpose: input.purpose,
        domain: domainContextFor(input.roleForDid(actorDid)),
        memory: scoped,
        experiences,
        opening,
        peerPorts,
        graph,
        turnsCompleted,
        maxTurns: input.maxTurns,
      });
      modelCalls += decision.modelCalls ?? 0;
      negotiationTokens = addTokens(negotiationTokens, decision.tokens);

      const wired = labTurnToWire(decision.turn);
      if (wired.kind === "disconnect") {
        left = true;
        outcome = "left";
        break;
      }

      const body = parseNbcTurnBody(wired.body);
      if (body.bind_port_id !== "") {
        const target = graph.ports.find((p) => p.id === body.bind_port_id);
        body.bind_payload = fillPayloadFromBindPolicy(target?.bind_policy, body.bind_payload);
      }
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
  if (outcome === "error" && hasTerminalBind(graph)) outcome = "bound";
  const signature = protocolSignature(graph, input.initiatorDid);
  const memoryDiffs: MemoryDiff[] = [];

  let agreement: AgreementResult | null = null;
  if (outcome === "bound" || hasTerminalBind(graph)) {
    agreement = reconstructAgreement(
      graph,
      input.roleForDid(input.initiatorDid),
      input.roleForDid(input.counterpartyDid),
    );
  }

  const evaluationFor = (actorDid: string): DealValidityEvaluation => {
    const viewerSide: "A" | "B" = actorDid === input.initiatorDid ? "A" : "B";
    return dealValidityEvaluation({
      episodeOutcome: outcome,
      agreement,
      viewerProfile: profileFor(input.roleForDid(actorDid)),
      viewerSide,
    });
  };

  const evaluations = {
    [input.initiatorDid]: evaluationFor(input.initiatorDid),
    [input.counterpartyDid]: evaluationFor(input.counterpartyDid),
  } as const;

  if (input.reflect !== undefined && (outcome === "bound" || outcome === "left")) {
    try {
      for (const actorDid of [input.initiatorDid, input.counterpartyDid]) {
        const peerDid =
          actorDid === input.initiatorDid ? input.counterpartyDid : input.initiatorDid;
        const before = input.memory.readScoped(actorDid, peerDid);
        const validityEvaluation = evaluations[actorDid];
        if (validityEvaluation === undefined) {
          throw new Error(`missing validity evaluation for ${actorDid}`);
        }
        const reflection = await input.reflect({
          actorDid,
          peerDid,
          purpose: input.purpose,
          outcome,
          protocolSignature: signature,
          memory: before,
          graph,
          validityEvaluation,
        });
        modelCalls += reflection.modelCalls ?? 0;
        reflectionTokens = addTokens(reflectionTokens, reflection.tokens);
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

  for (const actorDid of [input.initiatorDid, input.counterpartyDid]) {
    const peerDid = actorDid === input.initiatorDid ? input.counterpartyDid : input.initiatorDid;
    input.memory.appendExperience(actorDid, {
      episodeId: input.id,
      condition: input.condition,
      peerDid,
      role: actorDid === input.initiatorDid ? "initiator" : "counterparty",
      outcome,
      purpose: input.purpose,
      turns: turnsCompleted,
      protocolSignature: signature,
      graph,
      validityEvaluation: evaluations[actorDid],
    });
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
    tokens: {
      input: negotiationTokens.input + reflectionTokens.input,
      output: negotiationTokens.output + reflectionTokens.output,
      total: negotiationTokens.total + reflectionTokens.total,
    },
    negotiationTokens,
    reflectionTokens,
    wallMs: Date.now() - started,
    protocolSignature: signature,
    agreement,
    memoryDiffs,
    memoryShown,
    experiencesShown,
    ...(error !== undefined ? { error } : {}),
    graph,
  };
}
