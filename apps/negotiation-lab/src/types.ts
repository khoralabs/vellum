import type { NbcChainGraph } from "@khoralabs/obp-nbc";
import type { AvailablePeerPort, NegotiationTurnEnvelope } from "@khoralabs/obp-nbc/host";

export const AGENT_A = "did:lab:a";
export const AGENT_B = "did:lab:b";
export const AGENT_C = "did:lab:c";

export type TokenUsage = {
  input: number;
  output: number;
  total: number;
};

export type EpisodeOutcome = "bound" | "left" | "turn-limit" | "timeout" | "error";

export type ScopedMemory = {
  general: string;
  peer: string;
};

export type PolicyContext = {
  actorDid: string;
  peerDid: string;
  purpose: string;
  memory: ScopedMemory;
  opening: boolean;
  peerPorts: readonly AvailablePeerPort[];
  graph: NbcChainGraph;
  turnsCompleted: number;
  maxTurns: number;
};

export type PolicyResult = {
  turn: NegotiationTurnEnvelope;
  modelCalls?: number;
  tokens?: TokenUsage;
};

export type NegotiationPolicy = (ctx: PolicyContext) => Promise<PolicyResult>;

export type MemoryDiff = {
  actorDid: string;
  generalAppend: string;
  peerAppend: string;
};

export type EpisodeRecord = {
  id: string;
  condition: string;
  initiatorDid: string;
  counterpartyDid: string;
  purpose: string;
  outcome: EpisodeOutcome;
  offers: number;
  turns: number;
  modelCalls: number;
  tokens: TokenUsage;
  wallMs: number;
  protocolSignature: string;
  memoryDiffs: MemoryDiff[];
  memoryShown: {
    initiator: ScopedMemory;
    counterparty: ScopedMemory;
  };
  error?: string;
  graph: NbcChainGraph;
};

export type ExperimentSummary = {
  runId: string;
  model: string;
  purpose: string;
  repeats: number;
  maxTurns: number;
  episodes: EpisodeRecord[];
  metrics: {
    abTurnTrend: number[];
    abTokenTrend: number[];
    abSignatureStability: number;
    successfulBindRate: number;
    trainedAcTurns: number | null;
    freshAcTurns: number | null;
    trainedVsFreshAcTurnDelta: number | null;
    trainedAcTokens: number | null;
    freshAcTokens: number | null;
  };
};
