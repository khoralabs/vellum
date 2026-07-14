import type { CommandHelp } from "@khoralabs/cli-kit";

const offerChannelNote = "Channel id required: --channel=<id>.";

export const offerListHelp: CommandHelp = {
  command: "offer list",
  summary: "List offers for the current channel",
  args: `vellum [--channel=<id>] offer list

${offerChannelNote}`,
};

export const offerReadHelp: CommandHelp = {
  command: "offer read",
  summary: "Read one offer by id",
  args: `vellum [--channel=<id>] offer read <offerId>

${offerChannelNote}`,
};

export const offerSendTurnHelp: CommandHelp = {
  command: "offer send-turn",
  summary: "Send an NBC turn body for a session",
  args: `vellum [--channel=<id>] offer send-turn --session=<id> --json='<JSON>'|--json=@path.json

${offerChannelNote}`,
};
