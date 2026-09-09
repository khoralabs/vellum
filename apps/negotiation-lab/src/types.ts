import type { JsonDocument } from "@khoralabs/obp-core";
import type { NbcChainGraph } from "@khoralabs/obp-nbc";
import type { AvailablePeerPort } from "@khoralabs/obp-nbc/host";
import type { DealValidityEvaluation } from "./deal-validity.ts";
import type { AgreementResult } from "./domain/itex-agreement.ts";
import type { IssueDef, ProfileId, UtilityProfile } from "./domain/itex-cypress.ts";

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

/** Compact cross-peer index entry (no full graph). */
export type ExperienceIndexEntry = {
  episodeId: string;
  condition: string;
  peerDid: string;
  role: "initiator" | "counterparty";
  outcome: EpisodeOutcome;
  purpose: string;
  turns: number;
  protocolSignature: string;
  /** Oracle deal-validity evaluation when available (viewer-scoped). */
  validityEvaluation?: DealValidityEvaluation;
};

/** Full negotiation experience including terminal graph. */
export type NegotiationExperience = ExperienceIndexEntry & {
  graph: NbcChainGraph;
};

export type ScopedExperiences = {
  /** Every complete prior chain for this agent (including cross-peer). */
  chains: NegotiationExperience[];
  /** Recent compact index across peers. */
  recentIndex: ExperienceIndexEntry[];
};

export type OfferPortLibraryEntry = {
  fingerprint: string;
  kind: "offer" | "port" | "bound-peer-port";
  raw: Record<string, unknown>;
  episodeId: string;
  peerDid: string;
  role: "initiator" | "counterparty";
  outcome: EpisodeOutcome;
  authored: boolean;
  exposed: boolean;
  bound: boolean;
  useCount: number;
  firstEpisodeId: string;
  lastEpisodeId: string;
};

export type DomainContext = {
  publicIssues: readonly IssueDef[];
  profileId: ProfileId;
  profile: UtilityProfile;
};

export type PolicyContext = {
  actorDid: string;
  peerDid: string;
  purpose: string;
  domain: DomainContext;
  memory: ScopedMemory;
  experiences: ScopedExperiences;
  opening: boolean;
  peerPorts: readonly AvailablePeerPort[];
  graph: NbcChainGraph;
  turnsCompleted: number;
  maxTurns: number;
};

export type LabPortDef = {
  kind: string;
  promise: string;
  bind_policy?: JsonDocument | Record<string, unknown>;
  terminal?: boolean;
  max_bindings?: number;
  ref?: string;
  id?: string;
  expires_turn?: number;
  expires_at_ms?: number;
};

/** Raw NBC turn surface used by the lab (bind optional on continue). */
export type LabTurn =
  | { disconnect: true }
  | { expose: LabPortDef[] }
  | {
      bind: { portId: string; payload?: JsonDocument | Record<string, unknown> };
      expose?: LabPortDef[];
    };

export type PolicyResult = {
  turn: LabTurn;
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
  negotiationTokens: TokenUsage;
  reflectionTokens: TokenUsage;
  wallMs: number;
  protocolSignature: string;
  agreement: AgreementResult | null;
  memoryDiffs: MemoryDiff[];
  memoryShown: {
    initiator: ScopedMemory;
    counterparty: ScopedMemory;
  };
  experiencesShown: {
    initiator: ScopedExperiences;
    counterparty: ScopedExperiences;
  };
  error?: string;
  graph: NbcChainGraph;
};

export type ArmOrder = "memory-first" | "reset-first";

export type ConvergenceMetrics = {
  persistentAdjacentSimilarity: number | null;
  latePersistentSimilarity: number | null;
  resetAdjacentSimilarity: number | null;
  persistentMinusResetSimilarity: number | null;
  persistentTurnSlope: number | null;
  resetTurnSlope: number | null;
  persistentNegotiationTokenSlope: number | null;
  resetNegotiationTokenSlope: number | null;
  persistentLateTurns: number | null;
  resetLateTurns: number | null;
  persistentMinusResetLateTurnDelta: number | null;
  persistentLateThreeMeanTurns: number | null;
  resetLateThreeMeanTurns: number | null;
  persistentMinusResetLateThreeTurnDelta: number | null;
  persistentLateNegotiationTokens: number | null;
  resetLateNegotiationTokens: number | null;
  persistentMinusResetLateTokenDelta: number | null;
  trainedToLateAbSimilarity: number | null;
  freshToLateAbSimilarity: number | null;
  trainedMinusFreshTransferSimilarity: number | null;
  persistentAgreementRate: number;
  resetAgreementRate: number;
  overallAgreementRate: number;
  persistentBindRate: number;
  resetBindRate: number;
  overallBindRate: number;
  persistentMedianUtilityManufacturer: number | null;
  persistentMedianUtilityBuyer: number | null;
  resetMedianUtilityManufacturer: number | null;
  resetMedianUtilityBuyer: number | null;
  libraryReuseRatePersistentA: number | null;
  libraryReuseRatePersistentB: number | null;
};

export type ExperimentSummary = {
  runId: string;
  model: string;
  purpose: string;
  domain: "itex-cypress";
  repeats: number;
  maxTurns: number;
  armOrder: ArmOrder;
  episodes: EpisodeRecord[];
  metrics: ConvergenceMetrics;
};
