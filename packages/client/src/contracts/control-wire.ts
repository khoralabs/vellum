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
  /** Opening expose-only turn. Omit to init an empty graph (first TURN is genesis). */
  genesis_turn: GenesisTurnWireSchema.optional(),
});

export type ChainInitRequest = z.infer<typeof ChainInitRequestSchema>;

export const TurnRequestSchema = z.object({
  sessionId: z.string(),
  body: z.record(z.string(), z.unknown()),
});

export type TurnRequest = z.infer<typeof TurnRequestSchema>;

export const EndOffersRequestSchema = z.object({
  sessionId: z.string(),
});

export const ChainInitResponseSchema = z.object({
  ok: z.literal(true),
  session_id: z.string(),
});

export type ChainInitResponse = z.infer<typeof ChainInitResponseSchema>;

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
