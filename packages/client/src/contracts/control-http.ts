/** Control-plane HTTP path constants shared by dispatch and VellumClient. */

import { z } from "zod";

export const VELLUM_CONTROL_HTTP_PATH = {
  health: "/health",
  events: "/events",
  chain: "/chain",
  chainInit: "/chain/init",
  chainEndOffers: "/chain/end-offers",
  chainClose: "/chain/close",
  turn: "/turn",
} as const;

export type VellumControlHttpPathKey = keyof typeof VELLUM_CONTROL_HTTP_PATH;

/** Protocol version advertised on `GET /health`. */
export const VELLUM_CONTROL_PROTOCOL_VERSION = 1 as const;

export const zVellumControlHealth = z.object({
  ok: z.literal(true),
  version: z.literal(VELLUM_CONTROL_PROTOCOL_VERSION),
});

export type VellumControlHealth = z.infer<typeof zVellumControlHealth>;

export function vellumControlChainByIdPath(sessionId: string): string {
  return `${VELLUM_CONTROL_HTTP_PATH.chain}/${encodeURIComponent(sessionId)}`;
}

const CHAIN_PREFIX = `${VELLUM_CONTROL_HTTP_PATH.chain}/`;

const RESERVED_CHAIN_SUBPATHS = new Set(
  [
    VELLUM_CONTROL_HTTP_PATH.chainInit,
    VELLUM_CONTROL_HTTP_PATH.chainEndOffers,
    VELLUM_CONTROL_HTTP_PATH.chainClose,
  ].map((p) => p.slice(CHAIN_PREFIX.length)),
);

/** Match `GET /chain/:sessionId` (not `/chain/init` etc.). */
export function matchVellumControlChainSnapshotPath(pathname: string): string | undefined {
  if (!pathname.startsWith(CHAIN_PREFIX)) return undefined;
  const rest = pathname.slice(CHAIN_PREFIX.length);
  if (rest.length === 0 || rest.includes("/")) return undefined;
  if (RESERVED_CHAIN_SUBPATHS.has(rest)) return undefined;
  try {
    return decodeURIComponent(rest);
  } catch {
    return undefined;
  }
}
