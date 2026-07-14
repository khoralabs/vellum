/**
 * Daemon control-plane JSON over HTTP (`Bun.serve`).
 */
import { z } from "zod";

export const ChainInitWireSchema = z.object({
  session_id: z.string(),
  genesis_hash: z.string().regex(/^[0-9a-f]{64}$/),
  party_dids: z.tuple([z.string(), z.string()]),
  peer_identity_key: z.string().regex(/^[0-9a-f]{64}$/),
});

export type ChainInitWire = z.infer<typeof ChainInitWireSchema>;

/** NBC **`bind_payload`** shape validated downstream by daemon (`parseNbcTurnBody`). */
export const GenesisTurnWireSchema = z.record(z.string(), z.unknown());

export const ChainInitRequestSchema = z.object({
  init: ChainInitWireSchema,
  /** Opening multiplex initiator MUST supply genesis extend-offer + ≥1 port (no bind). */
  genesis_turn: GenesisTurnWireSchema,
});

export type ChainInitRequest = z.infer<typeof ChainInitRequestSchema>;

export const TurnRequestSchema = z.object({
  sessionId: z.string(),
  body: z.record(z.string(), z.unknown()),
});

export type TurnRequest = z.infer<typeof TurnRequestSchema>;

export const ChainInitResponseSchema = z.object({
  ok: z.literal(true),
  session_id: z.string(),
});

export type ChainInitResponse = z.infer<typeof ChainInitResponseSchema>;

/** Minimal genesis NBC body for CLI defaults / smoke tests (`expires_turn` values are placeholders). */
export const DEFAULT_GENESIS_TURN_WIRE: Record<string, unknown> = {
  offer: {
    id: "",
    expires_turn: 100,
    expires_at_relay_ms: 0,
    type: "step",
  },
  ports: [
    {
      id: "",
      type: "slot",
      promise: "vellum-genesis",
      expires_turn: 100,
      expires_at_relay_ms: 0,
      bind_policy: null,
      ref: "",
    },
  ],
  bind_port_id: "",
};

export const ChainStateResponseSchema = z.object({
  chains: z.array(
    z.object({
      session_id: z.string(),
      genesis_hash: z.string(),
    }),
  ),
  graphSummary: z
    .object({
      parties: z.number(),
      offers: z.number(),
      exposes: z.number(),
      binds: z.number(),
    })
    .optional(),
});

export type ChainStateResponse = z.infer<typeof ChainStateResponseSchema>;
