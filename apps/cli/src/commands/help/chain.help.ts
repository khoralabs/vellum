import type { CommandHelp } from "@khoralabs/cli-kit";

const chainChannelNote = `Channel id required: --channel=<id>.`;

export const chainCreateHelp: CommandHelp = {
  command: "chain create",
  summary: "Create NBC chain state with a peer",
  args: `vellum [--channel=<id>] chain create --peer-party=<uuid> --peer-key=<hex> --peer-did=<did> [--genesis-json='<JSON>'|@path] [--session][--genesis][--my-party]

${chainChannelNote}`,
};

export const chainListHelp: CommandHelp = {
  command: "chain list",
  summary: "List chains from local store",
  args: `vellum [--channel=<id>] chain list

${chainChannelNote}`,
};

export const chainSnapshotHelp: CommandHelp = {
  command: "chain snapshot",
  summary: "Print current chain snapshot",
  args: `vellum [--channel=<id>] chain snapshot

${chainChannelNote}`,
};
