import fs from "node:fs";
import path from "node:path";

import type { PersistableSigner } from "@khoralabs/did-key-identity";
import { createHexSigner, identityPrivFromPersistableSigner } from "@khoralabs/did-key-identity";
import { validateNbcBindPayloadForPort } from "@khoralabs/nbc-bind-policy";
import type { JsonDocument } from "@khoralabs/obp-model";
import {
  createObpSqlitePersistenceClient,
  openObpDatabase,
} from "@khoralabs/obp-sqlite-persistence";
import { RelayClient } from "@khoralabs/relay-client";
import { relayWsUpgradeProtocol } from "@khoralabs/relay-contracts";
import { base64UrlToBytes } from "@khoralabs/relay-crypto";
import { fetchMlsWelcomeHttp, MlsGroupSession } from "@khoralabs/relay-mls";
import { cfgDataDir, channelSqlitePath, type VellumPathConfig } from "@khoralabs/vellum-contracts";
import {
  readVellumControlFile,
  removeVellumControlFile,
  writeVellumControlFile,
} from "./control-pid";
import { startVellumControlServer, type VellumControlServerState } from "./control-server";
import { connectObpOverRelay } from "./relay-obp-adapter";
import { ensureVellumMetaSchema, upsertChainRow, upsertRosterEntry } from "./vellum-sqlite-meta";

export type RunVellumDaemonOptions = {
  relayBaseUrl: string;
  signer: PersistableSigner;
  channelId: string;
  webSocketUrl: string;
  lastBlobId?: number;
  json?: boolean;
  cfg: VellumPathConfig;
};

function logLine(json: boolean, label: string, payload: unknown): void {
  if (json) {
    console.log(JSON.stringify({ t: label, payload }));
  } else {
    console.log(`[${label}] ${JSON.stringify(payload)}`);
  }
}

/**
 * Hold a Vellum channel WebSocket with durable OBP v2 graph in SQLite and a local HTTP control plane.
 */
export function runVellumDaemon(opts: RunVellumDaemonOptions): {
  close(): void;
} {
  const json = opts.json === true;
  const ac = new AbortController();
  let disposed = false;
  let serverStop: (() => void) | undefined;

  const hold = new Promise<void>((resolve) => {
    ac.signal.addEventListener("abort", () => resolve(), { once: true });
  });

  void (async () => {
    const sqlitePath = channelSqlitePath(cfgDataDir(opts.cfg), opts.channelId);
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

    const db = openObpDatabase(sqlitePath);
    ensureVellumMetaSchema(db);
    const persistence = createObpSqlitePersistenceClient(db);

    const state: VellumControlServerState = {
      conn: undefined,
      handles: new Map(),
    };

    const hexSigner = await createHexSigner(opts.signer);
    const frameSigner = {
      did: hexSigner.did,
      actor: hexSigner.publicKeyHex,
      sign: (bytes: Uint8Array) => hexSigner.sign(bytes),
    };
    const ed25519PrivKey = identityPrivFromPersistableSigner(opts.signer);
    const channelClient = new RelayClient({
      relayBaseUrl: opts.relayBaseUrl,
      signer: opts.signer,
    });

    const kpm = channelClient.createKeyPackageManager(frameSigner.did, ed25519PrivKey);
    await kpm.replenishIfNeeded();
    kpm.startAutoReplenish({
      onGiveUp: (error, attempts) => {
        const msg = error instanceof Error ? error.message : String(error);
        logLine(json, "vellum_keypackage_replenish_fatal", { error: msg, attempts });
        process.exit(1);
      },
    });
    logLine(json, "vellum_keypackages_published", { did: frameSigner.did });

    try {
      logLine(json, "vellum_open", { channelId: opts.channelId, sqlitePath });
      const wsNonce = process.env.VELLUM_CHANNEL_WS_NONCE?.trim();
      const webSocketProtocols =
        wsNonce !== undefined && wsNonce.length > 0 ? [relayWsUpgradeProtocol(wsNonce)] : undefined;
      const replayAfter = opts.lastBlobId;
      await connectObpOverRelay(
        {
          webSocketUrl: opts.webSocketUrl,
          webSocketProtocols,
          replayAfter,
          signer: frameSigner,
          client: persistence,
          validateBindPayload: (bindPolicy, bindPayload) =>
            validateNbcBindPayloadForPort(bindPolicy, bindPayload) as JsonDocument,
          handlers: {
            onSessionReady: async (handle) => {
              upsertChainRow(db, handle.sessionId, handle.init.genesis_hash, Date.now());
              for (const party of handle.init.parties) {
                await persistence.registerParty({ id: party.id, name: party.id });
              }

              // Responder: await MLS join before registering handle so sendTurn is gated
              // until the MLS session exists. On failure the handle is still registered
              // (degraded mode) so the chain remains usable without MLS encryption.
              const peerParty = handle.init.parties.find((p) => p.pubkey !== frameSigner.actor);
              if (peerParty !== undefined) {
                try {
                  const fetched = await fetchMlsWelcomeHttp(
                    opts.relayBaseUrl,
                    opts.signer,
                    opts.channelId,
                    handle.sessionId,
                  );
                  const welcomeBytes = base64UrlToBytes(fetched.welcome);
                  const stored = await kpm.listStoredKeyPackages();
                  // Find a matching stored KeyPackage by trying each (Welcome contains the target init key)
                  let joined = false;
                  for (const s of stored) {
                    try {
                      const mlsSession = new MlsGroupSession(
                        handle.sessionId,
                        frameSigner.did,
                        ed25519PrivKey,
                      );
                      await mlsSession.joinFromWelcome(
                        welcomeBytes,
                        s.privatePackage,
                        s.publicPackage,
                      );
                      joined = true;
                      break;
                    } catch {
                      // try next key package
                    }
                  }
                  if (joined) {
                    logLine(json, "vellum_mls_joined", { sessionId: handle.sessionId });
                  } else {
                    logLine(json, "vellum_mls_join_failed", {
                      sessionId: handle.sessionId,
                      error: "no matching KeyPackage",
                    });
                  }
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  logLine(json, "vellum_mls_join_error", {
                    sessionId: handle.sessionId,
                    error: msg,
                  });
                }
              }

              // Register handle after MLS attempt — turns queued by callers until this point
              state.handles.set(handle.sessionId, handle);
              logLine(json, "vellum_chain_ready", { sessionId: handle.sessionId });
            },
            onFrameError: (() => {
              // Rate-limit logging: at most 1 log per second + a summary count.
              // Prevents a junk-flooding peer from filling disk.
              let suppressed = 0;
              let lastLogMs = 0;
              return (e: unknown, context: string) => {
                const now = Date.now();
                if (now - lastLogMs >= 1000) {
                  const msg = e instanceof Error ? e.message : String(e);
                  logLine(json, "vellum_frame_skipped", {
                    context,
                    error: msg,
                    ...(suppressed > 0 ? { suppressed } : {}),
                  });
                  suppressed = 0;
                  lastLogMs = now;
                } else {
                  suppressed++;
                }
              };
            })(),
          },
        },
        async (conn, getFrameCount) => {
          state.conn = conn;

          await channelClient.registerActor(opts.channelId, frameSigner.actor);
          const snapshot = await channelClient.getRoster(opts.channelId);
          for (const m of snapshot.members) {
            if (m.actorPubkey !== undefined) {
              upsertRosterEntry(db, m.principalUri, m.actorPubkey, Date.now());
            }
          }
          logLine(json, "vellum_roster_synced", { members: snapshot.members.length });

          const server = startVellumControlServer({
            state,
            db,
            persistence,
            signer: opts.signer,
            myActorPubkeyHex: frameSigner.actor,
            isSessionAllocated: (sessionId) =>
              channelClient.isSessionAllocated(opts.channelId, sessionId),
          });
          serverStop = server.stop;
          const existing = readVellumControlFile(opts.cfg, opts.channelId);
          const initialLastBlobId = opts.lastBlobId ?? existing?.lastBlobId;
          writeVellumControlFile(opts.cfg, opts.channelId, {
            pid: process.pid,
            controlPort: server.port,
            channelId: opts.channelId,
            ...(initialLastBlobId !== undefined ? { lastBlobId: initialLastBlobId } : {}),
          });
          logLine(json, "vellum_control", {
            hostname: server.hostname,
            port: server.port,
          });

          // Periodically update lastBlobId estimate in the control file so crash-recovery
          // reconnects replay as few frames as possible. frameCount + initialLastBlobId
          // approximates the relay's current spool position (imprecise but directionally
          // correct — OBP replay is idempotent via INSERT OR IGNORE).
          const blobIdUpdateInterval =
            initialLastBlobId !== undefined
              ? setInterval(() => {
                  const est = initialLastBlobId + getFrameCount();
                  writeVellumControlFile(opts.cfg, opts.channelId, {
                    pid: process.pid,
                    controlPort: server.port,
                    channelId: opts.channelId,
                    lastBlobId: est,
                  });
                }, 30_000)
              : undefined;

          try {
            await hold;
          } finally {
            if (blobIdUpdateInterval !== undefined) clearInterval(blobIdUpdateInterval);
          }
        },
      );
    } catch (e) {
      if (!ac.signal.aborted) {
        const msg = e instanceof Error ? e.message : String(e);
        logLine(json, "vellum_error", { channelId: opts.channelId, error: msg });
        console.error(msg);
      }
    } finally {
      kpm.stopAutoReplenish();
      serverStop?.();
      removeVellumControlFile(opts.cfg, opts.channelId);
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  })();

  return {
    close(): void {
      if (disposed) return;
      disposed = true;
      ac.abort();
    },
  };
}
