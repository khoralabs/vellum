import type { PersistableSigner } from "@khoralabs/did-key-identity";
import { RelayClient } from "@khoralabs/relay/client";
import { relayWsUpgradeProtocol } from "@khoralabs/relay/contracts";
import type {
  ChannelFabric,
  ChannelFabricEnsureAttachedResult,
  OpenFabricFrameChannelResult,
} from "../../core/fabric";
import { openRelayByteDuplex, webSocketUrlWithReplay } from "../../relay/obp-adapter";

export type CreateRelayChannelFabricOptions = {
  relayBaseUrl: string;
  WebSocketCtor?: typeof WebSocket;
};

/** One WebSocket per DID — today’s default product fabric. */
export function createRelayChannelFabric(opts: CreateRelayChannelFabricOptions): ChannelFabric {
  const relayBaseUrl = opts.relayBaseUrl.trim().replace(/\/$/, "");
  if (relayBaseUrl.length === 0) {
    throw new Error("createRelayChannelFabric: relayBaseUrl is required");
  }
  const WebSocketCtor = opts.WebSocketCtor ?? WebSocket;

  return {
    async ensureAttached(args): Promise<ChannelFabricEnsureAttachedResult> {
      const cc = new RelayClient({ relayBaseUrl, signer: args.signer });
      const ticket = await cc.mintTicket(args.channelId);
      return {
        webSocketUrl: ticket.webSocketUrl,
        webSocketNonce: ticket.upgradeNonce,
        lastBlobId: ticket.lastBlobId,
      };
    },

    async openFrameChannel(args): Promise<OpenFabricFrameChannelResult> {
      const webSocketUrl = args.webSocketUrl?.trim();
      if (webSocketUrl === undefined || webSocketUrl.length === 0) {
        throw new Error("RelayChannelFabric.openFrameChannel: webSocketUrl is required");
      }
      const nonce = args.webSocketNonce?.trim();
      const webSocketProtocols =
        nonce !== undefined && nonce.length > 0 ? [relayWsUpgradeProtocol(nonce)] : undefined;
      const handle = await openRelayByteDuplex({
        webSocketUrl: webSocketUrlWithReplay(webSocketUrl, args.lastBlobId),
        webSocketProtocols,
        WebSocketCtor,
      });
      let frameCount = 0;
      const channel = {
        async *read() {
          for await (const chunk of handle.channel.read()) {
            frameCount++;
            yield chunk;
          }
        },
        write: (bytes: Uint8Array) => handle.channel.write(bytes),
        close: (reason?: unknown) => handle.channel.close(reason),
      };
      return {
        channel,
        getFrameCount: () => frameCount,
        close: () => handle.dispose(),
      };
    },
  };
}

/** Bind allocate checks to a concrete signer (optional convenience). */
export function createRelayChannelFabricForSigner(
  opts: CreateRelayChannelFabricOptions & { signer: PersistableSigner },
): ChannelFabric {
  const base = createRelayChannelFabric(opts);
  const cc = new RelayClient({
    relayBaseUrl: opts.relayBaseUrl.trim().replace(/\/$/, ""),
    signer: opts.signer,
  });
  return {
    ensureAttached: (args) => base.ensureAttached(args),
    openFrameChannel: (args) => base.openFrameChannel(args),
    isSessionAllocated: (channelId, sessionId) => cc.isSessionAllocated(channelId, sessionId),
  };
}
