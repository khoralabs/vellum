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
bun run format:check    # Biome check
bun run typecheck       # tsc across @khoralabs/vellum-* packages
```

Husky **pre-push** runs `format:check` and `typecheck`. CI (`.github/workflows/ci.yml`) runs the same plus first-party tests.

## Release

Publish prebuilt CLI/daemon packages with the **release vellum-cli** workflow (`workflow_dispatch` on GitHub). Requires `NPM_TOKEN`. For Homebrew sync to [`khoralabs/homebrew-tap`](https://github.com/khoralabs/homebrew-tap), also set `HOMEBREW_TAP_TOKEN`.

```bash
brew tap khoralabs/tap
brew install vellum
```
