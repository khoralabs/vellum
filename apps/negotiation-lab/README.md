# Negotiation lab — Itex–Cypress OBP benchmark

Minimal in-process experiment for whether agents **autonomously** converge on efficient OBP negotiation while repeatedly bargaining in the ANAC 2010 **Itex–Cypress** domain. A convention is an observed side effect of raw OBP turns, not a requested output.

This app does **not** use Vellum relay/daemon/MLS/discovery. It drives `@khoralabs/obp-core` in-memory persistence and `@khoralabs/obp-nbc` turn APIs with AI Gateway policies, scoped Markdown memory, full prior chains, and harness-observed offer/port libraries.

## Domain attribution

Canonical issues and manufacturer/buyer utilities are normalized from the NegMAS ANAC 2010 `ItexvsCypress` Genius-compatible XML (see [`fixtures/itex-cypress.json`](fixtures/itex-cypress.json) for URLs and SHA-256 checksums). Citation: Baarslag et al., *The First Automated Negotiating Agents Competition (ANAC 2010)*.

Roles:

| DID | Profile | Party |
| --- | --- | --- |
| `did:lab:a` | `manufacturer` | Itex Manufacturing |
| `did:lab:b` | `buyer` | Cypress Cycles |
| `did:lab:c` | `buyer_transfer` | Lab transfer buyer (Cypress evaluations, reordered weights) |

Each agent sees public issue values plus **only its own** private weights/evaluations/reservation. Opponent utilities are never revealed. Agreements are reconstructed after the fact from bound ports (payload fields and `const` / single-value `enum` constraints)—agents are not told how to encode offers.

## Research question

Do agents with persistent scoped memory and prior OBP chains reach valid Itex–Cypress deals in fewer turns than matched resets—without being told to form a convention or how to structure OBP?

## Hypotheses (measured live, not CI assertions)

1. **H1 dyad efficiency:** Persistent A↔B late-three mean turns fall at least one turn below reset late-three mean, with negative persistent turn slope, agreement rate not worse than reset by >10pp, and role utilities within 5% of reset medians.
2. **H2 cross-peer transfer:** Trained A↔C reaches a valid deal faster than fresh A↔C while keeping reservation utilities, with higher graph/library similarity to late A↔B and no leak of B’s private profile.

## Arms (one CLI run)

| Arm | Episodes | Memory |
| --- | --- | --- |
| Persistent | `ab-persistent-baseline`, `ab-persistent-repeat-1..N`, then `ac-trained` | Persist chains + libraries under `arms/persistent/` |
| Reset | `ab-reset-1..(N+1)` | Blank both agents before every episode under `arms/reset/` |
| Fresh transfer | `ac-fresh-control` | Blank A and C under `arms/fresh/` |

`--arm-order memory-first|reset-first` counterbalances temporal drift across replications.

## OBP is the means, not a prescribed protocol

Agents negotiate only via OBP/NBC turns. There is no separate propose/accept domain action layer. Terminal binds end the episode; the harness scores the DAG afterward.

### OpenAI turn adapter

Live AI policies do **not** send free-form `payload_json` strings. Canonical OBP [`continueTurnSchemaForPorts`](https://github.com/khoralabs/open-binding-protocol) already inlines each peer port’s `bind_policy`, but uses `oneOf` (rejected by OpenAI structured outputs). The lab keeps a local adapter in [`src/openai-turn-adapter.ts`](src/openai-turn-adapter.ts) that:

1. reads the canonical continue schema’s bind branches;
2. rewrites them to a **nested `anyOf`** (leave | bind with `portId.const` + adapted payload schema) — never `oneOf`, never nullable all-null slots;
3. on continue, runs **two** structured-output calls (bind-or-leave, then optional extend) and merges into one NBC `ContinueTurn`;
4. opening remains a single leave-or-extend call;
5. decodes through the canonical OBP schema before NBC wire commit.

Authored `bind_policy` properties use a discriminated constraint (`free` | `enum` | `const`) plus per-property `required`, so required keys cannot drift from declared properties. Policies are compile-checked with OBP `validateBindPolicyAtExpose` before exposure. Peer policies that remain OpenAI-incompatible (e.g. conflicting `const`/`enum`) are omitted from step-1 bind branches; `leave` always remains. Canonical OBP still validates the chosen bind payload.

Continue turns always bind exactly one peer port unless leaving (price of offering). Opening is extend-only.

**Follow-up:** this adapter is a prototype. A later OBP release should ship an OpenAI-friendly schema helper or promote this adapter into `@khoralabs/obp-nbc` (or a companion package).

## Agent context

Each turn includes:

- public issues/values and the actor’s private goal/utility;
- a structured **deal validity constraints** JSON placeholder (`kind: deal_validity`) for what counts as a valid deal (future reserved object/statespace);
- post-hoc oracle **deal validity evaluations** (`kind: deal_validity_evaluation`) on prior experiences and in reflection (viewer-scoped; no peer utility);
- current graph and bindable peer ports;
- **all** complete prior chains for that agent (including cross-peer);
- scoped Markdown notes (`general.md` + current peer only).

Harness-observed offer/port libraries are written under each agent for analysis. They do **not** replace full chains in the prompt and do not constrain vocabulary.

## CLI

```bash
# from vellum repo root (Bun loads root .env)
bun run apps/negotiation-lab/src/cli.ts \
  --domain itex-cypress \
  --model openai/gpt-4.1-mini \
  --repeats 5 \
  --max-turns 12 \
  --arm-order memory-first \
  --run-id itex-cypress-001
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--model` | required (or `AGENT_DEFAULT_MODEL`) | AI Gateway model id |
| `--domain` | `itex-cypress` | Only `itex-cypress` is supported |
| `--repeats` | `5` | A↔B repeats after baseline |
| `--max-turns` | `12` | NBC turn cap per episode |
| `--timeout-ms` | `180000` | Episode wall timeout |
| `--arm-order` | `memory-first` | `memory-first` or `reset-first` |
| `--run-id` | timestamp | Artifact folder name |
| `--purpose` | Itex–Cypress contract task | Negotiation purpose text |

Requires `AI_GATEWAY_API_KEY`. Paid model calls are **opt-in only** (not run in CI).

## Artifacts

Under `.data/negotiation-lab/<run-id>/`:

- `episodes.jsonl` — outcomes, turns, agreement scores, tokens, signatures, graphs
- `summary.json` / `summary.md` — turn-first and utility metrics
- `libraries/<arm>/<did>.json` — harness offer/port libraries
- `arms/.../agents/<did>/experiences/chains.jsonl` — full prior chains
- `arms/.../agents/<did>/experiences/index.jsonl` — compact index
- Markdown notes under `general.md` / `peers/`

## Primary metrics

- Turns to valid agreement; late-three means; turn slopes; agreement/no-deal rates
- Secondary: utilities, welfare, Nash product, Pareto distance, protocol similarity, library reuse, tokens as cost

## Deterministic tests

```bash
bun test apps/negotiation-lab
```

Covers fixture size (180), utility/Pareto scoring, agreement reconstruction, raw turn shapes, full-chain context, libraries, and arm isolation. No Gateway calls.
