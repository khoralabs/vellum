# Vellum persistence

Operational contract for [`VellumPersistence`](./core/types.ts).

## Layout

| Path | Role |
|------|------|
| [`./core`](./core) | Abstract interface (no driver) |
| [`./sqlite`](./sqlite) | Reference Bun `bun:sqlite` implementation |

## Ops

- `ensureSchema` — idempotent DDL for `vellum_*` tables
- `upsertChain` — insert-or-ignore on `session_id`
- `upsertRosterEntry` / `getRosterActor` — principal → actor pubkey
- `upsertPreKeySecrets` / `loadPreKeySecrets` — SPK + OTK private halves
- `upsertSessionKey` — per-session key material
- `listChains` — ordered snapshot for control plane / client
- `listOffers` / `readOffer` / `listPortIdsForOffer` / `readPort` — OBP graph reads

Session, control, and `VellumClient` depend only on the interface. Default wiring uses `createVellumPersistence(db)` on the channel OBP SQLite file (session) or `createVellumPersistenceAtPath(path)` (client). Default SQLite access requires Bun (`bun:sqlite`).
