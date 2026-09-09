#!/usr/bin/env bun
import { join } from "node:path";

import { runConventionExperiment } from "./experiment.ts";
import type { ArmOrder } from "./types.ts";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  return argv[i + 1];
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function usage(): never {
  console.error(`Usage: bun run apps/negotiation-lab/src/cli.ts --model <id> [options]

Options:
  --model <id>                 AI Gateway model id (required for live runs)
  --domain itex-cypress        Domain id (only itex-cypress is supported)
  --repeats <n>                A↔B repeats after baseline (default: 5)
  --max-turns <n>              Max NBC turns per episode (default: 12)
  --timeout-ms <n>             Episode wall timeout (default: 180000)
  --arm-order <order>          memory-first | reset-first (default: memory-first)
  --run-id <id>                Artifact folder name under .data/negotiation-lab/
  --purpose <text>             Override negotiation purpose
  --help                       Show help

Requires AI_GATEWAY_API_KEY (loaded from repo-root .env by Bun).
Live study episodes and reflections use paid AI Gateway calls; keep them out of CI.
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) usage();

  const model = argValue(argv, "--model") ?? process.env.AGENT_DEFAULT_MODEL?.trim();
  if (model === undefined || model.length === 0) {
    console.error("Missing --model (or AGENT_DEFAULT_MODEL).");
    usage();
  }
  if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
    console.error("AI_GATEWAY_API_KEY is not set.");
    process.exit(1);
  }

  const domain = argValue(argv, "--domain") ?? "itex-cypress";
  if (domain !== "itex-cypress") {
    console.error("--domain must be itex-cypress");
    process.exit(1);
  }

  const repeats = Number(argValue(argv, "--repeats") ?? "5");
  const maxTurns = Number(argValue(argv, "--max-turns") ?? "12");
  const timeoutMs = Number(argValue(argv, "--timeout-ms") ?? "180000");
  const armOrderRaw = argValue(argv, "--arm-order") ?? "memory-first";
  if (armOrderRaw !== "memory-first" && armOrderRaw !== "reset-first") {
    console.error("--arm-order must be memory-first or reset-first");
    process.exit(1);
  }
  const armOrder = armOrderRaw as ArmOrder;
  const runId =
    argValue(argv, "--run-id") ??
    new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const purpose = argValue(argv, "--purpose");
  const rootDir = join(process.cwd(), ".data", "negotiation-lab");

  console.log(`Running Itex–Cypress OBP benchmark ${runId} model=${model} arm-order=${armOrder}`);
  const summary = await runConventionExperiment({
    runId,
    rootDir,
    model,
    armOrder,
    ...(purpose !== undefined ? { purpose } : {}),
    repeats: Number.isFinite(repeats) ? Math.max(0, Math.floor(repeats)) : 5,
    maxTurns: Number.isFinite(maxTurns) ? Math.max(1, Math.floor(maxTurns)) : 12,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(1_000, Math.floor(timeoutMs)) : 180_000,
  });

  console.log(`Artifacts: ${join(rootDir, runId)}`);
  console.log(JSON.stringify(summary.metrics, null, 2));
  console.log(`Overall agreement rate: ${summary.metrics.overallAgreementRate}`);
  console.log(
    `Late-three turn delta (persistent − reset): ${summary.metrics.persistentMinusResetLateThreeTurnDelta}`,
  );
}

await main();
