import z from "zod";

/**
 * Shared Vellum app config (CLI + daemon). All fields optional — unset means
 * fall back to command-line flags / env / built-in defaults in each app.
 */
export const zVellumAppConfigBase = z
  .object({
    $schema: z.string().optional(),
    relayBaseUrl: z.string().min(1).optional().describe("Vellum channel-relay HTTP origin"),
    dataDir: z
      .string()
      .min(1)
      .optional()
      .describe("Vellum channel data root (SQLite + vellum.json under …/vellum/channels/…)"),
    agentKeyPath: z
      .string()
      .min(1)
      .optional()
      .describe("Path to Ed25519 identity JSON (see did-key-identity)"),
    defaultChannelWebSocketUrl: z
      .string()
      .min(1)
      .optional()
      .describe("Default channel WebSocket URL when env not set"),
    daemonJson: z.boolean().optional().describe("JSON log lines from vellum-daemon"),
  })
  .strict();

export type VellumAppConfigBase = z.infer<typeof zVellumAppConfigBase>;
