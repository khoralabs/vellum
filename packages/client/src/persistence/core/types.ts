/**
 * Session bookkeeping persistence (chains, roster, prekeys, session keys).
 * Orthogonal to `@khoralabs/obp-core/sqlite` NBC graph tables.
 * Implementations must not leak driver types into session/control callers.
 */
export interface VellumMetaPersistence {
  ensureSchema(): void;

  upsertChain(sessionId: string, genesisHash: string, createdMs: number): void;

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

  /** List chain rows for control-plane snapshots. */
  listChains(): Array<{ session_id: string; genesis_hash: string; created_ms: number }>;
}
