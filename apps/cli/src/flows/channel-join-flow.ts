import type { FlagMap } from "@khoralabs/cli-kit";
import { strFlag } from "@khoralabs/cli-kit";
import { requireFlowString, runFlow } from "@khoralabs/cli-kit/flow";

import type { VellumCliContext } from "./context";
import { channelJoinFlowDefinition } from "./definitions";

/**
 * Resolve invite token from flags or readline when absent / empty.
 */
export async function promptInviteTokenIfMissing(
  ctx: VellumCliContext,
  flags: FlagMap,
): Promise<string> {
  const fromFlag = strFlag(flags, "invite-token") ?? strFlag(flags, "inviteToken");
  const seed = fromFlag !== undefined && fromFlag.trim().length > 0 ? fromFlag.trim() : undefined;
  const row = await runFlow({
    readLine: ctx.readLine,
    def: channelJoinFlowDefinition,
    partialSeeds: {
      inviteToken: seed,
    },
  });
  return requireFlowString(row, "inviteToken", "channel join requires --invite-token=<token>");
}
