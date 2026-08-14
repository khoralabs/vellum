import type { PersistableSigner } from "@khoralabs/did-key-identity";
import type { VellumPathConfig } from "../../contracts";
import type { VellumPersistence } from "../../persistence/core/types";
import type { VellumControlTransport } from "../../transport";
import type { ChannelFabric } from "../core";
import { createRelayChannelFabric } from "../fabric/relay";
import { runVellumSession, type VellumSessionHandle } from "./run-vellum-session";

export type OpenVellumAttachmentOptions = {
  relayBaseUrl: string;
  signer: PersistableSigner;
  channelId: string;
  cfg: VellumPathConfig;
  /** When omitted, mint via {@link ChannelFabric.ensureAttached}. */
  webSocketUrl?: string;
  webSocketNonce?: string;
  lastBlobId?: number;
  persistence?: VellumPersistence;
  json?: boolean;
  onFatal?: (error: unknown) => void;
  /**
   * Channel fabric for membership + frame byte bus.
   * Defaults to {@link createRelayChannelFabric}.
   */
  fabric?: ChannelFabric;
};

export type VellumAttachmentHandle = {
  did: string;
  channelId: string;
  close(): void;
  ready: Promise<void>;
  /**
   * In-process control transport. Available after {@link ready} resolves.
   * @throws if accessed before ready
   */
  readonly controlTransport: VellumControlTransport;
};

/**
 * Ensure channel credentials (unless WS URL provided) and start an in-process session.
 * Does not spawn a daemon. Await {@link VellumAttachmentHandle.ready} before ops.
 *
 * WebSocket credentials are optional: fabrics that do not use WS may return none from
 * {@link ChannelFabric.ensureAttached}; values are forwarded to {@link runVellumSession} as-is.
 */
export function openVellumAttachment(opts: OpenVellumAttachmentOptions): VellumAttachmentHandle {
  const channelId = opts.channelId.trim();
  if (channelId.length === 0) throw new Error("openVellumAttachment: channelId is required");

  const fabric = opts.fabric ?? createRelayChannelFabric({ relayBaseUrl: opts.relayBaseUrl });
  let disposed = false;
  let session: VellumSessionHandle | undefined;

  const ready = (async () => {
    let webSocketUrl = opts.webSocketUrl?.trim();
    let webSocketNonce = opts.webSocketNonce?.trim();
    let lastBlobId = opts.lastBlobId;

    if (
      webSocketUrl === undefined ||
      webSocketUrl.length === 0 ||
      webSocketNonce === undefined ||
      webSocketNonce.length === 0
    ) {
      const ticket = await fabric.ensureAttached({
        channelId,
        signer: opts.signer,
      });
      if (disposed) {
        throw new DOMException("Vellum attachment closed before ready", "AbortError");
      }
      webSocketUrl = ticket.webSocketUrl ?? webSocketUrl;
      webSocketNonce = ticket.webSocketNonce ?? webSocketNonce;
      lastBlobId = ticket.lastBlobId ?? lastBlobId;
    }

    if (disposed) {
      throw new DOMException("Vellum attachment closed before ready", "AbortError");
    }

    session = runVellumSession({
      relayBaseUrl: opts.relayBaseUrl,
      signer: opts.signer,
      channelId,
      webSocketUrl,
      webSocketNonce,
      lastBlobId,
      cfg: opts.cfg,
      persistence: opts.persistence,
      json: opts.json,
      onFatal: opts.onFatal,
      fabric,
    });
    if (disposed) {
      session.close();
      throw new DOMException("Vellum attachment closed before ready", "AbortError");
    }
    await session.ready;
  })();

  return {
    did: opts.signer.did,
    channelId,
    ready,
    get controlTransport(): VellumControlTransport {
      if (session === undefined) {
        throw new Error("vellum attachment control transport not ready; await ready first");
      }
      return session.controlTransport;
    },
    close(): void {
      if (disposed) return;
      disposed = true;
      session?.close();
    },
  };
}
