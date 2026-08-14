import type { PersistableSigner } from "@khoralabs/did-key-identity";

/** Opaque byte duplex used by OBP multiplex over a channel fabric. */
export type FabricByteChannel = {
  read(): AsyncIterable<Uint8Array>;
  write(bytes: Uint8Array): Promise<void>;
  close(reason?: unknown): Promise<void>;
};

export type OpenFabricFrameChannelResult = {
  channel: FabricByteChannel;
  /** Frames delivered to this attachment's read side (excludes filtered echoes when applicable). */
  getFrameCount: () => number;
  /**
   * Delta to add to ticket `lastBlobId` for control-file reconnect estimates.
   * When omitted, runners fall back to {@link getFrameCount}.
   * Shared-uplink fabrics exclude local short-circuit frames (they never hit the relay spool).
   */
  getRelaySequenceDelta?: () => number;
  close(): void;
};

export type ChannelFabricEnsureAttachedResult = {
  webSocketUrl?: string;
  webSocketNonce?: string;
  lastBlobId?: number;
};

export type ChannelFabricSessionReadyContext = {
  channelId: string;
  localDid: string;
  peerDid: string | undefined;
  sessionId: string;
};

export type ChannelFabricSessionReadyResult = {
  /** When true, runner skips built-in MLS welcome join for this session. */
  skipDefaultMlsWelcome?: boolean;
};

/**
 * Abstract channel fabric: membership credentials + frame byte channel for OBP multiplex.
 * Concrete topologies (1:1 relay WS, shared uplink, in-memory) implement this port.
 */
export type ChannelFabric = {
  ensureAttached(args: {
    channelId: string;
    signer: PersistableSigner;
  }): Promise<ChannelFabricEnsureAttachedResult>;

  openFrameChannel(args: {
    channelId: string;
    signer: PersistableSigner;
    webSocketUrl?: string;
    webSocketNonce?: string;
    lastBlobId?: number;
  }): Promise<OpenFabricFrameChannelResult>;

  isSessionAllocated?(channelId: string, sessionId: string): boolean | Promise<boolean>;

  /**
   * Optional hook after a multiplex session is ready.
   * Fabrics may return `{ skipDefaultMlsWelcome: true }` to own crypto bootstrap.
   */
  onSessionReady?(
    ctx: ChannelFabricSessionReadyContext,
  ): Promise<ChannelFabricSessionReadyResult | undefined>;
};
