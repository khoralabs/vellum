import { homedir } from "node:os";
import path from "node:path";

import type { VellumAppConfigBase } from "./schema";

/** Default {@link VellumAppConfigBase.dataDir}: artifacts under `~/.vellum/data/vellum/channels/...`. */
export function vellumDefaultDataDir(): string {
  return path.join(homedir(), ".vellum", "data");
}

/** Lowest-priority layer: overridden by {@link vellumAppConfigFromEnv} and config files. */
export function vellumAppConfigBuiltinDefaults(): VellumAppConfigBase {
  return {
    dataDir: vellumDefaultDataDir(),
  };
}
