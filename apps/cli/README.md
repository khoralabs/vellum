# Vellum CLI

`vellum` drives NBC negotiation on Vellum **channels**: channel spawn on the channel-relay, local daemon for chains/offers/ports.

**Multiple channels in parallel** are normal — each channel gets its own daemon process and data directory under `vellum/channels/<channelId>/`. Pass `--channel=<id>` or a positional channel id on every command that targets a channel.

## Quick start

```bash
brew tap khoralabs/tap
brew install vellum

export VELLUM_BASE_URL=http://localhost:8790

vellum keygen
vellum channel create --json
vellum channel attach --invite-token=<token>   # first-time invitee: join + start daemon
vellum channel attach <otherChannelId>         # second parallel negotiation
vellum list                                    # all local channels + daemon status
vellum channel attach --all                    # re-attach every non-running local channel
```

### Channel commands

| Command | Purpose | Channel id |
|---------|---------|------------|
| `channel create` | Spawn channel on relay | Not required (creates new) |
| `channel join` | Roster admission only, print JSON | Not required (`--invite-token`) |
| `channel attach` | Join+connect, connect one, or `--all` | Positional or `--channel` when connecting |
| `channel connect` | Start daemon + WS (member) | Positional or `--channel` |

```bash
# Work on a specific channel (explicit id required)
vellum --channel <channelA> chain list
vellum --channel <channelB> offer list

# Re-attach after restart (idempotent — skips already-running daemons)
vellum channel attach <channelId>
vellum disconnect <channelId>
```

### Where channel id is required

| Commands | How to provide channel id |
|----------|---------------------------|
| `channel connect`, `connect`, `channel attach` | Positional `<channelId>` or `--channel=<id>` |
| `chain *`, `offer *`, `port *`, `policy *` | `--channel=<id>` |
| `disconnect` | Positional `<channelId>` only |
| `list`, `channel attach --all` | No channel id (scans all local channels) |
| `channel join`, `channel create` | No channel id |

## Env / config

| Variable / config | Role |
|----------|------|
| `VELLUM_BASE_URL` / `--base-url` / `relayBaseUrl` | Channel-relay HTTP origin (required for channel ops) |
| `VELLUM_DATA_DIR` | Data root; artifacts live under `…/vellum/channels/<id>/` |
| `VELLUM_STORE_ROOT` | Override artifact store root (default `{dataDir}/vellum`) |
| `VELLUM_AGENT_KEY_PATH` / `--agent-key-path` | Identity JSON (default `~/.vellum/identity.json`) |

See [`apps/vellum/README.md`](../README.md) and [`.brain/technical/vellum-channels.md`](../../../.brain/technical/vellum-channels.md).
