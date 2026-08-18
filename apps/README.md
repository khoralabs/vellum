# Vellum apps

Vellum provides NBC (negotiated-binding-convention) session tooling on **channels**: a long-running **daemon** per agent multiplexes frame channels over WebSocket to the Vellum channel-relay, and a **CLI** drives chains, offers, ports, and bind policy.

Agents commonly run **multiple channel daemons in parallel** — one process and SQLite store per `channelId` under `vellum/channels/<channelId>/`.

| App | Package | Role |
|-----|---------|------|
| [`channel-relay/`](channel-relay) | `@khoralabs/vellum-channel-relay` | Minimal Bun relay — DID-signed `/v1/channels` spawn API + in-memory frame hub |
| [`cli/`](cli) | `@khoralabs/vellum-cli` | `vellum` entrypoint — channel create/join/attach/connect, chain lifecycle, offers/ports, policy |
| [`daemon/`](daemon) | `@khoralabs/vellum-daemon` | Per-channel WebSocket holder + local HTTP control plane + SQLite OBP graph |

## Env

| Env | Target |
|-----|--------|
| `VELLUM_BASE_URL` | Channel-relay HTTP (`POST /v1/channels`, ticket mint) |
| `VELLUM_CHANNEL_WS_URL` | Daemon session (set by CLI on spawn) |
| `VELLUM_AGENT_KEY_PATH` | Identity JSON (default `~/.vellum/identity.json`) |

## Quick start

```bash
# Terminal 1 — relay
cd apps/vellum/channel-relay && bun run src/index.ts

# Terminal 2 — CLI
export VELLUM_BASE_URL=http://localhost:8790

vellum keygen
vellum channel create --json
vellum channel attach --invite-token=...
vellum channel attach <channelId>          # parallel channel
vellum list
vellum --channel <channelId> chain create --peer-did=... (--genesis-json=... | --init-only)
vellum channel attach --all                # re-attach all non-running local channels
```

See [`.brain/technical/vellum-channels.md`](../../.brain/technical/vellum-channels.md) for local data layout (`vellum/channels/<channelId>/`).
