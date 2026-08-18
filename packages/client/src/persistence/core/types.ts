import type { VellumChainRow, VellumOfferRow, VellumPortRow } from "../../contracts";

/**
 * Channel store persistence: vellum_* bookkeeping plus OBP graph reads.
 * Orthogonal to `@khoralabs/obp-core/sqlite` NBC graph writers.
 * Implementations must not leak driver types into session/control/client callers.
 */
export interface VellumPersistence {
  ensureSchema(): void;

  upsertChain(
    sessionId: string,
    genesisHash: string,
    createdMs: number,
    initiatorDid?: string,
  ): void;

  getChain(sessionId: string): VellumChainRow | undefined;

  upsertRosterEntry(principalUri: string, actorPubkey: string, updatedMs: number): void;

  getRosterActor(principalUri: string): string | undefined;

  upsertPreKeySecrets(
    spkId: number,
    spkPrivHex: string,
    otks: Array<{ otkId: number; otkPrivHex: string }>,
    updatedMs: number,
  ): void;

  loadPreKeySecrets(otkId: number | null): { spkPriv: Uint8Array; otkPriv?: Uint8Array };

  upsertSessionKey(sessionId: string, sessionKeyHex: string, updatedMs: number): void;

  listChains(): VellumChainRow[];

  listOffers(): VellumOfferRow[];

  readOffer(offerId: string): VellumOfferRow | undefined;

  listPortIdsForOffer(offerId: string): string[];

  readPort(portId: string): VellumPortRow | undefined;
}
