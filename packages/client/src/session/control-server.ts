import type { Database } from "bun:sqlite";
import type { PersistableSigner } from "@khoralabs/did-key-identity";
import type { ObpPersistenceClient } from "@khoralabs/obp-core/persistence";
import { type NbcTurnBody, parseNbcTurnBody } from "@khoralabs/obp-nbc";
import {
  type FrameMultiplexOpenerApi,
  type FrameSessionHandle,
  normalizeSessionInit,
  sessionInitFromWire,
} from "@khoralabs/obp-wire";
import {
  ChainInitRequestSchema,
  type ChainInitResponse,
  type ChainStateResponse,
  TurnRequestSchema,
} from "../contracts";
import type { VellumPersistence } from "../persistence/core/types";

function parseGenesisTurnOrThrow(raw: Record<string, unknown>) {
  const nb = parseNbcTurnBody(raw);
  if (nb.ports.length < 1) {
    throw new TypeError("genesis_turn requires at least one exposed port");
  }
  if (nb.bind_port_id !== "") {
    throw new TypeError("genesis_turn must not include bind_port_id / bindPortId");
  }
  return nb;
}

export type VellumControlServerState = {
  /** Set when multiplex connection is ready — `conn.init` / `sendTurn` require this. */
  conn: FrameMultiplexOpenerApi | undefined;
  /** Per `session_id`, `FrameSessionHandle.sendTurn` bridge. */
  handles: Map<string, FrameSessionHandle>;
};

export type VellumControlDispatch = (req: Request) => Promise<Response>;

export type CreateVellumControlDispatchOptions = {
  state: VellumControlServerState;
  /** OBP sqlite for graph summary counts only (not vellum_* meta). */
  db: Database;
  /** Vellum bookkeeping + graph reads (named `meta` to avoid clashing with OBP `persistence`). */
  meta: VellumPersistence;
  persistence: ObpPersistenceClient;
  signer: PersistableSigner;
  myActorPubkeyHex: string;
  /** When set, chain/init requires a prior relay allocation for session_id. */
  isSessionAllocated?: (sessionId: string) => boolean | Promise<boolean>;
};

function serialize<T>(mut: { tail: Promise<void> }, run: () => Promise<T>): Promise<T> {
  const p = mut.tail.then(run);
  mut.tail = p.then(
    () => {},
    () => {},
  );
  return p;
}

function obpTableCount(db: Database, table: string): number {
  const row = db.query<{ c: number }, []>(`SELECT COUNT(*) AS c FROM ${table}`).get();
  return row?.c ?? 0;
}

/** Shared request handler for HTTP serve and {@link InProcessControlTransport}. */
export function createVellumControlDispatch(
  opts: CreateVellumControlDispatchOptions,
): VellumControlDispatch {
  const mux = { tail: Promise.resolve() };
  const { state, db, meta, persistence, isSessionAllocated, signer, myActorPubkeyHex } = opts;
  const myDid = signer.did;

  return async (req) => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return new Response(null, { status: 204 });
    }

    if (req.method === "GET" && url.pathname === "/chain") {
      const rows = meta.listChains();
      const chains = rows.map((r) => ({
        session_id: r.session_id,
        genesis_hash: r.genesis_hash,
      }));
      const summary = {
        parties: obpTableCount(db, "obp_parties"),
        offers: obpTableCount(db, "obp_offers"),
        exposes: obpTableCount(db, "obp_exposes"),
        binds: obpTableCount(db, "obp_binds"),
      };
      const payload: ChainStateResponse = { chains, graphSummary: summary };
      return Response.json(payload);
    }

    if (req.method === "POST" && url.pathname === "/chain/init") {
      return serialize(mux, async () => {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "invalid json" }, { status: 400 });
        }
        const parsed = ChainInitRequestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "bad request", detail: parsed.error.flatten() },
            { status: 400 },
          );
        }
        if (isSessionAllocated !== undefined) {
          const allocated = await Promise.resolve(isSessionAllocated(parsed.data.init.session_id));
          if (!allocated) {
            return Response.json({ error: "session slot not allocated on relay" }, { status: 409 });
          }
        }
        if (state.conn === undefined) {
          return Response.json({ error: "multiplex not ready" }, { status: 503 });
        }
        const wi = parsed.data.init;
        let genesisNb: NbcTurnBody;
        try {
          genesisNb = parseGenesisTurnOrThrow(parsed.data.genesis_turn);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({ error: msg }, { status: 400 });
        }

        const [didA, didB] = wi.party_dids;
        const peerDid = didA === myDid ? didB : didA;
        const peerPubkeyHex = meta.getRosterActor(peerDid);
        if (peerPubkeyHex === undefined) {
          return Response.json({ error: `peer not found in roster: ${peerDid}` }, { status: 404 });
        }
        const wire = sessionInitFromWire({
          session_id: wi.session_id,
          genesis_hash: wi.genesis_hash,
          party_ids: [myDid, peerDid],
          actor_pubkeys: [myActorPubkeyHex, peerPubkeyHex],
        });
        const norm = normalizeSessionInit(wire);

        try {
          const handle = await state.conn.init(norm, {});
          state.handles.set(norm.session_id, handle);
          meta.upsertChain(norm.session_id, norm.genesis_hash, Date.now());
          for (const party of norm.parties) {
            await persistence.registerParty({ id: party.id, name: party.id });
          }
          await handle.sendTurn(genesisNb);
          const out: ChainInitResponse = {
            ok: true,
            session_id: norm.session_id,
          };
          return Response.json(out);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({ error: msg }, { status: 400 });
        }
      });
    }

    if (req.method === "POST" && url.pathname === "/turn") {
      return serialize(mux, async () => {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "invalid json" }, { status: 400 });
        }
        const parsed = TurnRequestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "bad request", detail: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const { sessionId, body: turnBody } = parsed.data;
        const handle = state.handles.get(sessionId);
        if (handle === undefined) {
          return Response.json({ error: `unknown session: ${sessionId}` }, { status: 404 });
        }
        try {
          const nb = parseNbcTurnBody(turnBody);
          await handle.sendTurn(nb);
          return Response.json({ ok: true as const });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return Response.json({ error: msg }, { status: 400 });
        }
      });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  };
}

export function startVellumControlServer(opts: CreateVellumControlDispatchOptions): {
  hostname: string;
  port: number;
  dispatch: VellumControlDispatch;
  stop(): void;
} {
  const dispatch = createVellumControlDispatch(opts);
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: dispatch,
  });

  return {
    hostname: server.hostname ?? "127.0.0.1",
    port: Number(server.port ?? 0),
    dispatch,
    stop: () => {
      server.stop();
    },
  };
}
