# `@khoralabs/vellum-contracts`

Zod-backed types and helpers shared by the Vellum **CLI**, **daemon**, and **`@khoralabs/vellum-client`**. Covers control-plane response shapes, domain rows (chains, offers, ports), path conventions (`vellumStoreRoot`, `channelDir`, `channelSqlitePath`), and constants such as default genesis turn wire.

Default local layout: `{dataDir}/vellum/channels/<channelId>/{vellum.json,obp.sqlite}`.

**Normative behavior** lives in [`../spec/channel-relay-deployment.md`](../spec/channel-relay-deployment.md) (deployment), [`../spec/channel-control-protocol.md`](../spec/channel-control-protocol.md) (control plane), and [`.brain/technical/channel-lifecycle.md`](../../../.brain/technical/channel-lifecycle.md). Channel/session HTTP types live in `@khoralabs/relay-contracts`.

Dependency-light: **`zod`** only. No Bun-specific APIs — safe to import anywhere in the workspace.

## Scripts

- `bun test` — schema/unit tests
- `bun run typecheck` — `tsc --noEmit`

Barrel: [`src/index.ts`](src/index.ts) re-exports [`control-wire.ts`](src/control-wire.ts), [`domain.ts`](src/domain.ts), [`paths.ts`](src/paths.ts).
