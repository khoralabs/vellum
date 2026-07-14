# @khoralabs/vellum

Vellum monorepo: NBC channel CLI, daemon, and client libraries.

## Setup

```bash
bun run submodules:init   # vendor/obp, vendor/relay, vendor/libs
bun install
```

Workspace packages come from this repo (`apps/*`, `packages/*`) plus vendor submodules:

- `vendor/libs` — shared libs (`cli-kit`, …)
- `vendor/obp` — Open Binding Protocol packages
- `vendor/relay` — relay client / MLS / server packages

## Format / husky

```bash
bun run format          # Biome write
bun run format:check    # Biome check (also runs on git pre-push via husky)
```

## Typecheck

```bash
bun run --filter '@khoralabs/vellum-cli' typecheck
bun run --filter '@khoralabs/vellum-client' typecheck
bun run --filter '@khoralabs/vellum-daemon' typecheck
```

## Release

Publish prebuilt CLI/daemon packages with the **release vellum-cli** workflow (`workflow_dispatch` on GitHub). Requires the `NPM_TOKEN` repository secret.
