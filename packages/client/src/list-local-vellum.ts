import fs from "node:fs";
import path from "node:path";

import { cfgDataDir, type VellumPathConfig, vellumStoreRoot } from "./contracts";

export type LocalVellumRow = {
  channelId: string;
  pid?: number;
  controlPort?: number;
  status: "running" | "stale" | "no-control-file" | "invalid-control-file";
};

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Inspect `vellum.json` under each `{vellumStoreRoot}/channels/*` directory (aligned with the daemon).
 */
export function listLocalVellumRows(
  cfg: VellumPathConfig,
  env: NodeJS.ProcessEnv = process.env,
): LocalVellumRow[] {
  const channelsRoot = path.join(vellumStoreRoot(cfgDataDir(cfg), env), "channels");
  let names: string[] = [];
  try {
    names = fs.readdirSync(channelsRoot);
  } catch {
    return [];
  }
  names.sort();
  const out: LocalVellumRow[] = [];
  for (const enc of names) {
    const sub = path.join(channelsRoot, enc);
    let st: fs.Stats;
    try {
      st = fs.statSync(sub);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    let channelId: string;
    try {
      channelId = decodeURIComponent(enc);
    } catch {
      continue;
    }

    const ctlPath = path.join(sub, "vellum.json");
    if (!fs.existsSync(ctlPath)) {
      out.push({ channelId, status: "no-control-file" });
      continue;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(ctlPath, "utf8");
    } catch {
      out.push({ channelId, status: "no-control-file" });
      continue;
    }
    let j: unknown;
    try {
      j = JSON.parse(raw) as unknown;
    } catch {
      out.push({ channelId, status: "invalid-control-file" });
      continue;
    }
    if (j === null || typeof j !== "object") {
      out.push({ channelId, status: "invalid-control-file" });
      continue;
    }
    const o = j as Record<string, unknown>;
    const pid = o.pid;
    const controlPort = o.controlPort;
    if (
      typeof pid !== "number" ||
      !Number.isFinite(pid) ||
      typeof controlPort !== "number" ||
      !Number.isFinite(controlPort)
    ) {
      out.push({ channelId, status: "invalid-control-file" });
      continue;
    }
    out.push({
      channelId,
      pid,
      controlPort,
      status: isPidAlive(pid) ? "running" : "stale",
    });
  }
  return out;
}
