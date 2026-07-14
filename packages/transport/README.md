# `@khoralabs/vellum-transport`

Thin **`fetch`-style** abstraction for the Vellum daemon **control HTTP** server (`VellumControlTransport`). **`FetchVellumControlTransport`** resolves a base URL (typically `http://127.0.0.1:<controlPort>`) and forwards paths; **`createVellumControlTransportFromEnv`** wires env overrides.

Documented extension point for future transports (Unix domain socket, in-process) behind the same interface.

## Scripts

- `bun test` — transport tests
- `bun run typecheck` — `tsc --noEmit`

Exports: [`src/index.ts`](src/index.ts) → [`control-http.ts`](src/control-http.ts).
