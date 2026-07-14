import type { CommandHelp } from "@khoralabs/cli-kit";

const policyChannelNote = "Channel id required: --channel=<id>.";

export const policyReadHelp: CommandHelp = {
  command: "policy read",
  summary: "Read policy snapshot for a port",
  args: `vellum [--channel=<id>] policy read <portId>

${policyChannelNote}`,
};

export const policyValidateHelp: CommandHelp = {
  command: "policy validate",
  summary: "Validate a payload against a port policy",
  args: `vellum [--channel=<id>] policy validate <portId> --json='<payload>'

${policyChannelNote}`,
};
