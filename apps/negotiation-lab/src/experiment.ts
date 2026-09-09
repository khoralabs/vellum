import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ProfileId } from "./domain/itex-cypress.ts";
import { type ReflectFn, runEpisode } from "./episode-runner.ts";
import { libraryReuseRate } from "./library.ts";
import { MarkdownMemoryStore } from "./memory.ts";
import { createAiPolicy, createAiReflect, defaultPurpose } from "./policy.ts";
import { meanAdjacentSimilarity, protocolSimilarity, slope } from "./protocol-signature.ts";
import {
  AGENT_A,
  AGENT_B,
  AGENT_C,
  type ArmOrder,
  type ConvergenceMetrics,
  type EpisodeRecord,
  type ExperimentSummary,
  type NegotiationPolicy,
} from "./types.ts";

export type ExperimentOptions = {
  runId: string;
  rootDir: string;
  model: string;
  purpose?: string;
  repeats?: number;
  maxTurns?: number;
  timeoutMs?: number;
  armOrder?: ArmOrder;
  policy?: NegotiationPolicy;
  reflect?: ReflectFn;
  /** Skip live reflection when using a shared non-AI policy. */
  reflectEnabled?: boolean;
};

const ROLE_MAP: Record<string, ProfileId> = {
  [AGENT_A]: "manufacturer",
  [AGENT_B]: "buyer",
  [AGENT_C]: "buyer_transfer",
};

export function defaultRoleForDid(did: string): ProfileId {
  const role = ROLE_MAP[did];
  if (role === undefined) throw new Error(`no role for ${did}`);
  return role;
}

function bindRate(episodes: readonly EpisodeRecord[]): number {
  if (episodes.length === 0) return 0;
  return episodes.filter((e) => e.outcome === "bound").length / episodes.length;
}

function agreementRate(episodes: readonly EpisodeRecord[]): number {
  if (episodes.length === 0) return 0;
  return episodes.filter((e) => e.agreement?.status === "valid").length / episodes.length;
}

function latePairSimilarity(episodes: readonly EpisodeRecord[]): number | null {
  if (episodes.length < 2) return null;
  const a = episodes[episodes.length - 2];
  const b = episodes[episodes.length - 1];
  if (a === undefined || b === undefined) return null;
  return protocolSimilarity(a.graph, b.graph, b.initiatorDid);
}

function meanTurns(episodes: readonly EpisodeRecord[]): number | null {
  if (episodes.length === 0) return null;
  return episodes.reduce((s, e) => s + e.turns, 0) / episodes.length;
}

function lateThree(episodes: readonly EpisodeRecord[]): EpisodeRecord[] {
  return episodes.slice(-3);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const a = sorted[mid - 1];
  const b = sorted[mid];
  if (a === undefined || b === undefined) return null;
  return (a + b) / 2;
}

function validUtilities(
  episodes: readonly EpisodeRecord[],
  side: "utilityA" | "utilityB",
): number[] {
  return episodes
    .map((e) => e.agreement?.score?.[side])
    .filter((u): u is number => typeof u === "number");
}

export function computeConvergenceMetrics(
  episodes: readonly EpisodeRecord[],
  libraries?: { persistentA?: number; persistentB?: number },
): ConvergenceMetrics {
  const persistent = episodes.filter(
    (e) =>
      e.condition === "ab-persistent-baseline" || e.condition.startsWith("ab-persistent-repeat-"),
  );
  const reset = episodes.filter((e) => e.condition.startsWith("ab-reset-"));
  const trained = episodes.find((e) => e.condition === "ac-trained");
  const fresh = episodes.find((e) => e.condition === "ac-fresh-control");
  const latePersistent = persistent.length >= 1 ? persistent[persistent.length - 1] : undefined;
  const lateReset = reset.length >= 1 ? reset[reset.length - 1] : undefined;
  const latePersistentThree = lateThree(persistent);
  const lateResetThree = lateThree(reset);

  const latePersistentSimilarity = latePairSimilarity(persistent);
  const resetAdjacentSimilarity = meanAdjacentSimilarity(reset);
  const persistentAdjacentSimilarity = meanAdjacentSimilarity(persistent);

  const trainedToLate =
    trained !== undefined && latePersistent !== undefined
      ? protocolSimilarity(trained.graph, latePersistent.graph, trained.initiatorDid)
      : null;
  const freshToLate =
    fresh !== undefined && latePersistent !== undefined
      ? protocolSimilarity(fresh.graph, latePersistent.graph, fresh.initiatorDid)
      : null;

  const persistentLateThreeMeanTurns = meanTurns(latePersistentThree);
  const resetLateThreeMeanTurns = meanTurns(lateResetThree);

  return {
    persistentAdjacentSimilarity,
    latePersistentSimilarity,
    resetAdjacentSimilarity,
    persistentMinusResetSimilarity:
      latePersistentSimilarity !== null && resetAdjacentSimilarity !== null
        ? latePersistentSimilarity - resetAdjacentSimilarity
        : null,
    persistentTurnSlope: slope(persistent.map((e) => e.turns)),
    resetTurnSlope: slope(reset.map((e) => e.turns)),
    persistentNegotiationTokenSlope: slope(persistent.map((e) => e.negotiationTokens.total)),
    resetNegotiationTokenSlope: slope(reset.map((e) => e.negotiationTokens.total)),
    persistentLateTurns: latePersistent?.turns ?? null,
    resetLateTurns: lateReset?.turns ?? null,
    persistentMinusResetLateTurnDelta:
      latePersistent !== undefined && lateReset !== undefined
        ? latePersistent.turns - lateReset.turns
        : null,
    persistentLateThreeMeanTurns,
    resetLateThreeMeanTurns,
    persistentMinusResetLateThreeTurnDelta:
      persistentLateThreeMeanTurns !== null && resetLateThreeMeanTurns !== null
        ? persistentLateThreeMeanTurns - resetLateThreeMeanTurns
        : null,
    persistentLateNegotiationTokens: latePersistent?.negotiationTokens.total ?? null,
    resetLateNegotiationTokens: lateReset?.negotiationTokens.total ?? null,
    persistentMinusResetLateTokenDelta:
      latePersistent !== undefined && lateReset !== undefined
        ? latePersistent.negotiationTokens.total - lateReset.negotiationTokens.total
        : null,
    trainedToLateAbSimilarity: trainedToLate,
    freshToLateAbSimilarity: freshToLate,
    trainedMinusFreshTransferSimilarity:
      trainedToLate !== null && freshToLate !== null ? trainedToLate - freshToLate : null,
    persistentAgreementRate: agreementRate(persistent),
    resetAgreementRate: agreementRate(reset),
    overallAgreementRate: agreementRate(episodes),
    persistentBindRate: bindRate(persistent),
    resetBindRate: bindRate(reset),
    overallBindRate: bindRate(episodes),
    persistentMedianUtilityManufacturer: median(validUtilities(persistent, "utilityA")),
    persistentMedianUtilityBuyer: median(validUtilities(persistent, "utilityB")),
    resetMedianUtilityManufacturer: median(validUtilities(reset, "utilityA")),
    resetMedianUtilityBuyer: median(validUtilities(reset, "utilityB")),
    libraryReuseRatePersistentA: libraries?.persistentA ?? null,
    libraryReuseRatePersistentB: libraries?.persistentB ?? null,
  };
}

function writeArtifacts(
  dir: string,
  summary: ExperimentSummary,
  episodes: EpisodeRecord[],
  stores: {
    persistent: MarkdownMemoryStore;
    reset: MarkdownMemoryStore;
    fresh: MarkdownMemoryStore;
  },
): void {
  mkdirSync(dir, { recursive: true });
  const jsonl = join(dir, "episodes.jsonl");
  writeFileSync(jsonl, `${episodes.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  for (const [arm, store] of Object.entries(stores) as [string, MarkdownMemoryStore][]) {
    for (const did of [AGENT_A, AGENT_B, AGENT_C]) {
      const lib = store.readLibrary(did);
      if (lib.length === 0) continue;
      const out = join(dir, "libraries", arm, `${encodeURIComponent(did)}.json`);
      mkdirSync(join(dir, "libraries", arm), { recursive: true });
      writeFileSync(out, `${JSON.stringify(lib, null, 2)}\n`, "utf8");
    }
  }

  const m = summary.metrics;
  const fmt = (v: number | null) => (v === null ? "n/a" : v.toFixed(3));
  const md = [
    `# Itex–Cypress OBP benchmark \`${summary.runId}\``,
    "",
    `- Model: \`${summary.model}\``,
    `- Domain: \`${summary.domain}\``,
    `- Purpose: ${summary.purpose}`,
    `- Arm order: ${summary.armOrder}`,
    `- Repeats after baseline: ${summary.repeats}`,
    `- Max turns: ${summary.maxTurns}`,
    "",
    "## Turn-first metrics (single run — not statistical significance)",
    "",
    `- Overall valid-agreement rate: ${m.overallAgreementRate.toFixed(3)}`,
    `- Persistent agreement rate: ${m.persistentAgreementRate.toFixed(3)}`,
    `- Reset agreement rate: ${m.resetAgreementRate.toFixed(3)}`,
    `- Persistent turn slope: ${fmt(m.persistentTurnSlope)}`,
    `- Reset turn slope: ${fmt(m.resetTurnSlope)}`,
    `- Late-three mean turns (persistent): ${fmt(m.persistentLateThreeMeanTurns)}`,
    `- Late-three mean turns (reset): ${fmt(m.resetLateThreeMeanTurns)}`,
    `- Late-three turn delta (persistent − reset): ${fmt(m.persistentMinusResetLateThreeTurnDelta)}`,
    `- Median utility manufacturer (persistent / reset): ${fmt(m.persistentMedianUtilityManufacturer)} / ${fmt(m.resetMedianUtilityManufacturer)}`,
    `- Median utility buyer (persistent / reset): ${fmt(m.persistentMedianUtilityBuyer)} / ${fmt(m.resetMedianUtilityBuyer)}`,
    `- Library reuse A/B (persistent): ${fmt(m.libraryReuseRatePersistentA)} / ${fmt(m.libraryReuseRatePersistentB)}`,
    `- Late persistent similarity: ${fmt(m.latePersistentSimilarity)}`,
    `- Transfer similarity delta (trained − fresh): ${fmt(m.trainedMinusFreshTransferSimilarity)}`,
    "",
    "## Episodes",
    "",
    ...episodes.map((e) => {
      const agr =
        e.agreement === null
          ? "n/a"
          : `${e.agreement.status}${e.agreement.score ? ` uA=${e.agreement.score.utilityA.toFixed(3)} uB=${e.agreement.score.utilityB.toFixed(3)}` : ""}`;
      return `- \`${e.id}\` (${e.condition}): outcome=${e.outcome} turns=${e.turns} agreement=${agr} negTok=${e.negotiationTokens.total} sig=\`${e.protocolSignature}\``;
    }),
    "",
  ].join("\n");
  writeFileSync(join(dir, "summary.md"), md, "utf8");
}

async function runPersistentArm(input: {
  repeats: number;
  run: (
    id: string,
    condition: string,
    initiatorDid: string,
    counterpartyDid: string,
    memory: MarkdownMemoryStore,
  ) => Promise<EpisodeRecord>;
  memory: MarkdownMemoryStore;
}): Promise<void> {
  await input.run(
    "ab-persistent-baseline",
    "ab-persistent-baseline",
    AGENT_A,
    AGENT_B,
    input.memory,
  );
  for (let i = 1; i <= input.repeats; i++) {
    await input.run(
      `ab-persistent-repeat-${i}`,
      `ab-persistent-repeat-${i}`,
      AGENT_A,
      AGENT_B,
      input.memory,
    );
  }
  await input.run("ac-trained", "ac-trained", AGENT_A, AGENT_C, input.memory);
}

async function runResetArm(input: {
  repeats: number;
  run: (
    id: string,
    condition: string,
    initiatorDid: string,
    counterpartyDid: string,
    memory: MarkdownMemoryStore,
  ) => Promise<EpisodeRecord>;
  memory: MarkdownMemoryStore;
}): Promise<void> {
  const total = input.repeats + 1;
  for (let i = 1; i <= total; i++) {
    input.memory.resetAgent(AGENT_A);
    input.memory.resetAgent(AGENT_B);
    await input.run(`ab-reset-${i}`, `ab-reset-${i}`, AGENT_A, AGENT_B, input.memory);
  }
}

async function runFreshTransfer(input: {
  run: (
    id: string,
    condition: string,
    initiatorDid: string,
    counterpartyDid: string,
    memory: MarkdownMemoryStore,
  ) => Promise<EpisodeRecord>;
  memory: MarkdownMemoryStore;
}): Promise<void> {
  input.memory.resetAgent(AGENT_A);
  input.memory.resetAgent(AGENT_C);
  await input.run("ac-fresh-control", "ac-fresh-control", AGENT_A, AGENT_C, input.memory);
}

/** Matched persistent vs reset A↔B arms plus transfer controls on Itex–Cypress. */
export async function runConventionExperiment(opts: ExperimentOptions): Promise<ExperimentSummary> {
  const purpose = opts.purpose ?? defaultPurpose();
  const repeats = opts.repeats ?? 5;
  const maxTurns = opts.maxTurns ?? 12;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const armOrder: ArmOrder = opts.armOrder ?? "memory-first";
  const runDir = join(opts.rootDir, opts.runId);
  mkdirSync(runDir, { recursive: true });

  const persistentMemory = new MarkdownMemoryStore(join(runDir, "arms", "persistent"));
  const resetMemory = new MarkdownMemoryStore(join(runDir, "arms", "reset"));
  const freshMemory = new MarkdownMemoryStore(join(runDir, "arms", "fresh"));
  persistentMemory.resetAll();
  resetMemory.resetAll();
  freshMemory.resetAll();

  const policy = opts.policy ?? createAiPolicy(opts.model);
  const reflect: ReflectFn | undefined =
    opts.reflectEnabled === false ? undefined : (opts.reflect ?? createAiReflect(opts.model));

  const policyFor = (_did: string): NegotiationPolicy => policy;
  const episodes: EpisodeRecord[] = [];

  const run = async (
    id: string,
    condition: string,
    initiatorDid: string,
    counterpartyDid: string,
    memory: MarkdownMemoryStore,
  ) => {
    const episode = await runEpisode({
      id,
      condition,
      initiatorDid,
      counterpartyDid,
      purpose,
      maxTurns,
      timeoutMs,
      memory,
      policyFor,
      roleForDid: defaultRoleForDid,
      reflect,
    });
    episodes.push(episode);
    return episode;
  };

  if (armOrder === "memory-first") {
    await runPersistentArm({ repeats, run, memory: persistentMemory });
    await runResetArm({ repeats, run, memory: resetMemory });
  } else {
    await runResetArm({ repeats, run, memory: resetMemory });
    await runPersistentArm({ repeats, run, memory: persistentMemory });
  }
  await runFreshTransfer({ run, memory: freshMemory });

  const metrics = computeConvergenceMetrics(episodes, {
    persistentA: libraryReuseRate(persistentMemory.readLibrary(AGENT_A)),
    persistentB: libraryReuseRate(persistentMemory.readLibrary(AGENT_B)),
  });
  const summary: ExperimentSummary = {
    runId: opts.runId,
    model: opts.model,
    purpose,
    domain: "itex-cypress",
    repeats,
    maxTurns,
    armOrder,
    episodes,
    metrics,
  };
  writeArtifacts(runDir, summary, episodes, {
    persistent: persistentMemory,
    reset: resetMemory,
    fresh: freshMemory,
  });
  return summary;
}
