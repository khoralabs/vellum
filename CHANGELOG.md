# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `ChannelFabric` port (`session/core`) plus `createRelayChannelFabric` (1 WS per DID) and `createSharedUplinkChannelFabric` (shared uplink + local short-circuit; host `HostInclusion` for MLS skip).

### Changed

- **Breaking:** Unified `VellumMetaPersistence` and `VellumReadModel` into `VellumPersistence` (`createVellumPersistence` / `createVellumPersistenceAtPath`). Session/attachment option `meta` → `persistence`; `VellumClient` option `readPersistence` → `persistence`.
- Default channel SQLite access uses `bun:sqlite` only (no `better-sqlite3`).

### Removed

- `better-sqlite3` dependency and `SqliteVellumReadModel` / `VellumReadModel` / `VellumMetaPersistence` public surface.
- API Extractor from the client publish build (ship `tsc` declaration tree as `dist/index.d.ts`).

## [0.2.0] - 2026-08-13

### Added

- `@khoralabs/vellum-client/pool` — `VellumPool` for Khora-shaped in-process channel attachments (`bind` / `unbind` / `list` / `subscribe` / `handle` / `close` demux by `did` + `channelId`).
- `@khoralabs/vellum-client/session` — embeddable `runVellumSession`, `openVellumAttachment`, and shared control dispatch.
- `InProcessControlTransport` so hosts can drive control ops without loopback HTTP.
- `VellumClient` options `signer` and `identitySecret` (sealed identity load + wrap-key env for spawned daemons).
- Channel helpers on the client: `createChannel` / `joinChannel`, shared control-file IO, and identity load helpers.
- `VellumPersistence` contract plus Bun SQLite reference (`./persistence`, `./sqlite`) — unified meta bookkeeping and OBP graph reads.
- GitHub Actions CI (format, typecheck, tests) and husky pre-commit (Biome + typecheck).
- Agent-review commit-msg / operator skills integration.

### Changed

- **Breaking:** Folded `@khoralabs/vellum-contracts` and `@khoralabs/vellum-transport` into `@khoralabs/vellum-client` (subpaths `./contracts`, `./transport`). Separate workspace packages removed.
- **Breaking:** Channel session / control-plane runtime lives in the client; CLI and daemon are thin shells over the library.
- Relayed / OBP packages are normal npm dependencies instead of git submodules (`vendor/relay`, `vendor/obp` removed).
- Workspace package exports resolve TypeScript sources for typecheck; release staging still publishes `dist/` entrypoints (including `./pool`).
- Root `typecheck` deletes `packages/client/dist` first so CI and local runs cannot pass on a stale build.

### Fixed

- Concurrent `VellumPool.bind` for the same attachment no longer leaks duplicate sessions; in-flight bind is cancelled cleanly on `unbind` / `close`.
- `VellumPool` rejects empty `dataDirRoot`.
- `runVellumSession` rejects `ready` when SQLite/directory setup fails (no hang).
- Spawned daemon child is `unref()`’d after control plane is ready; `close()` during startup rejects `ready`.
- Daemon binary resolution prefers `VELLUM_DAEMON_BIN`, then `@khoralabs/vellum-daemon`, then monorepo entry when present.

### Removed

- Workspace packages `@khoralabs/vellum-contracts` and `@khoralabs/vellum-transport`.
- Legacy config/CLI aliases (e.g. camelCase flag aliases, `baseUrl` → `relayBaseUrl` mapping, deprecated `runVellumDaemon` alias).

## [0.1.0] - 2026-07-15

### Added

- Initial `@khoralabs/vellum-client` release (daemon control POST + SQLite reads).

[unreleased]: https://github.com/khoralabs/vellum/compare/vellum-client-v0.2.0...HEAD
[0.2.0]: https://github.com/khoralabs/vellum/compare/vellum-client-v0.1.0...vellum-client-v0.2.0
[0.1.0]: https://github.com/khoralabs/vellum/releases/tag/vellum-client-v0.1.0
