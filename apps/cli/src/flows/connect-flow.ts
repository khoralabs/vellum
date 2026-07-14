import type { FlagMap } from "@khoralabs/cli-kit";
import { requireFlowString, runFlow } from "@khoralabs/cli-kit/flow";

import { resolveChannelId, type VellumCliContext } from "./context";
import { connectFlowDefinition } from "./definitions";

/**
 * Resolve channel id from flags, positional, env, or readline when missing.
 */
export async function promptChannelIdIfMissing(
  ctx: VellumCliContext,
  flags: FlagMap,
  positionalChannel: string | undefined,
): Promise<string> {
  const pre = resolveChannelId(flags, positionalChannel);
  const row = await runFlow({
    readLine: ctx.readLine,
    def: connectFlowDefinition,
    partialSeeds: {
      channelId: pre.length > 0 ? pre : undefined,
    },
  });
  return requireFlowString(
    row,
    "channelId",
    "--channel <channelId> or positional <channelId> is required",
  );
}
