# `@khoralabs/vellum-client`

Library API for Vellum: channel/relay ops, local daemon control, NBC graph reads, wire contracts, and control transport.

## Exports

| Path | Role |
|------|------|
| `@khoralabs/vellum-client` | `VellumClient`, channel helpers, config, contracts, Node SQLite reads |
| `@khoralabs/vellum-client/session` | Bun session runner (`runVellumSession`) + control HTTP |
| `@khoralabs/vellum-client/sqlite` | Bun `createVellumMetaPersistence` reference store |
| `@khoralabs/vellum-client/persistence` | `VellumMetaPersistence` contract types |

CLI and daemon are thin shells over this package. Sealed identities: pass `signer` or `identitySecret` / `VELLUM_IDENTITY_WRAP_KEY`.
