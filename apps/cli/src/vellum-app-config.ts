import { homedir } from "node:os";
import path from "node:path";

import type { FlagMap } from "@khoralabs/cli-kit";
import { strFlag } from "@khoralabs/cli-kit";
import {
  loadVellumAppConfig,
  resolveVellumConfigPath,
  type VellumAppConfigBase,
  vellumAppConfigBuiltinDefaults,
  vellumAppConfigFromEnv,
  zVellumAppConfigBase,
} from "@khoralabs/vellum-client";

function vellumCliDefaultConfigPaths(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  return [path.join(home, ".vellum", "cli.config.json")];
}

export function vellumCliResolvedConfig(
  flags: FlagMap,
  env: NodeJS.ProcessEnv = process.env,
): VellumAppConfigBase {
  const resolved = resolveVellumConfigPath({
    flag: strFlag(flags, "config"),
    env,
    defaultPaths: vellumCliDefaultConfigPaths(env),
  });
  const { config } = loadVellumAppConfig({
    schema: zVellumAppConfigBase,
    layers: [vellumAppConfigBuiltinDefaults(), vellumAppConfigFromEnv(env)],
    filePath: resolved?.path ?? null,
    filePathExplicit: resolved?.explicit ?? false,
  });
  return config;
}
