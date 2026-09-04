import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  type IdentitySecret,
  identityPrivFromPersistableSigner,
  type PersistableSigner,
} from "@khoralabs/did-key-identity";
import type { JsonDocument } from "@khoralabs/obp-core";
import { validateNbcBindPayloadForPort } from "@khoralabs/obp-nbc/bind-policy";
import { availablePeerPorts, negotiationTurnEnvelopeSchema } from "@khoralabs/obp-nbc/host";
import { RelayClient } from "@khoralabs/relay/client";
import type { RelaySessionQuota } from "@khoralabs/relay/contracts";
import { base64UrlToBytes } from "@khoralabs/relay/crypto";
import {
  fetchKeyPackageHttp,
  generateRouteHandle,
  MlsGroupSession,
  publishMlsWelcomeHttp,
} from "@khoralabs/relay/mls";
import type { ChainSnapshot } from "./chain/vellum-chain";
import { createVellumChannel, joinVellumChannel } from "./channel-ops";
import {
  type ChainInitResponse,
  ChainInitResponseSchema,
  type ChainStateResponse,
  ChainStateResponseSchema,
  cfgDataDir,
  channelSqlitePath,
  VELLUM_CONTROL_HTTP_PATH,
  type VellumChainRow,
  type VellumErrorCode,
  type VellumOfferRow,
  type VellumPathConfig,
  type VellumPortRow,
  vellumControlChainByIdPath,
  vellumErrorCodeForStatus,
  zVellumErrorCode,
} from "./contracts";
import { readVellumControlFile, removeVellumControlFile } from "./control-file";
import { requireVellumIdentity } from "./identity";
import { isPidAlive } from "./list-local-vellum";
import type { VellumPersistence } from "./persistence/core/types";
import { createVellumPersistenceAtPath } from "./persistence/sqlite/vellum-persistence";
import { createVellumControlTransportFromEnv, type VellumControlTransport } from "./transport";

export type VellumConnectResult = "spawned" | "already-running";

export type VellumClientOptions = {
  /** Vellum channel-relay HTTP origin. */
  relayBaseUrl: string;
  channelId: string;
  dataDir?: string | undefined;
  /** Override channel store access (defaults to Bun SQLite under the configured data dir). */
  persistence?: VellumPersistence | undefined;
  /** Defaults to env-selected HTTP (`VELLUM_CONTROL_TRANSPORT`, default `http`). */
  controlTransport?: VellumControlTransport | undefined;
  /** Override the agent identity key path (overrides env vars and defaultAgentIdentityPath). */
  keyPath?: string | undefined;
  /** Already-unlocked signer; preferred over loading from {@link keyPath}. */
  signer?: PersistableSigner | undefined;
  /** Required when loading a sealed identity file from disk. */
  identitySecret?: IdentitySecret | undefined;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Detach so the parent event loop can exit while the daemon keeps running. */
export function unrefDaemonChild(child: Pick<ChildProcess, "unref">): void {
  child.unref();
}

async function waitForControlPlane(
  cfg: VellumPathConfig,
  channelId: string,
  deadlineMs: number,
  child: ChildProcess | undefined,
): Promise<{ controlPort: number }> {
  const deadline = Date.now() + deadlineMs;
  let childError: Error | undefined;
  let childExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;

  if (child !== undefined) {
    child.once("error", (err) => {
      childError = err instanceof Error ? err : new Error(String(err));
    });
    child.once("exit", (code, signal) => {
      childExit = { code, signal };
    });
  }

  while (Date.now() < deadline) {
    if (childError !== undefined) {
      throw new Error(`vellum daemon failed to start: ${childError.message}`, {
        cause: childError,
      });
    }
    if (childExit !== undefined) {
      const detail =
        childExit.signal !== null
          ? `signal ${childExit.signal}`
          : `exit code ${String(childExit.code)}`;
      throw new Error(`vellum daemon exited before control plane was ready (${detail})`);
    }
    const c = readVellumControlFile(cfg, channelId);
    if (c !== undefined) return { controlPort: c.controlPort };
    await sleep(50);
  }
  const hint =
    childExit !== undefined
      ? ` (daemon exited: code=${String(childExit.code)} signal=${String(childExit.signal)})`
      : childError !== undefined
        ? ` (spawn error: ${childError.message})`
        : "";
  throw new Error(`timeout waiting for vellum.json control server${hint}`);
}

function randomGenesisSha256(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

/** Dev checkout: Bun entry for the daemon package. */
function daemonEntryPath(): string {
  return fileURLToPath(new URL("../../../../apps/daemon/src/index.ts", import.meta.url));
}

function resolvePublishedDaemonBin(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@khoralabs/vellum-daemon/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const binField = pkg.bin;
    const rel =
      typeof binField === "string"
        ? binField
        : binField !== undefined && typeof binField === "object"
          ? (binField["vellum-daemon"] ?? Object.values(binField)[0])
          : undefined;
    if (rel === undefined || rel.length === 0) return undefined;
    const abs = fileURLToPath(new URL(rel, `file://${pkgPath}`));
    if (fs.existsSync(abs)) return abs;
  } catch {
    // package not installed
  }
  return undefined;
}

/** Prefer `VELLUM_DAEMON_BIN`, then published meta bin, then monorepo Bun entry if it exists. */
function daemonSpawnCmd(): string[] {
  const bin = process.env.VELLUM_DAEMON_BIN?.trim();
  if (bin !== undefined && bin.length > 0) {
    if (!fs.existsSync(bin)) {
      throw new Error(`VELLUM_DAEMON_BIN does not exist: ${bin}`);
    }
    return [bin];
  }
  const published = resolvePublishedDaemonBin();
  if (published !== undefined) return [published];
  const entry = daemonEntryPath();
  if (!fs.existsSync(entry)) {
    throw new Error(
      "vellum daemon binary not found: set VELLUM_DAEMON_BIN, install @khoralabs/vellum-daemon, or run from a vellum monorepo checkout",
    );
  }
  return ["bun", "run", entry];
}

export class VellumClientError extends Error {
  readonly status: number;
  readonly code?: VellumErrorCode;
  readonly bodyText?: string;

  constructor(message: string, status: number, bodyText?: string, code?: VellumErrorCode) {
    super(message);
    this.name = "VellumClientError";
    this.status = status;
    this.bodyText = bodyText;
    if (code !== undefined) this.code = code;
  }
}

function throwFromFailedControlResponse(status: number, statusText: string, j: unknown): never {
  let message = statusText.length > 0 ? statusText : `Request failed with status ${status}`;
  let code: VellumErrorCode | undefined;
  let bodyText: string | undefined;
  if (typeof j === "object" && j !== null) {
    bodyText = JSON.stringify(j);
    const rec = j as { error?: unknown; code?: unknown };
    if (typeof rec.error === "string" && rec.error.length > 0) message = rec.error;
    const parsed = zVellumErrorCode.safeParse(rec.code);
    if (parsed.success) code = parsed.data;
  }
  throw new VellumClientError(message, status, bodyText, code ?? vellumErrorCodeForStatus(status));
}

/** @internal Exported for unit tests. */
export function throwFromFailedControlResponseForTest(
  status: number,
  statusText: string,
  j: unknown,
): never {
  return throwFromFailedControlResponse(status, statusText, j);
}

export class VellumClient {
  readonly pathConfig: VellumPathConfig;

  private readonly store: VellumPersistence;
  private cachedControlTransport: VellumControlTransport | undefined;

  constructor(public readonly opts: VellumClientOptions) {
    const d = opts.dataDir?.trim();
    this.pathConfig = {
      dataDir: d !== undefined && d.length > 0 ? d : undefined,
    };
    this.store =
      opts.persistence ??
      createVellumPersistenceAtPath(channelSqlitePath(cfgDataDir(this.pathConfig), opts.channelId));
  }

  private async resolveSigner(): Promise<PersistableSigner> {
    if (this.opts.signer !== undefined) return this.opts.signer;
    return requireVellumIdentity({
      keyPath: this.opts.keyPath,
      identitySecret: this.opts.identitySecret,
    });
  }

  /** DID of the local actor (identity signer). */
  async actorDid(): Promise<string> {
    return (await this.resolveSigner()).did;
  }

  private controlBaseUrl(): string {
    const cp = readVellumControlFile(this.pathConfig, this.opts.channelId);
    if (cp === undefined) {
      throw new Error("Vellum daemon control not available (run `vellum connect` first)");
    }
    return `http://127.0.0.1:${cp.controlPort}`;
  }

  private control(): VellumControlTransport {
    if (this.opts.controlTransport !== undefined) return this.opts.controlTransport;
    if (this.cachedControlTransport === undefined) {
      this.cachedControlTransport = createVellumControlTransportFromEnv({
        resolveBaseUrl: () => this.controlBaseUrl(),
      });
    }
    return this.cachedControlTransport;
  }

  /** Create a relay channel (does not require an existing {@link opts.channelId}). */
  async createChannel(body?: {
    ttlMs?: number;
    maxPopulation?: number;
    maxSessions?: RelaySessionQuota;
  }) {
    const signer = await this.resolveSigner();
    return createVellumChannel({
      relayBaseUrl: this.opts.relayBaseUrl,
      signer,
      ...body,
    });
  }

  /** Join a relay channel via invite token. */
  async joinChannel(inviteToken: string) {
    const signer = await this.resolveSigner();
    return joinVellumChannel({
      relayBaseUrl: this.opts.relayBaseUrl,
      signer,
      inviteToken,
    });
  }

  /** Ensure channel daemon is running with a fresh ticket and local control server. */
  async connect(options?: {
    webSocketUrl?: string;
    upgradeNonce?: string;
  }): Promise<VellumConnectResult> {
    const existing = readVellumControlFile(this.pathConfig, this.opts.channelId);
    if (existing !== undefined && isPidAlive(existing.pid)) {
      return "already-running";
    }

    const signer = await this.resolveSigner();
    let webSocketUrl = options?.webSocketUrl ?? process.env.VELLUM_CHANNEL_WS_URL?.trim();
    let upgradeNonce = options?.upgradeNonce ?? process.env.VELLUM_CHANNEL_WS_NONCE?.trim();
    let lastBlobId: number | undefined;
    if (
      webSocketUrl === undefined ||
      webSocketUrl.length === 0 ||
      upgradeNonce === undefined ||
      upgradeNonce.length === 0
    ) {
      const cc = new RelayClient({ relayBaseUrl: this.opts.relayBaseUrl, signer });
      const out = await cc.mintTicket(this.opts.channelId);
      webSocketUrl = out.webSocketUrl;
      upgradeNonce = out.upgradeNonce;
      lastBlobId = out.lastBlobId;
    } else {
      lastBlobId = readVellumControlFile(this.pathConfig, this.opts.channelId)?.lastBlobId;
    }

    const dataDir =
      this.opts.dataDir !== undefined && this.opts.dataDir.length > 0
        ? this.opts.dataDir
        : undefined;
    const cmd = daemonSpawnCmd();
    const [bin, ...args] = cmd;
    if (bin === undefined) throw new Error("daemon spawn command is empty");

    const wrapKeyEnv = identitySecretToEnv(this.opts.identitySecret);
    const child = spawn(bin, args, {
      env: {
        ...process.env,
        VELLUM_CHANNEL_ID: this.opts.channelId,
        VELLUM_CHANNEL_WS_URL: webSocketUrl,
        VELLUM_CHANNEL_WS_NONCE: upgradeNonce,
        VELLUM_BASE_URL: this.opts.relayBaseUrl,
        ...(lastBlobId !== undefined ? { VELLUM_LAST_BLOB_ID: String(lastBlobId) } : {}),
        ...(dataDir !== undefined ? { VELLUM_DATA_DIR: dataDir } : {}),
        ...(this.opts.keyPath !== undefined ? { VELLUM_AGENT_KEY_PATH: this.opts.keyPath } : {}),
        ...wrapKeyEnv,
      },
      stdio: "inherit",
      detached: false,
    });

    await waitForControlPlane(this.pathConfig, this.opts.channelId, 15_000, child);
    unrefDaemonChild(child);
    return "spawned";
  }

  /**
   * Stop the daemon for this channel (SIGTERM) and remove `vellum.json`.
   * @returns whether a control file was present / cleaned up
   */
  disconnect(): boolean {
    const cp = readVellumControlFile(this.pathConfig, this.opts.channelId);
    if (cp === undefined) {
      removeVellumControlFile(this.pathConfig, this.opts.channelId);
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
    removeVellumControlFile(this.pathConfig, this.opts.channelId);
    return true;
  }

  async chainCreate(input: {
    counterpartyDid: string;
    sessionId?: string;
    genesisHash?: string;
    genesisTurn?: Record<string, unknown>;
  }): Promise<ChainInitResponse> {
    const signer = await this.resolveSigner();
    const myDid = signer.did;
    const peerDid = input.counterpartyDid.trim();
    const sessionId = input.sessionId?.trim() ?? randomUUID();
    const genesis = input.genesisHash?.trim() ?? randomGenesisSha256();
    const ed25519PrivKey = identityPrivFromPersistableSigner(signer);

    const channelClient = new RelayClient({
      relayBaseUrl: this.opts.relayBaseUrl,
      signer,
    });
    await channelClient.allocateSession(this.opts.channelId, {
      counterpartyDid: peerDid,
      sessionId,
    });

    try {
      const fetched = await fetchKeyPackageHttp(this.opts.relayBaseUrl, signer, peerDid);
      const peerKeyPackageBytes = base64UrlToBytes(fetched.keyPackage);
      const mlsSession = new MlsGroupSession(sessionId, myDid, ed25519PrivKey);
      const { welcomeBase64Url } = await mlsSession.createWithPeer(peerKeyPackageBytes, peerDid);
      await publishMlsWelcomeHttp(this.opts.relayBaseUrl, signer, this.opts.channelId, sessionId, {
        welcome: welcomeBase64Url,
        route: generateRouteHandle(),
      });

      const roster = await channelClient.getRoster(this.opts.channelId);
      const peerMember = roster.members.find((m) => m.principalUri === peerDid);
      const peerIdentityKey = peerMember?.actorPubkey?.trim();
      if (peerIdentityKey === undefined || !/^[0-9a-f]{64}$/.test(peerIdentityKey)) {
        throw new Error(`peer identity key not in roster for ${peerDid}`);
      }

      const payload: {
        init: {
          session_id: string;
          genesis_hash: string;
          party_dids: [string, string];
          peer_identity_key: string;
        };
        genesis_turn?: Record<string, unknown>;
      } = {
        init: {
          session_id: sessionId,
          genesis_hash: genesis,
          party_dids: [myDid, peerDid],
          peer_identity_key: peerIdentityKey,
        },
      };
      if (input.genesisTurn !== undefined) {
        payload.genesis_turn = input.genesisTurn;
      }
      const res = await this.control().fetch(VELLUM_CONTROL_HTTP_PATH.chainInit, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throwFromFailedControlResponse(res.status, res.statusText, j);
      }
      return ChainInitResponseSchema.parse(j);
    } catch (e) {
      await channelClient.releaseSession(this.opts.channelId, sessionId).catch(() => {});
      throw e;
    }
  }

  /** Release a bilateral chain slot on the relay (frees quota). */
  async chainRelease(sessionId: string): Promise<void> {
    const signer = await this.resolveSigner();
    const channelClient = new RelayClient({
      relayBaseUrl: this.opts.relayBaseUrl,
      signer,
    });
    await channelClient.releaseSession(this.opts.channelId, sessionId.trim());
  }

  async sendTurn(sessionId: string, body: Record<string, unknown>): Promise<void> {
    const res = await this.control().fetch(VELLUM_CONTROL_HTTP_PATH.turn, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, body }),
    });
    const j: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throwFromFailedControlResponse(res.status, res.statusText, j);
    }
  }

  async endOffers(sessionId: string): Promise<void> {
    const res = await this.control().fetch(VELLUM_CONTROL_HTTP_PATH.chainEndOffers, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const j: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throwFromFailedControlResponse(res.status, res.statusText, j);
    }
  }

  async terminateChain(sessionId: string): Promise<void> {
    const res = await this.control().fetch(VELLUM_CONTROL_HTTP_PATH.chainClose, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const j: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throwFromFailedControlResponse(res.status, res.statusText, j);
    }
  }

  async getSessionSnapshot(sessionId: string): Promise<ChainSnapshot> {
    const res = await this.control().fetch(vellumControlChainByIdPath(sessionId));
    const j: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throwFromFailedControlResponse(res.status, res.statusText, j);
    }
    const snap = j as Omit<ChainSnapshot, "schema">;
    const myDid = await this.actorDid();
    const peerPorts = availablePeerPorts(snap.graph, myDid);
    const schema = negotiationTurnEnvelopeSchema({
      opening: snap.graph.offers.length === 0,
      peerPorts,
    });
    return { ...snap, schema };
  }

  async getChainSnapshot(): Promise<ChainStateResponse> {
    const res = await this.control().fetch(VELLUM_CONTROL_HTTP_PATH.chain);
    const j: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throwFromFailedControlResponse(res.status, res.statusText, j);
    }
    return ChainStateResponseSchema.parse(j);
  }

  listChainsFromStore(): VellumChainRow[] {
    return this.store.listChains();
  }

  listOffers(): VellumOfferRow[] {
    return this.store.listOffers();
  }

  readOffer(offerId: string): VellumOfferRow | undefined {
    return this.store.readOffer(offerId);
  }

  listPortsForOffer(offerId: string): string[] {
    return this.store.listPortIdsForOffer(offerId);
  }

  readPort(portId: string): VellumPortRow | undefined {
    return this.store.readPort(portId);
  }

  readPolicySnapshot(portId: string): unknown | null {
    return this.readPort(portId)?.bind_policy ?? null;
  }

  validatePolicy(portId: string, payload: unknown): Record<string, unknown> {
    const port = this.readPort(portId);
    if (port === undefined) {
      throw new Error(`port not found: ${portId}`);
    }
    return validateNbcBindPayloadForPort(port.bind_policy as JsonDocument | null, payload);
  }
}

/** Pass wrap-key secret to a spawned daemon via env (harness-compatible). */
function identitySecretToEnv(
  secret: IdentitySecret | undefined,
): Record<string, string> | undefined {
  if (secret === undefined) return undefined;
  if (secret.type === "wrapKey") {
    return {
      VELLUM_IDENTITY_WRAP_KEY: Buffer.from(secret.key).toString("base64"),
    };
  }
  if (secret.type === "passphrase") {
    return { VELLUM_IDENTITY_PASSPHRASE: secret.passphrase };
  }
  return undefined;
}
