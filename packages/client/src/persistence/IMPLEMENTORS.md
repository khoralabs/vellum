# Vellum meta persistence

Operational contract for [`VellumMetaPersistence`](./core/types.ts).

## Layout

| Path | Role |
|------|------|
| [`./core`](./core) | Abstract interface (no driver) |
| [`./sqlite`](./sqlite) | Reference Bun `bun:sqlite` implementation |
| [`vellum-read-persistence.ts`](./vellum-read-persistence.ts) | Separate NBC graph **read** model for Node/`better-sqlite3` |

## Ops

- `ensureSchema` — idempotent DDL for `vellum_*` tables
- `upsertChain` — insert-or-ignore on `session_id`
- `upsertRosterEntry` / `getRosterActor` — principal → actor pubkey
- `upsertPreKeySecrets` / `loadPreKeySecrets` — SPK + OTK private halves
- `upsertSessionKey` — per-session key material
- `listChains` — ordered snapshot for control plane

Session and control code must depend only on the interface. Default wiring uses `createVellumMetaPersistence(db)` on the channel OBP SQLite file.
