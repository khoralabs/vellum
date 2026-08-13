# Vellum session

Operational contract for the channel session runner and local control plane.

## Layout

| Path | Role |
|------|------|
| [`./core`](./core) | Shared control dispatch + types (`createVellumControlDispatch`) — no `Bun.serve` |
| [`./control-http`](./control-http) | Loopback HTTP adapter (`startVellumControlServer`) |
| [`./relay`](./relay) | Relay WebSocket → OBP frame multiplex (`connectObpOverRelay`) |
| [`./runner`](./runner) | Composition: `runVellumSession`, `openVellumAttachment` |
| [`./testing`](./testing) | Test-only helpers (e.g. `testControlSigner`) |

Client-side control transports (`FetchVellumControlTransport`, `InProcessControlTransport`) live under [`../transport`](../transport). Session owns the **server-side** dispatch and HTTP serve; in-process hosts wrap the same dispatch via `InProcessControlTransport`.

**Dependency rule:** `core` must not import `control-http`, `relay`, or `runner`.

## Control routes

Shared by HTTP serve and in-process dispatch:

| Method | Path | Role |
|--------|------|------|
| `GET` | `/health` | Liveness (`204`) |
| `GET` | `/chain` | Chain list + OBP graph summary counts |
| `POST` | `/chain/init` | Outbound session init + genesis turn |
| `POST` | `/turn` | Send turn on an open session |

## Runner wiring

Today `runVellumSession` always starts loopback HTTP (`Bun.serve` on `127.0.0.1:0`), writes the control file for spawned/`VellumClient` HTTP clients, **and** exposes `controlTransport` (`InProcessControlTransport` over the same dispatch) for embed hosts. Await `ready` before using the transport.
