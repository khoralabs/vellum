import type { CommandHelp } from "@khoralabs/cli-kit";

import { CHANNEL_ID_RESOLUTION_HELP } from "./channel-id";

export const channelCreateHelp: CommandHelp = {
  command: "channel create",
  summary: "Create a Vellum channel on the channel-relay",
  args: `vellum channel create [--ttl-ms=<n>] [--max-population=<n>] [--session-limit=global:N|principal:N] [--base-url=…]

Does not require a channel id (creates a new one).`,
};

export const channelJoinHelp: CommandHelp = {
  command: "channel join",
  summary:
    "Roster admission only — redeem an invite token and print join metadata (does not start the daemon)",
  wizard: `vellum channel join`,
  args: `vellum channel join --invite-token=<t> [--base-url=…] [--data-dir=…]

Requires --invite-token (or wizard prompt). Does not take a channel id.
Use when you only need to join the channel roster or inspect join JSON before connecting.
Does not open a WebSocket or start the local vellum daemon.`,
};

export const channelConnectHelp: CommandHelp = {
  command: "channel connect",
  summary:
    "Runtime attachment only — start the local daemon and open a WebSocket for a channel you already belong to",
  wizard: `vellum channel connect
# prompts for channel id when none is given on the CLI or via --channel.`,
  args: `vellum channel connect <channelId> [--base-url=…] [--ws-url=…] [--data-dir=…]
vellum channel connect --channel=<id> …

Channel id required (positional or --channel).
Idempotent: skips spawn when vellum.json exists and the daemon pid is alive.
Assumes roster membership. Use after join, or when you are the creator.

${CHANNEL_ID_RESOLUTION_HELP}`,
};

export const channelAttachHelp: CommandHelp = {
  command: "channel attach",
  summary: "Join + connect in one step, re-attach one channel, or re-attach all local channels",
  wizard: `vellum channel attach
# prompts for invite token when neither token nor channel id is on the CLI or via --channel.`,
  args: `vellum channel attach --invite-token=<t> [--base-url=…] [--data-dir=…]
vellum channel attach <channelId> [--base-url=…] [--ws-url=…] [--data-dir=…]
vellum channel attach --channel=<id> …
vellum channel attach --all [--base-url=…] [--data-dir=…]

Branching:
  --invite-token  → join roster, then start daemon (one-shot for new invitees)
  <channelId>     → connect only (alias for channel connect when id is known)
  --all           → re-attach every local channel under vellum/channels/ that is not running

Idempotent per channel: running daemons are left as-is ("already connected").
Prefer attach for the common “I have an invite and want to negotiate” flow.
Use join alone when you only need roster admission JSON.

${CHANNEL_ID_RESOLUTION_HELP}`,
};
