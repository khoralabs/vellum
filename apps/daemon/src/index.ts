#!/usr/bin/env bun
import { existsSync } from "node:fs";

import { loadIdentity, type PersistableSigner } from "@khoralabs/did-key-identity";
import {
  defaultAgentIdentityPath,
  defaultVellumDaemonConfigPath,
  loadVellumAppConfig,
  vellumAppConfigBuiltinDefaults,
  vellumAppConfigFromEnv,
  zVellumAppConfigBase,
} from "@khoralabs/vellum-client";
import type { VellumPathConfig } from "@khoralabs/vellum-contracts";

import { runVellumDaemon } from "./run-vellum-daemon";

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

async function loadSigner(vcfg: { agentKeyPath?: string }): Promise<PersistableSigner> {
  const p =
    process.env.VELLUM_AGENT_KEY_PATH?.trim() ??
    vcfg.agentKeyPath?.trim() ??
    defaultAgentIdentityPath();
  const signer = await loadIdentity(p);
  if (signer === undefined) {
    console.error(`No agent identity at ${p}. Generate an Ed25519 identity first.`);
    process.exit(1);
  }
  return signer;
}

const vcfg = loadDaemonLayeredConfig();

const json = daemonJsonOutput(vcfg);
const channelId = process.env.VELLUM_CHANNEL_ID?.trim() ?? "";
const webSocketUrl =
  process.env.VELLUM_CHANNEL_WS_URL?.trim() ?? vcfg.defaultChannelWebSocketUrl?.trim() ?? "";
const relayBaseUrl = process.env.VELLUM_BASE_URL?.trim() ?? vcfg.relayBaseUrl?.trim() ?? "";

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
const handle = runVellumDaemon({
  relayBaseUrl,
  signer,
  channelId,
  webSocketUrl,
  ...(lastBlobId !== undefined && Number.isFinite(lastBlobId) ? { lastBlobId } : {}),
  json,
  cfg: daemonPathConfig(vcfg),
});

function shutdown(): void {
  handle.close();
  // Let the async cleanup (stopAutoReplenish, db.close, etc.) run before exit.
  // The process exits naturally once the event loop drains.
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
