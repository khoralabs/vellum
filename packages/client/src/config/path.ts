import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function defaultVellumCliConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  return path.join(home, ".vellum", "cli.config.json");
}

export function defaultVellumDaemonConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  return path.join(home, ".vellum", "daemon.config.json");
}

export type ResolvedVellumConfigPath = {
  path: string;
  explicit: boolean;
};

export function resolveVellumConfigPath(
  opts: {
    flag?: string;
    env?: NodeJS.ProcessEnv;
    defaultPaths?: readonly string[];
    fsExists?: (p: string) => boolean;
  } = {},
): ResolvedVellumConfigPath | undefined {
  const flag = opts.flag?.trim();
  if (flag !== undefined && flag.length > 0) return { path: flag, explicit: true };
  const envVal = opts.env?.VELLUM_CONFIG?.trim();
  if (envVal !== undefined && envVal.length > 0) return { path: envVal, explicit: true };
  const exists = opts.fsExists ?? existsSync;
  const candidates = opts.defaultPaths ?? [defaultVellumCliConfigPath(opts.env)];
  for (const candidate of candidates) {
    if (exists(candidate)) return { path: candidate, explicit: false };
  }
  return undefined;
}
