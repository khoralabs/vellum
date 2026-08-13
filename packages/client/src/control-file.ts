import fs from "node:fs";
import path from "node:path";

import { cfgDataDir, channelVellumControlPath, type VellumPathConfig } from "./contracts";

export type VellumControlFile = {
  pid: number;
  controlPort: number;
  channelId: string;
  lastBlobId?: number;
};

export function vellumControlPath(
  cfg: VellumPathConfig,
  channelId: string,
  env?: NodeJS.ProcessEnv,
): string {
  return channelVellumControlPath(cfgDataDir(cfg), channelId, env);
}

export function writeVellumControlFile(
  cfg: VellumPathConfig,
  channelId: string,
  state: VellumControlFile,
): void {
  const p = vellumControlPath(cfg, channelId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(state satisfies VellumControlFile)}\n`, "utf8");
}

/** Best-effort remove `vellum.json`. */
export function removeVellumControlFile(cfg: VellumPathConfig, channelId: string): void {
  try {
    fs.unlinkSync(vellumControlPath(cfg, channelId));
  } catch {
    // ignore
  }
}

/** Read `{ pid, controlPort, channelId }` written by the session runner. */
export function readVellumControlFile(
  cfg: VellumPathConfig,
  channelId: string,
): VellumControlFile | undefined {
  try {
    const raw = fs.readFileSync(vellumControlPath(cfg, channelId), "utf8");
    const j = JSON.parse(raw) as unknown;
    if (j !== null && typeof j === "object") {
      const o = j as Record<string, unknown>;
      const pid = o.pid;
      const controlPort = o.controlPort;
      if (
        typeof pid === "number" &&
        Number.isFinite(pid) &&
        typeof controlPort === "number" &&
        Number.isFinite(controlPort)
      ) {
        return {
          pid,
          controlPort,
          channelId: typeof o.channelId === "string" ? o.channelId : channelId,
          ...(typeof o.lastBlobId === "number" && Number.isFinite(o.lastBlobId)
            ? { lastBlobId: o.lastBlobId }
            : {}),
        };
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}
