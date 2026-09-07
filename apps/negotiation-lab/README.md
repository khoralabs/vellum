# Negotiation lab

Minimal in-process experiment for **convention formation** in bilateral NBC negotiations.

This app does **not** use Vellum relay/daemon/MLS/discovery. It drives `@khoralabs/obp-core` in-memory persistence and `@khoralabs/obp-nbc` turn APIs with the same open → snapshot → commit shape as `VellumChain`, plus an AI Gateway policy and scoped Markdown memory.

## Hypotheses (measured, not CI assertions)

1. **Repeated dyad:** Repeated A↔B negotiations for the same purpose develop a dyad-specific convention that reduces turns/tokens and stabilizes the resulting OBP protocol shape.
2. **Cross-peer influence:** A convention learned by A with B influences a later A↔C negotiation when only A’s **general** memory transfers and B-specific memory stays hidden.

A single live run is an experiment, not statistical proof of convergence.

## Conditions (one CLI run)

| Condition | Memory |
| --- | --- |
| `ab-baseline` | Fresh A and B |
| `ab-repeat-1..N` | Persistent A/B general + peer files |
| `ac-trained` | A keeps `general.md`; `peers/B.md` withheld; C blank |
| `ab-reset-control` | A and B memory cleared, then A↔B |
| `ac-fresh-control` | A and C blank, then A↔C |

## CLI

```bash
# from vellum repo root (Bun loads root .env)
bun run apps/negotiation-lab/src/cli.ts --model openai/gpt-4.1-mini --repeats 2 --max-turns 6
```

Or:

```bash
bun run --filter @khoralabs/vellum-negotiation-lab experiment:conventions -- --model openai/gpt-4.1-mini
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--model` | required (or `AGENT_DEFAULT_MODEL`) | AI Gateway model id |
| `--repeats` | `2` | A↔B repeats after baseline |
| `--max-turns` | `6` | NBC turn cap per episode |
| `--timeout-ms` | `180000` | Episode wall timeout |
| `--run-id` | timestamp | Artifact folder name |
| `--purpose` | built-in coordination prompt | Negotiation purpose text |

Requires `AI_GATEWAY_API_KEY`. Paid model calls are **opt-in only** (not run in CI).

## Artifacts

Written under `.data/negotiation-lab/<run-id>/` (gitignored via `.data`):

- `episodes.jsonl` — full provenance per episode (outcome, turns, tokens, protocol signature, memory diffs, graph)
- `summary.json` — rollup metrics
- `summary.md` — short human summary
- `agents/<did>/general.md` and `agents/<did>/peers/<peer>.md` — scoped memory

### Protocol signature

Normalized from the terminal `NbcChainGraph`:

- offer type/order (initiator vs counterparty)
- exposed port kinds/promises
- bind-policy required/property keys
- binder role
- bind-payload key shape

### Metrics

- A↔B turn/token trend
- within-dyad signature stability
- successful-bind rate
- trained vs fresh A↔C turn/token difference

## Deterministic tests

```bash
bun test apps/negotiation-lab
```

Covers scripted opening→bind, turn limits, protocol-signature stability, Markdown scope isolation, and fresh per-episode persistence. CI runs this suite; it does **not** call the AI Gateway.

## Interpretation limits

- Live outcomes depend on the model and sampling.
- One bounded run cannot claim statistical convergence.
- Memory is intentionally tiny Markdown notes, not a production memories stack.
