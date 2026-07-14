import { homedir } from "node:os";
import path from "node:path";

/**
 * Final fallback identity file when env/config `agentKeyPath` is unset.
 * Default: `~/.vellum/identity.json`.
 */
export function defaultAgentIdentityPath(): string {
  return path.join(homedir(), ".vellum", "identity.json");
}
