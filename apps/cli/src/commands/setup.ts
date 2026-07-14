import { existsSync } from "node:fs";
import path from "node:path";
import type { FlagMap } from "@khoralabs/cli-kit";
import { boolFlag, style, symbols } from "@khoralabs/cli-kit";

import {
  POSTINSTALL_SCHEMA_FILE,
  runVellumConfigSetup,
  type VellumSetupResult,
} from "../../scripts/postinstall";

const ASSETS_DIR_ENV = "VELLUM_CLI_ASSETS_DIR";

export type SetupAssets = {
  configsDir: string;
  schemaPath: string | undefined;
};

const SCHEMA_FILE = POSTINSTALL_SCHEMA_FILE;

/**
 * Locate canonical configs + schema for `vellum setup`.
 *
 * Published install: `VELLUM_CLI_ASSETS_DIR` points at the meta-package root (contains
 * `configs/` and `vellum-config.schema.json`).
 *
 * Monorepo: `apps/cli/assets/configs` and `packages/client/vellum-config.schema.json`.
 */
export function resolveSetupAssets(env: NodeJS.ProcessEnv = process.env): SetupAssets {
  const fromEnv = env[ASSETS_DIR_ENV]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    const schema = path.join(fromEnv, SCHEMA_FILE);
    return {
      configsDir: path.join(fromEnv, "configs"),
      schemaPath: existsSync(schema) ? schema : undefined,
    };
  }
  const pkgRoot = path.resolve(import.meta.dir, "../..");
  const schema = path.resolve(pkgRoot, "../../packages/client", SCHEMA_FILE);
  const schemaPath = existsSync(schema) ? schema : undefined;
  return {
    configsDir: path.join(pkgRoot, "assets", "configs"),
    schemaPath,
  };
}

export function printSetupSummary(result: VellumSetupResult): void {
  for (const name of result.copied) {
    console.log(`${symbols.success} wrote ${style.muted(name)}`);
  }
  for (const name of result.overwritten) {
    console.log(`${symbols.success} overwrote ${style.muted(name)}`);
  }
  for (const name of result.skipped) {
    console.log(
      `${symbols.warning} ${style.warn(`skipped ${name} (exists; use --force to overwrite)`)}`,
    );
  }
  if (result.schema === "copied") {
    console.log(`${symbols.success} wrote ${style.muted(SCHEMA_FILE)}`);
  } else if (result.schema === "overwritten") {
    console.log(`${symbols.success} overwrote ${style.muted(SCHEMA_FILE)}`);
  } else if (result.schema === "skipped") {
    console.log(
      `${symbols.warning} ${style.warn(`skipped ${SCHEMA_FILE} (exists; use --force to overwrite)`)}`,
    );
  } else {
    console.log(
      `${symbols.info} ${style.muted(`skipped ${SCHEMA_FILE} (source not found; run 'bun run --cwd packages/client build:schema' in dev)`)}`,
    );
  }
  console.log(`${symbols.info} ${style.muted(`at ${result.destDir}`)}`);
}

export async function runSetupCommand(flags: FlagMap): Promise<void> {
  const force = boolFlag(flags, "force", "f");
  const asJson = boolFlag(flags, "json");
  const assets = resolveSetupAssets();
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (home === undefined || home.length === 0) {
    throw new Error("HOME / USERPROFILE not set; cannot determine ~/.vellum location");
  }
  if (!existsSync(assets.configsDir)) {
    throw new Error(
      `setup: canonical configs directory not found at ${assets.configsDir} (set ${ASSETS_DIR_ENV} or run from a packaged install)`,
    );
  }
  const result = runVellumConfigSetup({
    configsDir: assets.configsDir,
    schemaPath: assets.schemaPath,
    home,
    force,
  });
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else printSetupSummary(result);
}

export function maybeBootstrapVellumHome(
  env: NodeJS.ProcessEnv = process.env,
  err: (line: string) => void = (line) => console.error(line),
): void {
  const fromEnv = env[ASSETS_DIR_ENV]?.trim();
  if (fromEnv === undefined || fromEnv.length === 0) return;
  const home = env.HOME ?? env.USERPROFILE;
  if (home === undefined || home.length === 0) return;
  const canary = path.join(home, ".vellum", "cli.config.json");
  if (existsSync(canary)) return;
  try {
    const assets = resolveSetupAssets(env);
    if (!existsSync(assets.configsDir)) return;
    runVellumConfigSetup({
      configsDir: assets.configsDir,
      schemaPath: assets.schemaPath,
      home,
      force: false,
    });
  } catch (e) {
    err(
      style.error(
        `vellum: first-run setup failed (${e instanceof Error ? e.message : String(e)}); run 'vellum setup' to retry`,
      ),
    );
  }
}
