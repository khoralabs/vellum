import type { PersistableSigner } from "@khoralabs/did-key-identity";
import { RelayClient } from "@khoralabs/relay/client";
import type { VellumPathConfig } from "../../contracts";
import type { VellumPersistence } from "../../persistence/core/types";
import type { VellumControlTransport } from "../../transport";
import { runVellumSession, type VellumSessionHandle } from "./run-vellum-session";

export type OpenVellumAttachmentOptions = {
  relayBaseUrl: string;
  signer: PersistableSigner;
  channelId: string;
  cfg: VellumPathConfig;
  /** When omitted, mint a fresh channel ticket. */
  webSocketUrl?: string;
  webSocketNonce?: string;
  lastBlobId?: number;
  persistence?: VellumPersistence;
  json?: boolean;
  onFatal?: (error: unknown) => void;
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
 * Mint a relay ticket (unless WS URL provided) and start an in-process session.
 * Does not spawn a daemon. Await {@link VellumAttachmentHandle.ready} before ops.
 */
export function openVellumAttachment(opts: OpenVellumAttachmentOptions): VellumAttachmentHandle {
  const channelId = opts.channelId.trim();
  if (channelId.length === 0) throw new Error("openVellumAttachment: channelId is required");

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
      const relay = new RelayClient({
        relayBaseUrl: opts.relayBaseUrl,
        signer: opts.signer,
      });
      const ticket = await relay.mintTicket(channelId);
      if (disposed) {
        throw new DOMException("Vellum attachment closed before ready", "AbortError");
      }
      webSocketUrl = ticket.webSocketUrl;
      webSocketNonce = ticket.upgradeNonce;
      lastBlobId = ticket.lastBlobId;
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
