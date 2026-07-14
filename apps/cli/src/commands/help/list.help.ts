import type { CommandHelp } from "@khoralabs/cli-kit";

export const listHelp: CommandHelp = {
  command: "list",
  summary: "List all local Vellum channels and per-channel daemon status (multi-channel overview)",
  args: `vellum list [--data-dir=…] [--json]

Scans vellum/channels/* — no channel id argument. Use before vellum channel attach --all.`,
};
