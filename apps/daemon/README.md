# `@khoralabs/vellum-daemon`

NBC channel daemon process entry. Session runtime lives in `@khoralabs/vellum-client`.

## Local / monorepo

```bash
bun run src/index.ts
# or
bun start
```

When `@khoralabs/vellum-client` spawns the daemon, resolution is:

1. `VELLUM_DAEMON_BIN` (absolute path to this entry or a compiled binary)
2. This package’s `bin` (`vellum-daemon` → `./src/index.ts` in the workspace; published meta packages ship a native launcher)

Set `VELLUM_DAEMON_BIN` in `.env` for explicit local control — see `.env.example`. Clients never embed a relative `apps/daemon` URL (bundler-safe).

## Env

See [`.env.example`](./.env.example) for channel, relay, and identity variables.
