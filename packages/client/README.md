# `@khoralabs/vellum-client`

Library API for Vellum: channel/relay ops, local daemon control, NBC graph reads, wire contracts, and control transport.

## Exports

| Path | Role |
|------|------|
| `@khoralabs/vellum-client` | `VellumClient`, channel helpers, config, contracts, Node SQLite reads |
| `@khoralabs/vellum-client/pool` | `VellumPool` — bind/unbind/subscribe by `did`+`channelId` (in-process; Bun) |
| `@khoralabs/vellum-client/session` | Bun session runner (`runVellumSession`, `openVellumAttachment`) + control |
| `@khoralabs/vellum-client/sqlite` | Bun `createVellumMetaPersistence` reference store |
| `@khoralabs/vellum-client/persistence` | `VellumMetaPersistence` contract types |

`VellumPool` opens **one relay WebSocket per attachment** today; demux is host-side by `did`+`channelId`. Prefer it over spawning daemons when embedding many agents in one Bun process.

CLI and daemon are thin shells over this package. Sealed identities: pass `signer` or `identitySecret` / `VELLUM_IDENTITY_WRAP_KEY`.
