import type { VellumChainRow, VellumOfferRow, VellumPortRow } from "@khoralabs/vellum-contracts";

/**
 * Read side of persisted NBC / vellum metadata for one channel store.
 * Implementations may use SQLite, remote APIs, or mocks — {@link VellumClient} does not embed SQL.
 */
export interface VellumReadModel {
  listChains(): VellumChainRow[];
  listOffers(): VellumOfferRow[];
  readOffer(offerId: string): VellumOfferRow | undefined;
  listPortIdsForOffer(offerId: string): string[];
  readPort(portId: string): VellumPortRow | undefined;
}
