import type { FlagMap } from "@khoralabs/cli-kit";
import { strFlag } from "@khoralabs/cli-kit";
import {
  isPidAlive,
  readVellumControlFile,
  removeVellumControlFile,
  type VellumPathConfig,
} from "@khoralabs/vellum-client";

import { dataDirForEnv } from "../flows/context";

/** Stop local daemon if control file exists. Returns whether a control file was cleaned up. */
export function disconnectLocalChannel(flags: FlagMap, channelId: string): boolean {
  const cfg: VellumPathConfig = {
    dataDir: dataDirForEnv(flags),
  };
  const cp = readVellumControlFile(cfg, channelId);
  if (cp === undefined) {
    removeVellumControlFile(cfg, channelId);
    return false;
  }
  if (isPidAlive(cp.pid)) {
    try {
      process.kill(cp.pid, "SIGTERM");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ESRCH" && code !== "EPERM") throw e;
    }
  }
  removeVellumControlFile(cfg, channelId);
  return true;
}

export function handleDisconnect(positional: string[], flags: FlagMap): void {
  const channelId = positional[1]?.trim() ?? strFlag(flags, "channel")?.trim();
  if (channelId === undefined || channelId.length === 0) {
    throw new Error("channel id required");
  }
  if (!disconnectLocalChannel(flags, channelId)) {
    console.log("(no local daemon control file)");
    return;
  }
  console.log(`disconnected local daemon for channel ${channelId}`);
}
