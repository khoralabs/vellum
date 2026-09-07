import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type ReflectFn, runEpisode } from "./episode-runner.ts";
import { MarkdownMemoryStore } from "./memory.ts";
import { createAiPolicy, createAiReflect, defaultPurpose } from "./policy.ts";
import { signatureStability } from "./protocol-signature.ts";
import {
  AGENT_A,
  AGENT_B,
  AGENT_C,
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
  policy?: NegotiationPolicy;
  reflect?: ReflectFn;
  /** Skip live reflection when using a shared non-AI policy. */
  reflectEnabled?: boolean;
};

function summarize(
  runId: string,
  model: string,
  purpose: string,
  repeats: number,
  maxTurns: number,
  episodes: EpisodeRecord[],
): ExperimentSummary {
  const ab = episodes.filter(
    (e) => e.condition === "ab-baseline" || e.condition.startsWith("ab-repeat-"),
  );
  const trained = episodes.find((e) => e.condition === "ac-trained");
  const fresh = episodes.find((e) => e.condition === "ac-fresh-control");
  const binds = episodes.filter((e) => e.outcome === "bound").length;
  return {
    runId,
    model,
    purpose,
    repeats,
    maxTurns,
    episodes,
    metrics: {
      abTurnTrend: ab.map((e) => e.turns),
      abTokenTrend: ab.map((e) => e.tokens.total),
      abSignatureStability: signatureStability(ab.map((e) => e.protocolSignature)),
      successfulBindRate: episodes.length === 0 ? 0 : binds / episodes.length,
      trainedAcTurns: trained?.turns ?? null,
      freshAcTurns: fresh?.turns ?? null,
      trainedVsFreshAcTurnDelta:
        trained !== undefined && fresh !== undefined ? trained.turns - fresh.turns : null,
      trainedAcTokens: trained?.tokens.total ?? null,
      freshAcTokens: fresh?.tokens.total ?? null,
    },
  };
}

function writeArtifacts(dir: string, summary: ExperimentSummary, episodes: EpisodeRecord[]): void {
  mkdirSync(dir, { recursive: true });
  const jsonl = join(dir, "episodes.jsonl");
  writeFileSync(jsonl, `${episodes.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
  writeFileSync(join(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const m = summary.metrics;
  const md = [
    `# Negotiation convention run \`${summary.runId}\``,
    "",
    `- Model: \`${summary.model}\``,
    `- Purpose: ${summary.purpose}`,
    `- Repeats after baseline: ${summary.repeats}`,
    `- Max turns: ${summary.maxTurns}`,
    "",
    "## Metrics (single run — not statistical convergence)",
    "",
    `- A↔B turn trend: ${JSON.stringify(m.abTurnTrend)}`,
    `- A↔B token trend: ${JSON.stringify(m.abTokenTrend)}`,
    `- A↔B signature stability: ${m.abSignatureStability.toFixed(3)}`,
    `- Successful bind rate: ${m.successfulBindRate.toFixed(3)}`,
    `- Trained A↔C turns: ${m.trainedAcTurns ?? "n/a"}`,
    `- Fresh A↔C turns: ${m.freshAcTurns ?? "n/a"}`,
    `- Trained − fresh A↔C turn delta: ${m.trainedVsFreshAcTurnDelta ?? "n/a"}`,
    "",
    "## Episodes",
    "",
    ...episodes.map(
      (e) =>
        `- \`${e.id}\` (${e.condition}): outcome=${e.outcome} turns=${e.turns} tokens=${e.tokens.total} sig=\`${e.protocolSignature}\``,
    ),
    "",
  ].join("\n");
  writeFileSync(join(dir, "summary.md"), md, "utf8");
}

/** Baseline A↔B, repeats, trained A↔C, then memory-reset / fresh controls. */
export async function runConventionExperiment(opts: ExperimentOptions): Promise<ExperimentSummary> {
  const purpose = opts.purpose ?? defaultPurpose();
  const repeats = opts.repeats ?? 2;
  const maxTurns = opts.maxTurns ?? 6;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const runDir = join(opts.rootDir, opts.runId);
  const memory = new MarkdownMemoryStore(runDir);
  memory.resetAll();

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
      reflect,
    });
    episodes.push(episode);
    return episode;
  };

  await run("ab-baseline", "ab-baseline", AGENT_A, AGENT_B);
  for (let i = 1; i <= repeats; i++) {
    await run(`ab-repeat-${i}`, `ab-repeat-${i}`, AGENT_A, AGENT_B);
  }

  // Cross-peer transfer: A keeps general.md; peers/B.md is withheld by readScoped(A,C).
  await run("ac-trained", "ac-trained", AGENT_A, AGENT_C);

  memory.resetAgent(AGENT_A);
  memory.resetAgent(AGENT_B);
  await run("ab-reset-control", "ab-reset-control", AGENT_A, AGENT_B);

  memory.resetAgent(AGENT_A);
  memory.resetAgent(AGENT_C);
  await run("ac-fresh-control", "ac-fresh-control", AGENT_A, AGENT_C);

  const summary = summarize(opts.runId, opts.model, purpose, repeats, maxTurns, episodes);
  writeArtifacts(runDir, summary, episodes);
  return summary;
}
