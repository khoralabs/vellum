# Vellum packages

Shared libraries for **Vellum**: NBC session tooling on channels — contracts for control/domain wires, channel-relay HTTP client, and transport primitives for daemon control.

| Package | Role |
|---------|------|
| [`contracts/`](contracts) | `@khoralabs/vellum-contracts` — Zod wires, paths (`vellum/channels/`), control payloads |
| [`client/`](client) | `@khoralabs/vellum-client` | `VellumClient`, `VellumChannelClient`, config, SQLite reads |
| [`transport/`](transport) | `@khoralabs/vellum-transport` | Daemon control HTTP transport |

NBC bind-payload validation lives in the OBP submodule: `@khoralabs/nbc-bind-policy` (`packages/obp/packages/bind-policy`).
