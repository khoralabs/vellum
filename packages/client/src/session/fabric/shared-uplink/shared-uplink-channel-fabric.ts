import type { PersistableSigner } from "@khoralabs/did-key-identity";
import { RelayClient } from "@khoralabs/relay/client";
import { relayWsUpgradeProtocol } from "@khoralabs/relay/contracts";
import { withRelayClientErrors } from "../../../relay-client-errors";
import type {
  ChannelFabric,
  ChannelFabricEnsureAttachedResult,
  ChannelFabricSessionReadyContext,
  ChannelFabricSessionReadyResult,
  FabricByteChannel,
  OpenFabricFrameChannelResult,
} from "../../core/fabric";
import { openRelayByteDuplex, webSocketUrlWithReplay } from "../../relay/obp-adapter";
import { LocalChannelBus } from "./local-bus";

export type HostInclusion = {
  isOnHost(did: string): boolean | Promise<boolean>;
};

export type OpenSharedUplinkFn = (args: {
  channelId: string;
  webSocketUrl: string;
  webSocketNonce?: string;
  lastBlobId?: number;
  signer: PersistableSigner;
}) => Promise<{ channel: FabricByteChannel; dispose(): void }>;

export type CreateSharedUplinkChannelFabricOptions = {
  relayBaseUrl: string;
  inclusion: HostInclusion;
  /** Injectable uplink opener for tests; default opens a real relay WebSocket. */
  openUplink?: OpenSharedUplinkFn;
  WebSocketCtor?: typeof WebSocket;
};

const MAX_PENDING_ECHOES = 128;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

type HubState = {
  bus: LocalChannelBus;
  refCount: number;
  uplink: { channel: FabricByteChannel; dispose(): void } | undefined;
  uplinkOpen: Promise<void> | undefined;
  uplinkReadStarted: boolean;
  /** Recent local→uplink frames awaiting relay echo; suppressed on ingress. */
  pendingEchoes: Uint8Array[];
  /** Relay spool advance: uplink writes + non-echo uplink reads. */
  relaySequence: number;
};

/**
 * Many local DIDs share one relay WebSocket per channelId.
 * Local writes short-circuit to other local endpoints and also go to the uplink.
 * Uplink echoes of those writes are suppressed so peers are not double-delivered.
 */
export function createSharedUplinkChannelFabric(
  opts: CreateSharedUplinkChannelFabricOptions,
): ChannelFabric {
  const relayBaseUrl = opts.relayBaseUrl.trim().replace(/\/$/, "");
  if (relayBaseUrl.length === 0) {
    throw new Error("createSharedUplinkChannelFabric: relayBaseUrl is required");
  }
  const hubs = new Map<string, HubState>();

  const defaultOpenUplink: OpenSharedUplinkFn = async (args) => {
    const nonce = args.webSocketNonce?.trim();
    const webSocketProtocols =
      nonce !== undefined && nonce.length > 0 ? [relayWsUpgradeProtocol(nonce)] : undefined;
    return openRelayByteDuplex({
      webSocketUrl: webSocketUrlWithReplay(args.webSocketUrl, args.lastBlobId),
      webSocketProtocols,
      WebSocketCtor: opts.WebSocketCtor ?? WebSocket,
    });
  };
  const openUplink = opts.openUplink ?? defaultOpenUplink;

  function getHub(channelId: string): HubState {
    let hub = hubs.get(channelId);
    if (hub === undefined) {
      hub = {
        bus: new LocalChannelBus(),
        refCount: 0,
        uplink: undefined,
        uplinkOpen: undefined,
        uplinkReadStarted: false,
        pendingEchoes: [],
        relaySequence: 0,
      };
      hubs.set(channelId, hub);
    }
    return hub;
  }

  function noteLocalUplinkSend(hub: HubState, bytes: Uint8Array): void {
    hub.pendingEchoes.push(bytes.slice());
    if (hub.pendingEchoes.length > MAX_PENDING_ECHOES) {
      hub.pendingEchoes.shift();
    }
    hub.relaySequence++;
  }

  function consumeLocalEcho(hub: HubState, bytes: Uint8Array): boolean {
    const idx = hub.pendingEchoes.findIndex((p) => bytesEqual(p, bytes));
    if (idx < 0) return false;
    hub.pendingEchoes.splice(idx, 1);
    return true;
  }

  async function ensureUplink(
    hub: HubState,
    channelId: string,
    args: {
      signer: PersistableSigner;
      webSocketUrl?: string;
      webSocketNonce?: string;
      lastBlobId?: number;
    },
  ): Promise<void> {
    if (hub.uplink !== undefined) return;
    if (hub.uplinkOpen !== undefined) {
      await hub.uplinkOpen;
      if (hub.uplink === undefined) {
        throw new Error("SharedUplinkChannelFabric: uplink open failed");
      }
      return;
    }
    const webSocketUrl = args.webSocketUrl?.trim();
    if (webSocketUrl === undefined || webSocketUrl.length === 0) {
      throw new Error("SharedUplinkChannelFabric: webSocketUrl required to open uplink");
    }
    const opening = (async () => {
      const uplink = await openUplink({
        channelId,
        webSocketUrl,
        webSocketNonce: args.webSocketNonce,
        lastBlobId: args.lastBlobId,
        signer: args.signer,
      });
      hub.uplink = uplink;
      if (!hub.uplinkReadStarted) {
        hub.uplinkReadStarted = true;
        void (async () => {
          try {
            for await (const chunk of uplink.channel.read()) {
              if (consumeLocalEcho(hub, chunk)) {
                // Echo of a local short-circuited write — do not double-deliver.
                continue;
              }
              hub.relaySequence++;
              hub.bus.pushFromUplink(chunk);
            }
          } catch {
            /* uplink closed */
          } finally {
            hub.bus.closeAll();
            if (hub.uplink === uplink) {
              hub.uplink = undefined;
            }
            hub.uplinkReadStarted = false;
            hub.uplinkOpen = undefined;
          }
        })();
      }
    })();
    hub.uplinkOpen = opening;
    try {
      await opening;
    } catch (e) {
      hub.uplinkOpen = undefined;
      throw e;
    }
  }

  function release(channelId: string, hub: HubState): void {
    hub.refCount = Math.max(0, hub.refCount - 1);
    if (hub.refCount > 0) return;
    hub.uplink?.dispose();
    hub.uplink = undefined;
    hub.uplinkOpen = undefined;
    hub.uplinkReadStarted = false;
    hub.pendingEchoes = [];
    hub.bus.closeAll();
    hubs.delete(channelId);
  }

  return {
    async ensureAttached(args): Promise<ChannelFabricEnsureAttachedResult> {
      const cc = new RelayClient({ relayBaseUrl, signer: args.signer });
      const ticket = await withRelayClientErrors(() => cc.mintTicket(args.channelId));
      return {
        webSocketUrl: ticket.webSocketUrl,
        webSocketNonce: ticket.upgradeNonce,
        lastBlobId: ticket.lastBlobId,
      };
    },

    async openFrameChannel(args): Promise<OpenFabricFrameChannelResult> {
      const channelId = args.channelId.trim();
      const hub = getHub(channelId);
      hub.refCount++;
      try {
        await ensureUplink(hub, channelId, args);
      } catch (e) {
        hub.refCount--;
        if (hub.refCount === 0) hubs.delete(channelId);
        throw e;
      }

      const ep = hub.bus.addEndpoint();
      const sequenceBaseline = hub.relaySequence;
      let closed = false;

      const channel: FabricByteChannel = {
        read: () => ep.read(),
        write: async (bytes) => {
          hub.bus.deliverFromLocal(ep.id, bytes);
          const uplink = hub.uplink;
          if (uplink === undefined) {
            throw new Error("SharedUplinkChannelFabric: uplink not open");
          }
          noteLocalUplinkSend(hub, bytes);
          try {
            await uplink.channel.write(bytes);
          } catch (e) {
            const idx = hub.pendingEchoes.findIndex((p) => bytesEqual(p, bytes));
            if (idx >= 0) {
              hub.pendingEchoes.splice(idx, 1);
            }
            hub.relaySequence = Math.max(0, hub.relaySequence - 1);
            throw e;
          }
        },
        close: async (reason) => {
          ep.close(reason);
        },
      };

      return {
        channel,
        getFrameCount: () => ep.getFrameCount(),
        getRelaySequenceDelta: () => Math.max(0, hub.relaySequence - sequenceBaseline),
        close: () => {
          if (closed) return;
          closed = true;
          ep.close();
          release(channelId, hub);
        },
      };
    },

    async onSessionReady(
      ctx: ChannelFabricSessionReadyContext,
    ): Promise<ChannelFabricSessionReadyResult | undefined> {
      if (ctx.peerDid === undefined) return;
      const onHost = await Promise.resolve(opts.inclusion.isOnHost(ctx.peerDid));
      if (onHost) {
        return { skipDefaultMlsWelcome: true };
      }
    },
  };
}
