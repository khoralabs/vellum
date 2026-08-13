#!/usr/bin/env bun
import { existsSync } from "node:fs";

import type { PersistableSigner } from "@khoralabs/did-key-identity";
import {
  defaultVellumDaemonConfigPath,
  loadVellumAppConfig,
  requireVellumIdentity,
  resolveVellumIdentityPath,
  type VellumPathConfig,
  vellumAppConfigBuiltinDefaults,
  vellumAppConfigFromEnv,
  zVellumAppConfigBase,
} from "@khoralabs/vellum-client";
import { runVellumSession } from "@khoralabs/vellum-client/session";

function daemonJsonOutput(vcfg: { daemonJson?: boolean }): boolean {
  return (
    process.env.VELLUM_DAEMON_JSON === "1" ||
    process.argv.includes("--json") ||
    process.argv.includes("-j") ||
    vcfg.daemonJson === true
  );
}

function daemonPathConfig(vcfg: { dataDir?: string }): VellumPathConfig {
  const dataDir = process.env.VELLUM_DATA_DIR?.trim() ?? vcfg.dataDir?.trim();
  return {
    dataDir: dataDir !== undefined && dataDir.length > 0 ? dataDir : undefined,
  };
}

function loadDaemonLayeredConfig() {
  const p = defaultVellumDaemonConfigPath();
  return loadVellumAppConfig({
    schema: zVellumAppConfigBase,
    layers: [vellumAppConfigBuiltinDefaults(), vellumAppConfigFromEnv()],
    filePath: existsSync(p) ? p : null,
    filePathExplicit: false,
  }).config;
}

function resolveIdentitySecretFromEnv():
  | { type: "wrapKey"; key: Uint8Array }
  | { type: "passphrase"; passphrase: string }
  | undefined {
  const wrap = process.env.VELLUM_IDENTITY_WRAP_KEY?.trim();
  if (wrap !== undefined && wrap.length > 0) {
    const key = /^[0-9a-fA-F]{64}$/.test(wrap)
      ? Buffer.from(wrap, "hex")
      : Buffer.from(wrap, "base64");
    if (key.byteLength !== 32) {
      console.error("VELLUM_IDENTITY_WRAP_KEY must decode to 32 bytes");
      process.exit(1);
    }
    return { type: "wrapKey", key: new Uint8Array(key) };
  }
  const pass = process.env.VELLUM_IDENTITY_PASSPHRASE?.trim();
  if (pass !== undefined && pass.length > 0) {
    return { type: "passphrase", passphrase: pass };
  }
  return undefined;
}

async function loadSigner(vcfg: { agentKeyPath?: string }): Promise<PersistableSigner> {
  const keyPath =
    process.env.VELLUM_AGENT_KEY_PATH?.trim() ??
    vcfg.agentKeyPath?.trim() ??
    resolveVellumIdentityPath();
  try {
    return await requireVellumIdentity({
      keyPath,
      identitySecret: resolveIdentitySecretFromEnv(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    process.exit(1);
  }
}

const vcfg = loadDaemonLayeredConfig();

const json = daemonJsonOutput(vcfg);
const channelId = process.env.VELLUM_CHANNEL_ID?.trim() ?? "";
const webSocketUrl =
  process.env.VELLUM_CHANNEL_WS_URL?.trim() ?? vcfg.defaultChannelWebSocketUrl?.trim() ?? "";
const relayBaseUrl = process.env.VELLUM_BASE_URL?.trim() ?? vcfg.relayBaseUrl?.trim() ?? "";
const webSocketNonce = process.env.VELLUM_CHANNEL_WS_NONCE?.trim();

if (channelId.length === 0) {
  console.error(
    "VELLUM_CHANNEL_ID is required (set by vellum connect/attach when spawning the daemon)",
  );
  process.exit(1);
}
if (webSocketUrl.length === 0) {
  console.error(
    "VELLUM_CHANNEL_WS_URL is required (or set defaultChannelWebSocketUrl in ~/.vellum/daemon.config.json)",
  );
  process.exit(1);
}
if (relayBaseUrl.length === 0) {
  console.error("VELLUM_BASE_URL is required (Vellum channel-relay HTTP origin)");
  process.exit(1);
}

const signer = await loadSigner(vcfg);
const lastBlobRaw = process.env.VELLUM_LAST_BLOB_ID?.trim();
const lastBlobId =
  lastBlobRaw !== undefined && lastBlobRaw.length > 0
    ? Number.parseInt(lastBlobRaw, 10)
    : undefined;
const handle = runVellumSession({
  relayBaseUrl,
  signer,
  channelId,
  webSocketUrl,
  ...(webSocketNonce !== undefined && webSocketNonce.length > 0 ? { webSocketNonce } : {}),
  ...(lastBlobId !== undefined && Number.isFinite(lastBlobId) ? { lastBlobId } : {}),
  json,
  cfg: daemonPathConfig(vcfg),
  onFatal: () => process.exit(1),
});

handle.ready.catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

function shutdown(): void {
  handle.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
