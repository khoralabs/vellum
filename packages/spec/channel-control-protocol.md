# Vellum channel control protocol

Normative description of the **HTTP control plane** for Vellum channels. Wire bindings live in [`@khoralabs/vellum-client`](../client/src/contracts/) (Zod). Event ordering is summarized in [`.brain/technical/channel-lifecycle.md`](../../.brain/technical/channel-lifecycle.md).

This spec covers **one multiplex per `channel_id`**. Each channel is a single nonce-gated byte stream, not a meta-hub of sub-channels.

**Deployment:** Production intent is **one container per channel** with OOB single-use join tokens — see [`channel-relay-deployment.md`](channel-relay-deployment.md). The reference [`channel-relay`](../../apps/vellum/channel-relay) app can run as a **multi-tenant pool** (many channels per process) for local dev.

---

## Layering

| Layer | Responsibility | Spec |
|-------|----------------|------|
| **Channel control** (this doc) | Principal auth, roster, admission, limits, chain slots, WS attach credentials | Here + contracts |
| **Frame multiplex** | Length-prefixed JSON, `SessionInit`, `Frame`, optional `RelayEnvelope` | [`frame-protocol.smithy`](../../obp/frames/spec/model/frame-protocol.smithy), [`hub-protocol.smithy`](../../obp/frame-relay/spec/model/hub-protocol.smithy) |
| **Frame relay store** | Pairing secret + opaque spool per `channel_id` | [`store.smithy`](../../obp/frame-relay/spec/model/store.smithy) |
| **NBC chains** | Bilateral negotiation DAG after `SessionInit` | [`negotiated-binding-convention.smithy`](../../obp/nbc/spec/model/negotiated-binding-convention.smithy) |

The relay is **opaque** to NBC semantics on the wire. It forwards bytes and stamps `relay_ts_ms` when hub policy applies.

---

## Principal authentication

All control-plane routes use **DID-signed HTTP**:

- Headers: `X-Agent-Did`, `X-Agent-Timestamp`, `X-Agent-Nonce`, `X-Agent-Signature`
- Canonical message: `METHOD\npath\ntimestamp\nnonce\nbodySha256`
- Freshness window: 60 seconds
- Nonce replay protection per DID

WS attach uses a separate **upgrade nonce** (`Sec-WebSocket-Protocol: vellum.nonce.<nonce>`). Principal auth and nonce auth are intentionally separate.

---

## Channel spawn (`POST /v1/channels`) — *pool profile only*

In the **single-channel container** profile, the orchestrator assigns `channel_id` at boot; this route returns 501. Pool reference app implements create below.

Creator receives a server-issued `channel_id` (UUID). Response includes:

- `webSocketUrl` — clean `GET .../ws` path (no query credentials)
- `upgradeNonce` — one-time WS upgrade nonce (60s TTL); sent as `Sec-WebSocket-Protocol: vellum.nonce.<nonce>`
- `policy` — frozen admission and limits
- `inviteToken` — single-use join token for OOB distribution to first peer

Optional body fields:

| Field | Semantics |
|-------|-----------|
| `ttlMs` | Channel lifetime; server caps at 7 days |
| `maxPopulation` | Optional positive integer. **If omitted, roster is unlimited.** If set, enforced on every join token redeem. |
| `maxChains` | Chain quota policy (see below) |

---

## Join and admission

### Canonical profile: single-use join token (OOB distribution)

The only roster join mechanism — both single-channel container and pool profiles:

1. A roster member mints a **single-use join token** (`POST .../join-tokens`, or `inviteToken` on pool create).
2. Token is distributed **out of band** to the recipient.
3. Recipient redeems via `POST /v1/channels/join` with `{ joinToken }` (DID-signed HTTP).
4. Relay enforces `maxPopulation` on redeem; response includes multiplex attach credentials (`webSocketUrl`, `upgradeNonce`).

There is no public discovery, open join, or join-request workflow.

---

## Roster

- Members are identified by **principal DID** (`did:key:…`).
- Creator is a member on create.
- Re-adding the same DID updates the existing row (idempotent).
- `POST /v1/channels/:id/ticket` requires roster membership.
- Roster membership does **not** imply an active WS connection.

---

## `maxPopulation`

- **Optional** at channel create.
- **If set:** reject new roster members when `count(members) >= maxPopulation` on join token redeem.
- **If unset:** unlimited roster size.
- **Not** used for WS connection counting in the protocol. Concurrent multiplex attachments are a separate operational concern.

---

## `maxChains` (orthogonal to population)

Discriminated policy — one mode per channel:

| Mode | Meaning |
|------|---------|
| `{ mode: "global", measure: N }` | At most N active bilateral chain slots channel-wide |
| `{ mode: "principal", measure: N }` | Each member gets chain quota N on join |

### Chain slots

- `POST /v1/channels/:id/chains/allocate` — body `{ counterpartyDid, sessionId }`
  - Caller and counterparty must be roster members (distinct DIDs).
  - Inserts active slot under `maxChains` rules.
- `GET /v1/channels/:id/chains/:sessionId` — member-only; `{ allocated: true, sessionId }` when slot is active (404 otherwise). Used by daemon `chain/init` gate.
- `POST /v1/channels/:id/chains/:sessionId/release` — either party may release.

**After allocate:** peers run bilateral `SessionInit` on the multiplex. NBC governs everything after init — this protocol does not define turns, binds, or termination.

---

## Multiplex attach

- `POST /v1/channels/:id/ws-nonce` — member-only; mints a one-time upgrade nonce + clean `webSocketUrl`.
- `GET /v1/channels/:id/ws` — admits via **one-time upgrade nonce** (`Sec-WebSocket-Protocol: vellum.nonce.<nonce>` or `X-Vellum-Upgrade-Nonce` header), replays spool, attaches peer.

**Transport:** use `wss://` in production. Nonces are single-use and short-lived; they do not appear in URL paths or Referer headers.

---

## HTTP routes (summary)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/channels` | Create channel *(pool only)* |
| POST | `/v1/channels/join` | Redeem join token → roster + attach creds |
| POST | `/v1/channels/:id/join-tokens` | Member mints join token for OOB distribution |
| POST | `/v1/channels/:id/chains/allocate` | Allocate bilateral slot |
| GET | `/v1/channels/:id/chains/:sessionId` | Chain slot status (member) |
| POST | `/v1/channels/:id/chains/:sessionId/release` | Release slot |
| POST | `/v1/channels/:id/ticket` | Mint ticket + upgrade nonce (member) |
| POST | `/v1/channels/:id/ws-nonce` | Mint upgrade nonce only (member) |
| GET | `/v1/channels/:id/ws` | Multiplex attach (`Sec-WebSocket-Protocol: vellum.nonce.<nonce>`) |
| GET | `/health` | Liveness — JSON `{ ok: true, version: 1 }` |

---

## Out of scope (this protocol version)

- Roster announce/query messages on the byte stream
- DAG rejoin descriptor after relay destroy
- Khora registration lookup on control plane
- Channel discovery / listing API
- Per-DID WS connection deduplication
- Smithy IDL for HTTP (optional future work)

Reference implementation: [`apps/vellum/channel-relay`](../../apps/vellum/channel-relay).
