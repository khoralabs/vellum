import type { VellumAppConfigBase } from "./schema";

function trimmed(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

/** Map env vars into a partial config layer (overrides built-in defaults; overridden by config files). */
export function vellumAppConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Partial<VellumAppConfigBase> {
  const out: Partial<VellumAppConfigBase> = {};

  const relayBaseUrl = trimmed(env.VELLUM_BASE_URL);
  if (relayBaseUrl !== undefined) out.relayBaseUrl = relayBaseUrl;

  const dataDir = trimmed(env.VELLUM_DATA_DIR);
  if (dataDir !== undefined) out.dataDir = dataDir;

  const agentKeyPath = trimmed(env.VELLUM_AGENT_KEY_PATH);
  if (agentKeyPath !== undefined) out.agentKeyPath = agentKeyPath;

  const defaultChannelWebSocketUrl = trimmed(env.VELLUM_CHANNEL_WS_URL);
  if (defaultChannelWebSocketUrl !== undefined) {
    out.defaultChannelWebSocketUrl = defaultChannelWebSocketUrl;
  }

  const jsonRaw = trimmed(env.VELLUM_DAEMON_JSON);
  if (jsonRaw === "1" || jsonRaw === "true") out.daemonJson = true;

  return out;
}
