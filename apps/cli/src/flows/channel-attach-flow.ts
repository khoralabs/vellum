import type { FlagMap } from "@khoralabs/cli-kit";
import { strFlag } from "@khoralabs/cli-kit";
import { runFlow } from "@khoralabs/cli-kit/flow";

import type { VellumCliContext } from "./context";
import { channelAttachFlowDefinition } from "./definitions";

/** Invite token from flags, or optional readline prompt when attach has no channel id yet. */
export async function resolveAttachInviteToken(
  ctx: VellumCliContext,
  flags: FlagMap,
  opts?: { promptIfMissing?: boolean },
): Promise<string | undefined> {
  const fromFlag = strFlag(flags, "invite-token");
  if (fromFlag !== undefined && fromFlag.trim().length > 0) return fromFlag.trim();

  if (opts?.promptIfMissing !== true) return undefined;

  const row = await runFlow({
    readLine: ctx.readLine,
    def: channelAttachFlowDefinition,
  });
  const token = row.inviteToken?.trim();
  return token !== undefined && token.length > 0 ? token : undefined;
}
