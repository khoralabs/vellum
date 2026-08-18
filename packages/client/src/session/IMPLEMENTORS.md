# Vellum session

Operational contract for the channel session runner and local control plane.

## Layout

| Path | Role |
|------|------|
| [`./core`](./core) | Control dispatch types + abstract [`ChannelFabric`](./core/fabric.ts) port — no `Bun.serve`, no relay |
| [`./fabric`](./fabric) | Concrete fabrics (`RelayChannelFabric`, `SharedUplinkChannelFabric`) |
| [`./control-http`](./control-http) | Loopback HTTP adapter (`startVellumControlServer`) |
| [`./relay`](./relay) | Low-level relay WebSocket duplex + OBP connect helpers |
| [`./runner`](./runner) | Composition: `runVellumSession`, `openVellumAttachment` (depend on `ChannelFabric` only) |
| [`./testing`](./testing) | Test-only helpers (e.g. `testControlSigner`) |

Client-side control transports (`FetchVellumControlTransport`, `InProcessControlTransport`) live under [`../transport`](../transport). Session owns the **server-side** dispatch and HTTP serve; in-process hosts wrap the same dispatch via `InProcessControlTransport`.

**Dependency rule:** `core` must not import `control-http`, `fabric`, `relay`, or `runner`.

## Channel fabric

`ChannelFabric` is the abstract port for channel membership credentials and the byte bus used by OBP multiplex. Runner/pool take a fabric instance; they do not hardcode relay topology.

| Implementor | Role |
|-------------|------|
| `createRelayChannelFabric` | Today’s product default: one WebSocket per DID |
| `createSharedUplinkChannelFabric` | Custodial: many local DIDs share one uplink WS; optional host `HostInclusion` for peer-local MLS skips (see [`fabric/shared-uplink/README.md`](./fabric/shared-uplink/README.md)) |

## Control routes

Shared by HTTP serve and in-process dispatch:

| Method | Path | Role |
|--------|------|------|
| `GET` | `/health` | Liveness (`204`) |
| `GET` | `/chain` | Chain list + OBP graph summary counts |
| `GET` | `/chain/:sessionId` | Graph snapshot: `whoShouldAct`, `portsICanBind`, `needsTurn` |
| `GET` | `/events` | SSE: `committed` / `graph-advanced` / `your-turn` |
| `POST` | `/chain/init` | Outbound session init; optional `genesis_turn` (omit = empty graph) |
| `POST` | `/chain/end-offers` | `END_OFFERS` (leave) |
| `POST` | `/chain/close` | `TERMINATE` (chain.close) |
| `POST` | `/turn` | Send NBC turn on an open session |

## Runner wiring

`runVellumSession` always starts loopback HTTP (`Bun.serve` on `127.0.0.1:0`), writes the control file for spawned/`VellumClient` HTTP clients, **and** exposes `controlTransport` (`InProcessControlTransport` over the same dispatch) for embed hosts. Await `ready` before using the transport. Frame delivery goes through `opts.fabric` (default: relay fabric from `relayBaseUrl`).
