import type { CommandHelp } from "@khoralabs/cli-kit";

export const keygenHelp: CommandHelp = {
  command: "keygen",
  summary: "Generate a new Ed25519 agent identity (did:key) and save it to disk",
  args: `vellum keygen [--agent-key-path=…] [--force] [--json]
  Generates a fresh Ed25519 keypair and writes it to the agent key path.
  Exits with an error if a key already exists unless --force is passed.
  --agent-key-path  Override the identity file path (default: ~/.vellum/identity.json).
  --force, -f       Overwrite an existing identity file.
  --json            Print { did, path } as JSON.`,
};
