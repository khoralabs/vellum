# homebrew-tap (vellum)

Canonical Homebrew formula for [Vellum](https://github.com/khoralabs/vellum) CLI tools.
Formulae are published to the shared [`khoralabs/homebrew-tap`](https://github.com/khoralabs/homebrew-tap) repo.

## Install

```bash
brew tap khoralabs/tap
brew install vellum
```

This installs `vellum` and `vellum-daemon` on your PATH and runs `vellum setup` once to seed `~/.vellum/` config templates.

## Updating the formula

On each `vellum-cli` release, CI:

1. Uploads platform tarballs to [GitHub Releases](https://github.com/khoralabs/vellum/releases)
2. Rewrites `Formula/vellum.rb` with the new version and `sha256`
3. Pushes to [`khoralabs/homebrew-tap`](https://github.com/khoralabs/homebrew-tap) when `HOMEBREW_TAP_TOKEN` is configured

## Repository secret

| Secret | Purpose |
| --- | --- |
| `HOMEBREW_TAP_TOKEN` | PAT or GitHub App token with `contents: write` on `khoralabs/homebrew-tap` |

If unset, release CI still updates the formula in this repo; sync to the tap repo is manual until the secret is added.
