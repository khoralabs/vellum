import fs from "node:fs";
import path from "node:path";

import type { PersistableSigner } from "@khoralabs/did-key-identity";
import { createHexSigner, identityPrivFromPersistableSigner } from "@khoralabs/did-key-identity";
import type { JsonDocument } from "@khoralabs/obp-core";
import { createObpSqlitePersistenceClient, openObpDatabase } from "@khoralabs/obp-core/sqlite";
import { collectNbcChainGraph, validateBindPolicyAtExpose, whoShouldAct } from "@khoralabs/obp-nbc";
import { validateNbcBindPayloadForPort } from "@khoralabs/obp-nbc/bind-policy";
import { RelayClient } from "@khoralabs/relay/client";
import { base64UrlToBytes } from "@khoralabs/relay/crypto/encoding";
import { fetchMlsWelcomeHttp, KeyPackageManager, MlsGroupSession } from "@khoralabs/relay/mls";
import { cfgDataDir, channelSqlitePath, type VellumPathConfig } from "../../contracts";
import {
  readVellumControlFile,
  removeVellumControlFile,
  writeVellumControlFile,
} from "../../control-file";
import type { VellumPersistence } from "../../persistence/core/types";
import { createVellumPersistence } from "../../persistence/sqlite/vellum-persistence";
import { withRelayClientErrors } from "../../relay-client-errors";
import { InProcessControlTransport, type VellumControlTransport } from "../../transport";
import { startVellumControlServer } from "../control-http";
import type { ChannelFabric, VellumControlServerState } from "../core";
import { createRelayChannelFabric } from "../fabric/relay";
import { connectObpOverByteChannel } from "../relay";

export type RunVellumSessionOptions = {
  relayBaseUrl: string;
  signer: PersistableSigner;
  channelId: string;
  /** Optional; when omitted, resolved via {@link ChannelFabric.ensureAttached}. */
  webSocketUrl?: string;
  /** Sec-WebSocket-Protocol nonce; prefer explicit over env. */
  webSocketNonce?: string;
  lastBlobId?: number;
  json?: boolean;
  cfg: VellumPathConfig;
  /** Injected store; defaults to SQLite on the channel OBP database. */
  persistence?: VellumPersistence;
  /** Called on fatal KeyPackage replenish failure instead of process.exit. */
  onFatal?: (error: unknown) => void;
  /**
   * Channel fabric for membership + frame byte bus.
   * Defaults to {@link createRelayChannelFabric} (one WS per session).
   */
  fabric?: ChannelFabric;
};

function logLine(json: boolean, label: string, payload: unknown): void {
  if (json) {
    console.log(JSON.stringify({ t: label, payload }));
  } else {
    console.log(`[${label}] ${JSON.stringify(payload)}`);
  }
}

export type VellumSessionHandle = {
  close(): void;
  /** Resolves when control plane is up; rejects on boot/WS failure. */
  ready: Promise<void>;
  /**
   * In-process control transport. Available after {@link ready} resolves.
   * @throws if accessed before the control plane is ready
   */
  readonly controlTransport: VellumControlTransport;
};

/**
 * Hold a Vellum channel WebSocket with durable OBP v2 graph in SQLite and a local HTTP control plane.
 * Also exposes {@link VellumSessionHandle.controlTransport} for in-process hosts (no spawn).
 */
export function runVellumSession(opts: RunVellumSessionOptions): VellumSessionHandle {
  const json = opts.json === true;
  const fabric = opts.fabric ?? createRelayChannelFabric({ relayBaseUrl: opts.relayBaseUrl });
  const ac = new AbortController();
  let disposed = false;
  let serverStop: (() => void) | undefined;
  let frameClose: (() => void) | undefined;
  let controlTransport: VellumControlTransport | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (e: unknown) => void;
  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = () => {
      if (readySettled) return;
      readySettled = true;
      resolve();
    };
    rejectReady = (e) => {
      if (readySettled) return;
      readySettled = true;
      reject(e);
    };
  });

  const hold = new Promise<void>((resolve) => {
    ac.signal.addEventListener("abort", () => resolve(), { once: true });
  });

  void (async () => {
    let db: ReturnType<typeof openObpDatabase> | undefined;
    let kpm: KeyPackageManager | undefined;

    try {
      const sqlitePath = channelSqlitePath(cfgDataDir(opts.cfg), opts.channelId);
      fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });

      db = openObpDatabase(sqlitePath);
      const database = db;
      const vellum = opts.persistence ?? createVellumPersistence(database);
      vellum.ensureSchema();
      const persistence = createObpSqlitePersistenceClient(database, {
        validateBindPolicyAtExpose,
      });

      const state: VellumControlServerState = {
        conn: undefined,
        handles: new Map(),
        events: new Set(),
        initiators: new Map(),
      };

      if (ac.signal.aborted) {
        throw new DOMException("Vellum session closed before ready", "AbortError");
      }

      const hexSigner = await createHexSigner(opts.signer);
      if (ac.signal.aborted) {
        throw new DOMException("Vellum session closed before ready", "AbortError");
      }

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

      kpm = new KeyPackageManager({
        relayBaseUrl: opts.relayBaseUrl,
        signer: opts.signer,
        myDid: frameSigner.did,
        ed25519PrivateKey: ed25519PrivKey,
      });
      const keyPackageManager = kpm;
      await keyPackageManager.replenishIfNeeded();
      if (ac.signal.aborted) {
        throw new DOMException("Vellum session closed before ready", "AbortError");
      }

      keyPackageManager.startAutoReplenish({
        onGiveUp: (error, attempts) => {
          const msg = error instanceof Error ? error.message : String(error);
          logLine(json, "vellum_keypackage_replenish_fatal", { error: msg, attempts });
          const err = error instanceof Error ? error : new Error(msg);
          opts.onFatal?.(err);
          rejectReady(err);
          ac.abort();
        },
      });
      logLine(json, "vellum_keypackages_published", { did: frameSigner.did });

      logLine(json, "vellum_open", { channelId: opts.channelId, sqlitePath });
      let webSocketUrl = opts.webSocketUrl?.trim();
      let webSocketNonce =
        opts.webSocketNonce?.trim() ?? process.env.VELLUM_CHANNEL_WS_NONCE?.trim();
      let lastBlobId = opts.lastBlobId;
      if (
        webSocketUrl === undefined ||
        webSocketUrl.length === 0 ||
        webSocketNonce === undefined ||
        webSocketNonce.length === 0
      ) {
        const ticket = await fabric.ensureAttached({
          channelId: opts.channelId,
          signer: opts.signer,
        });
        webSocketUrl = ticket.webSocketUrl ?? webSocketUrl;
        webSocketNonce = ticket.webSocketNonce ?? webSocketNonce;
        lastBlobId = ticket.lastBlobId ?? lastBlobId;
      }
      const frame = await fabric.openFrameChannel({
        channelId: opts.channelId,
        signer: opts.signer,
        webSocketUrl,
        webSocketNonce,
        lastBlobId,
      });
      frameClose = frame.close;
      await connectObpOverByteChannel(
        {
          channel: frame.channel,
          onChannelClose: () => frame.close(),
          signer: frameSigner,
          client: persistence,
          validateBindPayload: (bindPolicy, bindPayload) =>
            validateNbcBindPayloadForPort(bindPolicy, bindPayload) as JsonDocument,
          handlers: {
            onSessionReady: async (handle) => {
              vellum.upsertChain(handle.sessionId, handle.init.genesis_hash, Date.now());
              for (const party of handle.init.parties) {
                await persistence.registerParty({ id: party.id, name: party.id });
              }

              const peerParty = handle.init.parties.find((p) => p.pubkey !== frameSigner.actor);
              const peerDid = peerParty?.id;
              const readyResult = await fabric.onSessionReady?.({
                channelId: opts.channelId,
                localDid: frameSigner.did,
                peerDid,
                sessionId: handle.sessionId,
              });
              const skipMls = readyResult?.skipDefaultMlsWelcome === true;

              if (peerParty !== undefined && !skipMls) {
                try {
                  const fetched = await withRelayClientErrors(() =>
                    fetchMlsWelcomeHttp(
                      opts.relayBaseUrl,
                      opts.signer,
                      opts.channelId,
                      handle.sessionId,
                    ),
                  );
                  const welcomeBytes = base64UrlToBytes(fetched.welcome);
                  const stored = await keyPackageManager.listStoredKeyPackages();
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

              state.handles.set(handle.sessionId, handle);
              vellum.upsertChain(handle.sessionId, handle.init.genesis_hash, Date.now(), peerDid);
              logLine(json, "vellum_chain_ready", { sessionId: handle.sessionId });
            },
            onGraphAdvanced: async (event, _session) => {
              const listeners = state.events;
              if (listeners === undefined) return;
              const adv = { kind: "graph-advanced" as const, sessionId: event.sessionId };
              for (const fn of listeners) fn(adv);
              try {
                const graph = await collectNbcChainGraph(persistence);
                const stored = vellum.getChain(event.sessionId)?.initiator_did?.trim();
                const initiatorId =
                  (stored !== undefined && stored.length > 0 ? stored : undefined) ??
                  (state.initiators ?? new Map()).get(event.sessionId) ??
                  frameSigner.did;
                const acting = whoShouldAct(graph, { initiatorId });
                if (acting === frameSigner.did) {
                  const yt = {
                    kind: "your-turn" as const,
                    sessionId: event.sessionId,
                    offersLength: graph.offers.length,
                  };
                  for (const fn of listeners) fn(yt);
                }
              } catch {
                // snapshot optional
              }
            },
            onFrameError: (() => {
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

          await withRelayClientErrors(() =>
            channelClient.registerActor(opts.channelId, frameSigner.actor),
          );
          const snapshot = await withRelayClientErrors(() =>
            channelClient.getRoster(opts.channelId),
          );
          for (const m of snapshot.members) {
            if (m.actorPubkey !== undefined) {
              vellum.upsertRosterEntry(m.principalUri, m.actorPubkey, Date.now());
            }
          }
          logLine(json, "vellum_roster_synced", { members: snapshot.members.length });

          const isSessionAllocated =
            fabric.isSessionAllocated !== undefined
              ? (sessionId: string) =>
                  Promise.resolve(fabric.isSessionAllocated?.(opts.channelId, sessionId)).then(
                    (v) => v === true,
                  )
              : (sessionId: string) =>
                  withRelayClientErrors(() =>
                    channelClient.isSessionAllocated(opts.channelId, sessionId),
                  );

          const server = startVellumControlServer({
            state,
            db: database,
            meta: vellum,
            persistence,
            signer: opts.signer,
            myActorPubkeyHex: frameSigner.actor,
            isSessionAllocated,
          });
          serverStop = server.stop;
          controlTransport = new InProcessControlTransport(server.dispatch);
          const existing = readVellumControlFile(opts.cfg, opts.channelId);
          const initialLastBlobId = lastBlobId ?? existing?.lastBlobId;
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
          resolveReady();

          const blobIdUpdateInterval =
            initialLastBlobId !== undefined
              ? setInterval(() => {
                  const delta = frame.getRelaySequenceDelta?.() ?? getFrameCount();
                  const est = initialLastBlobId + delta;
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
      if (ac.signal.aborted) {
        rejectReady(new DOMException("Vellum session closed before ready", "AbortError"));
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        logLine(json, "vellum_error", { channelId: opts.channelId, error: msg });
        console.error(msg);
        rejectReady(e);
      }
    } finally {
      kpm?.stopAutoReplenish();
      serverStop?.();
      frameClose?.();
      removeVellumControlFile(opts.cfg, opts.channelId);
      try {
        db?.close();
      } catch {
        // ignore
      }
    }
  })();

  return {
    ready,
    get controlTransport(): VellumControlTransport {
      if (controlTransport === undefined) {
        throw new Error("vellum session control transport not ready; await ready first");
      }
      return controlTransport;
    },
    close(): void {
      if (disposed) return;
      disposed = true;
      rejectReady(new DOMException("Vellum session closed before ready", "AbortError"));
      ac.abort();
    },
  };
}
