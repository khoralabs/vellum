# `@khoralabs/vellum-client`

Library API for Vellum: channel/relay ops, local daemon control, NBC graph reads, and `VellumChain` (`open` → `turns` → `commit`).

## Host loop

Channel attach (`connect` / pool bind) is not chain init. Open a chain, generate against the Standard Schema on `turn.schema`, commit.

```ts
import { VellumChain, VellumClient } from "@khoralabs/vellum-client";

const client = new VellumClient({ relayBaseUrl, channelId });
await client.connect();
const chain = await VellumChain.open(client, { peer });
for await (const turn of chain.turns()) {
  if (turn.youAct) {
    const body = await generate(turn.schema); // opening | continue | leave
    await chain.commit(body);
  }
}
```

`expires_at_ms: 0` (default) means no wall-clock expiry — use that for model-driven loops. Leave maps to `END_OFFERS`; `chain.close()` sends `TERMINATE` and releases the relay slot.

## Exports

| Path | Role |
|------|------|
| `@khoralabs/vellum-client` | `VellumClient`, channel helpers, config, contracts (default SQLite reads need Bun) |
| `@khoralabs/vellum-client/paths` | Lean path helpers (`channelSqlitePath`, `vellumPoolAttachmentDataDir`, …) — no spawn/session |
| `@khoralabs/vellum-client/pool` | `VellumPool` — bind/unbind/subscribe by `did`+`channelId` (in-process; Bun) |
| `@khoralabs/vellum-client/pool/host` | Shared-uplink pool factory (heavy; prefer `./paths` for path-only imports) |
| `@khoralabs/vellum-client/session` | Bun session runner (`runVellumSession`, `openVellumAttachment`) + control |
| `@khoralabs/vellum-client/sqlite` | Bun `createVellumPersistence` / `createVellumPersistenceAtPath` |
| `@khoralabs/vellum-client/persistence` | `VellumPersistence` contract types |

Daemon spawn resolves `VELLUM_DAEMON_BIN`, then the `@khoralabs/vellum-daemon` package bin — never a relative monorepo `apps/daemon` URL.

`VellumPool` opens **one relay WebSocket per attachment** today; demux is host-side by `did`+`channelId`. Prefer it over spawning daemons when embedding many agents in one Bun process.

CLI and daemon are thin shells over this package. Sealed identities: pass `signer` or `identitySecret` / `VELLUM_IDENTITY_WRAP_KEY`.
