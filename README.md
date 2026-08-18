# @khoralabs/vellum

Vellum monorepo: NBC channel CLI, daemon, and client libraries.

## Setup

```bash
bun run submodules:init   # vendor/libs
bun install
```

Workspace packages come from this repo (`apps/*`, `packages/*`) plus `vendor/libs` (`cli-kit`, …).

OBP packages are consumed from this checkout via workspace paths (`../open-binding-protocol/packages/*`) until `@khoralabs/obp-*` 0.2 is published.

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
