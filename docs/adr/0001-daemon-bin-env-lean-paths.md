# ADR 0001: Daemon bin/env only; lean path exports

## Status

Accepted

## Context

Bundlers resolve `new URL("../../../../apps/daemon/...", import.meta.url)` as a
static dependency. Path-only hosts imported `./pool/host` and pulled spawn/session.

## Decision

We will resolve the daemon only via `VELLUM_DAEMON_BIN` or `@khoralabs/vellum-daemon`
package bin, and export filesystem helpers at `@khoralabs/vellum-client/paths`
without importing the client/daemon/session graph.

## Consequences

### Positive

- Client builds stay free of monorepo-only paths.
- Lean imports for disk layout without shared-uplink weight.

### Negative

- Monorepo/dev must set env or rely on the workspace package bin.

### Neutral

- `./pool/host` still re-exports `vellumPoolAttachmentDataDir` for compatibility.
