#!/usr/bin/env bun
import { join } from "node:path";

import { runConventionExperiment } from "./experiment.ts";

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
  --model <id>       AI Gateway model id (required for live runs)
  --repeats <n>      A↔B repeats after baseline (default: 2)
  --max-turns <n>    Max NBC turns per episode (default: 6)
  --timeout-ms <n>   Episode wall timeout (default: 180000)
  --run-id <id>      Artifact folder name under .data/negotiation-lab/
  --purpose <text>   Override negotiation purpose
  --help             Show help

Requires AI_GATEWAY_API_KEY (loaded from repo-root .env by Bun).
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

  const repeats = Number(argValue(argv, "--repeats") ?? "2");
  const maxTurns = Number(argValue(argv, "--max-turns") ?? "6");
  const timeoutMs = Number(argValue(argv, "--timeout-ms") ?? "180000");
  const runId =
    argValue(argv, "--run-id") ??
    new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const purpose = argValue(argv, "--purpose");
  const rootDir = join(process.cwd(), ".data", "negotiation-lab");

  console.log(`Running convention experiment ${runId} with model=${model}`);
  const summary = await runConventionExperiment({
    runId,
    rootDir,
    model,
    ...(purpose !== undefined ? { purpose } : {}),
    repeats: Number.isFinite(repeats) ? Math.max(0, Math.floor(repeats)) : 2,
    maxTurns: Number.isFinite(maxTurns) ? Math.max(1, Math.floor(maxTurns)) : 6,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(1_000, Math.floor(timeoutMs)) : 180_000,
  });

  console.log(`Artifacts: ${join(rootDir, runId)}`);
  console.log(JSON.stringify(summary.metrics, null, 2));
  console.log(`Bind rate: ${summary.metrics.successfulBindRate}`);
}

await main();
