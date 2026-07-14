import type { FlagMap } from "@khoralabs/cli-kit";
import { boolFlag, strFlag } from "@khoralabs/cli-kit";
import { RelayClient } from "@khoralabs/relay-client";
import type { RelaySessionQuota } from "@khoralabs/relay-contracts";
import { listLocalVellumRows } from "@khoralabs/vellum-client";
import { resolveAttachInviteToken } from "../flows/channel-attach-flow";
import { promptInviteTokenIfMissing } from "../flows/channel-join-flow";
import {
  cliRelayBaseUrl,
  dataDirForEnv,
  loadSigner,
  resolveChannelId,
  type VellumCliContext,
} from "../flows/context";
import { connectChannel, handleConnect, printChannelConnectResult } from "./connect";

function parseSessionLimit(raw: string | undefined): RelaySessionQuota | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const s = raw.trim();
  const colon = s.indexOf(":");
  if (colon < 0) throw new Error("session-limit must be global:N or principal:N");
  const mode = s.slice(0, colon).trim();
  const measure = Number.parseInt(s.slice(colon + 1).trim(), 10);
  if (!Number.isFinite(measure) || measure <= 0) {
    throw new Error("session-limit measure must be a positive integer");
  }
  if (mode === "global") return { mode: "global", measure };
  if (mode === "principal") return { mode: "principal", measure };
  throw new Error("session-limit mode must be global or principal");
}

export async function handleChannelCreate(flags: FlagMap): Promise<void> {
  const ttlRaw = strFlag(flags, "ttl-ms") ?? strFlag(flags, "ttlMs") ?? "";
  const maxPopRaw = strFlag(flags, "max-population") ?? strFlag(flags, "maxPopulation");
  const sessionLimitRaw =
    strFlag(flags, "session-limit") ??
    strFlag(flags, "sessionLimit") ??
    strFlag(flags, "chain-limit") ??
    strFlag(flags, "chainLimit");

  const body: {
    ttlMs?: number;
    maxPopulation?: number;
    maxSessions?: RelaySessionQuota;
  } = {};

  if (ttlRaw.length > 0) {
    const n = Number.parseInt(ttlRaw, 10);
    if (!Number.isFinite(n)) throw new Error("ttl-ms must be a number");
    body.ttlMs = n;
  }
  if (maxPopRaw !== undefined && maxPopRaw.length > 0) {
    const n = Number.parseInt(maxPopRaw, 10);
    if (!Number.isFinite(n) || n <= 0) throw new Error("max-population must be a positive integer");
    body.maxPopulation = n;
  }
  const sessionLimit = parseSessionLimit(sessionLimitRaw);
  if (sessionLimit !== undefined) body.maxSessions = sessionLimit;

  const signer = await loadSigner(flags);
  const cc = new RelayClient({ relayBaseUrl: cliRelayBaseUrl(flags), signer });
  const out = await cc.createChannel(body);
  console.log(JSON.stringify(out, null, 2));
}

export async function handleChannelJoin(ctx: VellumCliContext, flags: FlagMap): Promise<void> {
  const inviteToken = await promptInviteTokenIfMissing(ctx, flags);
  const signer = await loadSigner(flags);
  const cc = new RelayClient({ relayBaseUrl: cliRelayBaseUrl(flags), signer });
  const out = await cc.joinChannel({ inviteToken });
  console.log(JSON.stringify(out, null, 2));
}

export async function handleChannelConnect(
  ctx: VellumCliContext,
  positional: string[],
  flags: FlagMap,
): Promise<void> {
  await handleConnect(ctx, positional, flags, { channelPositionalIndex: 2 });
}

/**
 * Join (when invited) then connect, or connect directly when channel id is already known.
 * See `channel attach` help for when to use attach vs join vs connect.
 */
export async function handleChannelAttach(
  ctx: VellumCliContext,
  positional: string[],
  flags: FlagMap,
): Promise<void> {
  if (boolFlag(flags, "all")) {
    await handleChannelAttachAll(flags);
    return;
  }

  const channelFromPositional = positional[2]?.trim();
  const knownChannelId = resolveChannelId(flags, channelFromPositional);
  const inviteFromFlag = strFlag(flags, "invite-token") ?? strFlag(flags, "inviteToken");
  if (
    inviteFromFlag !== undefined &&
    inviteFromFlag.trim().length > 0 &&
    knownChannelId.length > 0
  ) {
    throw new Error("channel attach: use --invite-token or a channel id, not both");
  }

  const inviteToken = await resolveAttachInviteToken(ctx, flags, {
    promptIfMissing: knownChannelId.length === 0,
  });

  if (inviteToken !== undefined) {
    const signer = await loadSigner(flags);
    const cc = new RelayClient({ relayBaseUrl: cliRelayBaseUrl(flags), signer });
    const joinOut = await cc.joinChannel({ inviteToken });
    const result = await connectChannel(flags, joinOut.channelId, {
      webSocketUrl: joinOut.webSocketUrl,
      upgradeNonce: joinOut.upgradeNonce,
    });
    printChannelConnectResult(joinOut.channelId, result);
    return;
  }

  await handleConnect(ctx, positional, flags, { channelPositionalIndex: 2 });
}

async function handleChannelAttachAll(flags: FlagMap): Promise<void> {
  const invite = strFlag(flags, "invite-token") ?? strFlag(flags, "inviteToken");
  if (invite !== undefined && invite.trim().length > 0) {
    throw new Error("channel attach --all cannot be combined with --invite-token");
  }

  const rows = listLocalVellumRows({ dataDir: dataDirForEnv(flags) });
  const needAttach = rows.filter((r) => r.status !== "running");
  if (needAttach.length === 0) {
    if (rows.length === 0) {
      console.log("(no local channels under vellum/channels/)");
    } else {
      console.log("all local channels already connected");
    }
    return;
  }

  for (const row of needAttach) {
    const result = await connectChannel(flags, row.channelId);
    printChannelConnectResult(row.channelId, result);
  }
}
