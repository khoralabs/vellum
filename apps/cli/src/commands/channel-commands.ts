import type { FlagMap } from "@khoralabs/cli-kit";
import { strFlag } from "@khoralabs/cli-kit";
import { parseNbcTurnBody } from "@khoralabs/obp-nbc";

import type { VellumClient } from "@khoralabs/vellum-client";

import { makeVellumClient, readJsonArg, resolveChannelId } from "../flows/context";

function clientForChannelCommands(flags: FlagMap): VellumClient {
  const channelId = resolveChannelId(flags);
  if (channelId.length === 0) {
    throw new Error("--channel <channelId> is required");
  }
  return makeVellumClient(flags, channelId);
}

export async function handleChainCreate(flags: FlagMap): Promise<void> {
  const client = clientForChannelCommands(flags);
  const peerDid = strFlag(flags, "peer-did") ?? strFlag(flags, "peerDid");
  if (peerDid === undefined) {
    throw new Error("chain create requires --peer-did");
  }
  const genesisJson = strFlag(flags, "genesis-json") ?? strFlag(flags, "genesisJson");
  let genesisTurn: Record<string, unknown> | undefined;
  if (genesisJson !== undefined && genesisJson.length > 0) {
    const parsed = readJsonArg(genesisJson);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("chain create --genesis-json must be a JSON object");
    }
    genesisTurn = parsed as Record<string, unknown>;
  }
  const out = await client.chainCreate({
    counterpartyDid: peerDid,
    sessionId: strFlag(flags, "session"),
    genesisHash: strFlag(flags, "genesis"),
    ...(genesisTurn !== undefined ? { genesisTurn } : {}),
  });
  console.log(JSON.stringify(out, null, 2));
}

export function handleChainList(flags: FlagMap): void {
  const client = clientForChannelCommands(flags);
  console.log(JSON.stringify(client.listChainsFromStore(), null, 2));
}

export async function handleChainSnapshot(flags: FlagMap): Promise<void> {
  const client = clientForChannelCommands(flags);
  console.log(JSON.stringify(await client.getChainSnapshot(), null, 2));
}

export function handleOfferList(flags: FlagMap): void {
  const client = clientForChannelCommands(flags);
  console.log(JSON.stringify(client.listOffers(), null, 2));
}

export function handleOfferRead(positional: string[], flags: FlagMap): void {
  const client = clientForChannelCommands(flags);
  const id = positional[2]?.trim();
  if (id === undefined || id.length === 0) throw new Error("usage: vellum offer read <offerId>");
  console.log(JSON.stringify(client.readOffer(id) ?? null, null, 2));
}

export async function handleOfferSendTurn(flags: FlagMap): Promise<void> {
  const client = clientForChannelCommands(flags);
  const sessionId = strFlag(flags, "session");
  const js = strFlag(flags, "json");
  if (sessionId === undefined || js === undefined) {
    throw new Error("offer send-turn requires --session and --json");
  }
  const nb = parseNbcTurnBody(readJsonArg(js));
  await client.sendTurn(sessionId, JSON.parse(JSON.stringify(nb)) as Record<string, unknown>);
}

export function handlePortList(positional: string[], flags: FlagMap): void {
  const client = clientForChannelCommands(flags);
  const offerId = positional[2]?.trim();
  if (offerId === undefined) throw new Error("usage: vellum port list <offerId>");
  console.log(JSON.stringify(client.listPortsForOffer(offerId), null, 2));
}

export function handlePortRead(positional: string[], flags: FlagMap): void {
  const client = clientForChannelCommands(flags);
  const id = positional[2]?.trim();
  if (id === undefined) throw new Error("usage: vellum port read <portId>");
  console.log(JSON.stringify(client.readPort(id) ?? null, null, 2));
}

export function handlePolicyRead(positional: string[], flags: FlagMap): void {
  const client = clientForChannelCommands(flags);
  const id = positional[2]?.trim();
  if (id === undefined) throw new Error("usage: vellum policy read <portId>");
  console.log(JSON.stringify(client.readPolicySnapshot(id), null, 2));
}

export function handlePolicyValidate(positional: string[], flags: FlagMap): void {
  const client = clientForChannelCommands(flags);
  const id = positional[2]?.trim();
  const js = strFlag(flags, "json");
  if (id === undefined || js === undefined) {
    throw new Error("usage: vellum policy validate <portId> --json=...");
  }
  const payload = readJsonArg(js);
  console.log(JSON.stringify(client.validatePolicy(id, payload), null, 2));
}
