import { buildCommandHelpTextMap, style } from "@khoralabs/cli-kit";

import { allCommandHelp } from "./help/index";

const PROGRAM = "vellum";

export const commandHelpTextMap = buildCommandHelpTextMap(allCommandHelp, PROGRAM);

export function printHelp(): void {
  console.error(`${style.bold(`${PROGRAM} — NBC tools for Vellum channels`)}

Create channels on the Vellum channel-relay; run a local daemon per channel for chains/offers/ports.

Usage:
  ${PROGRAM} help [<command> ...]
  ${PROGRAM} keygen [--agent-key-path=…] [--force] [--json]
  ${PROGRAM} channel create ...
  ${PROGRAM} channel join ...              # roster admission only (prints JSON)
  ${PROGRAM} channel connect <id> …        # daemon + WS (idempotent)
  ${PROGRAM} channel attach …|--all        # join+connect, one channel, or all local
  ${PROGRAM} list [--data-dir=…] [--json]  # all local channels (multi-channel overview)
  ${PROGRAM} disconnect <channelId> …      # channel id required (positional)
  ${PROGRAM} connect …                     # shorthand for channel connect
  ${PROGRAM} [--channel=<id>] chain create ...
  ${PROGRAM} [--channel=id] chain list | chain snapshot
  ${PROGRAM} [--channel=id] offer list | offer read <id> | offer send-turn ...
  ${PROGRAM} [--channel=id] port list <offerId> | port read <portId>
  ${PROGRAM} [--channel=id] policy read <portId> | policy validate <portId> --json=...
  ${PROGRAM} setup [--force] [--json]

Env / config: VELLUM_BASE_URL / --base-url / relayBaseUrl (channel-relay HTTP origin)
Identity: VELLUM_AGENT_KEY_PATH / --agent-key-path (default ~/.vellum/identity.json)
Channel id per command: positional <channelId> or --channel=<id> (see command --help)

Run \`${PROGRAM} <command> --help\` for per-command interactive vs flag usage.`);
}
