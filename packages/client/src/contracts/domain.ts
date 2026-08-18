/**
 * Vellum-facing projections (daemon persistence + SQLite reads).
 */

export type VellumPartyRow = { id: string; name: string };

export type VellumOfferRow = {
  id: string;
  type: string;
  nbc_expires_turn: number;
  nbc_expires_at_ms: number;
};

export type VellumPortRow = {
  id: string;
  kind: string;
  promise: string;
  ref: string;
  nbc_expires_turn: number;
  nbc_expires_at_ms: number;
  bind_policy: unknown | null;
};

export type VellumChainRow = {
  session_id: string;
  genesis_hash: string;
  created_ms: number;
  /** Party that opened the chain (empty until known). */
  initiator_did: string;
};

export type VellumSession = {
  session_id: string;
  genesis_hash: string;
};

export type VellumChain = VellumChainRow;

export type VellumOffer = VellumOfferRow;

export type VellumPort = VellumPortRow;

export type VellumPolicySnapshot = unknown | null;
