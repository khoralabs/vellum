import type { PersistableSigner } from "@khoralabs/did-key-identity";
import { RelayClient } from "@khoralabs/relay/client";
import type { RelaySessionQuota } from "@khoralabs/relay/contracts";

export type { RelaySessionQuota };

export type CreateVellumChannelOptions = {
  relayBaseUrl: string;
  signer: PersistableSigner;
  ttlMs?: number;
  maxPopulation?: number;
  maxSessions?: RelaySessionQuota;
};

export type JoinVellumChannelOptions = {
  relayBaseUrl: string;
  signer: PersistableSigner;
  inviteToken: string;
};

/** Create a channel on the relay (DID-authenticated). */
export async function createVellumChannel(opts: CreateVellumChannelOptions) {
  const body: {
    ttlMs?: number;
    maxPopulation?: number;
    maxSessions?: RelaySessionQuota;
  } = {};
  if (opts.ttlMs !== undefined) body.ttlMs = opts.ttlMs;
  if (opts.maxPopulation !== undefined) body.maxPopulation = opts.maxPopulation;
  if (opts.maxSessions !== undefined) body.maxSessions = opts.maxSessions;
  const cc = new RelayClient({ relayBaseUrl: opts.relayBaseUrl, signer: opts.signer });
  return cc.createChannel(body);
}

/** Join a channel with an invite token. */
export async function joinVellumChannel(opts: JoinVellumChannelOptions) {
  const cc = new RelayClient({ relayBaseUrl: opts.relayBaseUrl, signer: opts.signer });
  return cc.joinChannel({ inviteToken: opts.inviteToken });
}
