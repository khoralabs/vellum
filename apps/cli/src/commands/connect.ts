import type { FlagMap } from "@khoralabs/cli-kit";
import type { VellumConnectResult } from "@khoralabs/vellum-client";
import { promptChannelIdIfMissing } from "../flows/connect-flow";
import type { VellumCliContext } from "../flows/context";
import { makeVellumClient } from "../flows/context";

export function printChannelConnectResult(channelId: string, result: VellumConnectResult): void {
  if (result === "already-running") {
    console.log(`already connected to channel ${channelId}`);
    return;
  }
  console.log(
    `connected to channel ${channelId} — vellum daemon started; control port in channel data dir (vellum.json)`,
  );
}

export async function connectChannel(
  flags: FlagMap,
  channelId: string,
  opts?: { webSocketUrl?: string; upgradeNonce?: string },
): Promise<VellumConnectResult> {
  const client = makeVellumClient(flags, channelId);
  return client.connect({
    webSocketUrl: opts?.webSocketUrl,
    upgradeNonce: opts?.upgradeNonce,
  });
}

export async function handleConnect(
  ctx: VellumCliContext,
  positional: string[],
  flags: FlagMap,
  opts?: {
    /** Index into `positional` for `<channelId>` (`1` for `vellum connect`, `2` for `vellum channel connect`). */
    channelPositionalIndex?: number;
    webSocketUrl?: string;
    upgradeNonce?: string;
  },
): Promise<void> {
  const idx = opts?.channelPositionalIndex ?? 1;
  const fromPositional = positional[idx]?.trim();

  const channelId = await promptChannelIdIfMissing(ctx, flags, fromPositional);
  const result = await connectChannel(flags, channelId, {
    webSocketUrl: opts?.webSocketUrl,
    upgradeNonce: opts?.upgradeNonce,
  });
  printChannelConnectResult(channelId, result);
}
