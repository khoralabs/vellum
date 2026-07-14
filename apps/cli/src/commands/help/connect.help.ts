import type { CommandHelp } from "@khoralabs/cli-kit";

import { CHANNEL_ID_RESOLUTION_HELP } from "./channel-id";

export const connectHelp: CommandHelp = {
  command: "connect",
  summary:
    "Shorthand for channel connect — re-attach to a known channel (starts local vellum daemon)",
  wizard: `vellum connect
# prompts for channel id when none is given on the CLI or via --channel.`,
  args: `vellum connect <channelId> [--base-url=…] [--ws-url=…]
vellum connect --channel=<id> …

Equivalent to vellum channel connect. Channel id required (positional or --channel).
Idempotent: skips spawn when the daemon for that channel is already running.
If you have an invite token and are joining for the first time, use vellum channel attach instead.
To re-attach every local channel at once, use vellum channel attach --all.

${CHANNEL_ID_RESOLUTION_HELP}`,
};
