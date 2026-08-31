import path from "node:path";

import type {
  ChainInitResponse,
  ChainSnapshot,
  ChainStateResponse,
  VellumChainRow,
} from "../index";
import { createSharedUplinkChannelFabric } from "../session";
import { VellumPool } from "./vellum-pool";

/** Per-DID Vellum channel ops returned by {@link wrapVellumPoolClient}. */
export type VellumHandle = {
  connect(options?: {
    webSocketUrl?: string;
    upgradeNonce?: string;
  }): Promise<"spawned" | "already-running">;
  disconnect(): void;
  chainCreate(input: {
    counterpartyDid: string;
    sessionId?: string;
    genesisHash?: string;
    genesisTurn?: Record<string, unknown>;
  }): Promise<ChainInitResponse>;
  chainRelease(sessionId: string): Promise<void>;
  endOffers(sessionId: string): Promise<void>;
  sendTurn(sessionId: string, body: Record<string, unknown>): Promise<void>;
  getChainSnapshot(): Promise<ChainStateResponse>;
  getSessionSnapshot(sessionId: string): Promise<ChainSnapshot>;
  listChains(): VellumChainRow[];
};

export type SharedUplinkVellumPoolOptions = {
  relayBaseUrl: string;
  dataDirRoot: string;
  isOnHost?: (did: string) => boolean;
};

export function createSharedUplinkVellumPool(opts: SharedUplinkVellumPoolOptions): VellumPool {
  const isOnHost = opts.isOnHost ?? (() => true);
  return new VellumPool({
    relayBaseUrl: opts.relayBaseUrl,
    dataDirRoot: opts.dataDirRoot,
    fabric: createSharedUplinkChannelFabric({
      relayBaseUrl: opts.relayBaseUrl,
      inclusion: { isOnHost },
    }),
  });
}

export function wrapVellumPoolClient(
  pool: VellumPool,
  did: string,
  channelId: string,
): VellumHandle {
  const ref = { did, channelId };
  const client = () => pool.handle(ref);
  return {
    connect: async () => "already-running",
    disconnect: () => {
      void pool.unbind(ref);
    },
    chainCreate: (i) => client().chainCreate(i),
    chainRelease: (s) => client().chainRelease(s),
    endOffers: (s) => client().endOffers(s),
    sendTurn: (s, b) => client().sendTurn(s, b),
    getChainSnapshot: () => client().getChainSnapshot(),
    getSessionSnapshot: (s) => client().getSessionSnapshot(s),
    listChains: () => client().listChainsFromStore(),
  };
}

/** Matches `VellumPool` attachment data dirs. */
export function vellumPoolAttachmentDataDir(
  dataDirRoot: string,
  did: string,
  channelId: string,
): string {
  return path.join(
    path.resolve(dataDirRoot),
    encodeURIComponent(did),
    encodeURIComponent(channelId),
  );
}
