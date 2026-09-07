# @khoralabs/vellum

Vellum monorepo: NBC channel CLI, daemon, and client libraries.

## Setup

```bash
bun run submodules:init   # vendor/libs
bun install
```

Workspace packages come from this repo (`apps/*`, `packages/*`) plus `vendor/libs` (`cli-kit`, …). OBP is `@khoralabs/obp-core` / `@khoralabs/obp-nbc` / `@khoralabs/obp-wire` from npm.

## Format / husky

```bash
bun run format          # Biome write
bun run format:check    # Biome check
bun run typecheck       # tsc across @khoralabs/vellum-* packages
```

Husky **pre-push** runs `format:check` and `typecheck`. CI (`.github/workflows/ci.yml`) runs the same plus first-party tests.

## Negotiation lab

Minimal convention-formation experiment (in-memory OBP/NBC + AI Gateway policy): [`apps/negotiation-lab/README.md`](apps/negotiation-lab/README.md).

```bash
bun test apps/negotiation-lab
bun run apps/negotiation-lab/src/cli.ts --model openai/gpt-4.1-mini --repeats 2
```

## Release

Publish prebuilt CLI/daemon packages with the **release vellum-cli** workflow (`workflow_dispatch` on GitHub). Requires `NPM_TOKEN`. For Homebrew sync to [`khoralabs/homebrew-tap`](https://github.com/khoralabs/homebrew-tap), also set `HOMEBREW_TAP_TOKEN`.

To publish CLI skills to [`khoralabs/skills`](https://github.com/khoralabs/skills) once `apps/cli/assets/skills/vellum-cli/` exists, set `SKILLS_REPO_TOKEN` (fine-grained PAT with **Contents: Write** on that repo only) and run the separate **publish-vellum-cli-skills** workflow after release. Until the skill tree is authored, that workflow no-ops. Destination path: `skills/vellum-cli/`.

```bash
brew tap khoralabs/tap
brew install vellum
```
