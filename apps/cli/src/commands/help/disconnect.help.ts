import type { CommandHelp } from "@khoralabs/cli-kit";

export const disconnectHelp: CommandHelp = {
  command: "disconnect",
  summary: "Stop the local daemon for a channel (closes WebSocket only)",
  args: `vellum disconnect <channelId> [--data-dir=…]

Channel id required as positional argument.`,
};
