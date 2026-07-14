import path from "node:path";

/** Channel storage layout: `${dataDir}/vellum/...` unless `VELLUM_STORE_ROOT` overrides. */
export type VellumPathConfig = {
  dataDir?: string | undefined;
};

export function cfgDataDir(cfg: VellumPathConfig): string | undefined {
  const d = cfg.dataDir?.trim();
  return d !== undefined && d.length > 0 ? d : undefined;
}

/** Filesystem-safe segment for `channelId`. */
export function encodeChannelIdForPath(channelId: string): string {
  return encodeURIComponent(channelId);
}

/** `<dataDir>/vellum` (default data dir `~/.vellum/data`) or `VELLUM_STORE_ROOT`. */
export function vellumStoreRoot(
  dataDir: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const storeOverride = env.VELLUM_STORE_ROOT?.trim();
  if (storeOverride !== undefined && storeOverride.length > 0) return path.resolve(storeOverride);
  const home = env.HOME ?? env.USERPROFILE ?? "";
  const root =
    home.length > 0
      ? path.join(home, ".vellum", "data")
      : path.join(process.cwd(), ".vellum", "data");
  const base = dataDir?.trim()?.length ? path.resolve(dataDir.trim()) : root;
  return path.join(base, "vellum");
}

export function channelDir(
  dataDir: string | undefined,
  channelId: string,
  env?: NodeJS.ProcessEnv,
): string {
  const enc = encodeChannelIdForPath(channelId);
  return path.join(vellumStoreRoot(dataDir, env), "channels", enc);
}

export function channelSqlitePath(
  dataDir: string | undefined,
  channelId: string,
  env?: NodeJS.ProcessEnv,
): string {
  return path.join(channelDir(dataDir, channelId, env), "obp.sqlite");
}

export function channelVellumControlPath(
  dataDir: string | undefined,
  channelId: string,
  env?: NodeJS.ProcessEnv,
): string {
  return path.join(channelDir(dataDir, channelId, env), "vellum.json");
}
