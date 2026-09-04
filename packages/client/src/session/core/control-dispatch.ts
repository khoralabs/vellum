import {
  collectNbcChainGraph,
  type NbcChainGraph,
  type NbcChainPortRow,
  type NbcTurnBody,
  parseNbcTurnBody,
  whoShouldAct,
} from "@khoralabs/obp-nbc";
import { availablePeerPorts } from "@khoralabs/obp-nbc/host";
import { normalizeSessionInit, sessionInitFromWire } from "@khoralabs/obp-wire";
import {
  ChainInitRequestSchema,
  type ChainInitResponse,
  type ChainStateResponse,
  EndOffersRequestSchema,
  matchVellumControlChainSnapshotPath,
  TurnRequestSchema,
  VELLUM_CONTROL_HTTP_PATH,
  VELLUM_CONTROL_PROTOCOL_VERSION,
  vellumJsonError,
} from "../../contracts";
import type {
  CreateVellumControlDispatchOptions,
  VellumControlDispatch,
  VellumControlEvent,
} from "./types";

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

function serialize<T>(mut: { tail: Promise<void> }, run: () => Promise<T>): Promise<T> {
  const p = mut.tail.then(run);
  mut.tail = p.then(
    () => {},
    () => {},
  );
  return p;
}

function obpTableCount(db: CreateVellumControlDispatchOptions["db"], table: string): number {
  const row = db.query<{ c: number }, []>(`SELECT COUNT(*) AS c FROM ${table}`).get();
  return row?.c ?? 0;
}

function emit(opts: CreateVellumControlDispatchOptions, event: VellumControlEvent): void {
  const listeners = opts.state.events;
  if (listeners === undefined) return;
  for (const fn of listeners) fn(event);
}

export async function buildChainSnapshot(
  persistence: CreateVellumControlDispatchOptions["persistence"],
  sessionId: string,
  asDid: string,
  initiatorId: string,
): Promise<{
  session_id: string;
  graph: NbcChainGraph;
  whoShouldAct: string | null;
  portsICanBind: NbcChainPortRow[];
  needsTurn: boolean;
}> {
  const graph = await collectNbcChainGraph(persistence);
  const acting = whoShouldAct(graph, { initiatorId });
  const peerPorts = availablePeerPorts(graph, asDid);
  const portById = new Map(graph.ports.map((p) => [p.id, p]));
  const portsICanBind = peerPorts
    .map((pp) => portById.get(pp.id))
    .filter((row): row is NbcChainPortRow => row !== undefined);
  const needsTurn = acting === asDid;
  return {
    session_id: sessionId,
    graph,
    whoShouldAct: acting,
    portsICanBind,
    needsTurn,
  };
}

/** Shared request handler for HTTP serve and {@link InProcessControlTransport}. */
export function createVellumControlDispatch(
  opts: CreateVellumControlDispatchOptions,
): VellumControlDispatch {
  const mux = { tail: Promise.resolve() };
  const { state, db, meta, persistence, isSessionAllocated, signer, myActorPubkeyHex } = opts;
  const myDid = signer.did;
  const events = state.events ?? new Set<(e: VellumControlEvent) => void>();
  state.events = events;
  const initiators = state.initiators ?? new Map<string, string>();
  state.initiators = initiators;

  return async (req) => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === VELLUM_CONTROL_HTTP_PATH.health) {
      return Response.json({ ok: true as const, version: VELLUM_CONTROL_PROTOCOL_VERSION });
    }

    if (req.method === "GET" && url.pathname === VELLUM_CONTROL_HTTP_PATH.events) {
      const encoder = new TextEncoder();
      let onEvent: (e: VellumControlEvent) => void = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          onEvent = (e) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          };
          events.add(onEvent);
        },
        cancel() {
          events.delete(onEvent);
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
      });
    }

    if (req.method === "GET" && url.pathname === VELLUM_CONTROL_HTTP_PATH.chain) {
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

    const chainSessionId = matchVellumControlChainSnapshotPath(url.pathname);
    if (req.method === "GET" && chainSessionId !== undefined) {
      const sessionId = chainSessionId;
      const row = meta.getChain(sessionId);
      if (row === undefined && !state.handles.has(sessionId)) {
        return vellumJsonError(`unknown session: ${sessionId}`, 404);
      }
      try {
        const stored = row?.initiator_did?.trim();
        const initiatorId =
          (stored !== undefined && stored.length > 0 ? stored : undefined) ??
          initiators.get(sessionId) ??
          myDid;
        const snap = await buildChainSnapshot(persistence, sessionId, myDid, initiatorId);
        return Response.json(snap);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return vellumJsonError(msg, 400);
      }
    }

    if (req.method === "POST" && url.pathname === VELLUM_CONTROL_HTTP_PATH.chainEndOffers) {
      return serialize(mux, async () => {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return vellumJsonError("invalid json", 400);
        }
        const parsed = EndOffersRequestSchema.safeParse(body);
        if (!parsed.success) {
          return vellumJsonError("bad request", 400, { detail: parsed.error.flatten() });
        }
        const handle = state.handles.get(parsed.data.sessionId);
        if (handle === undefined) {
          return vellumJsonError(`unknown session: ${parsed.data.sessionId}`, 404);
        }
        try {
          await handle.endOffers();
          emit(opts, { kind: "committed", sessionId: parsed.data.sessionId });
          return Response.json({ ok: true as const });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return vellumJsonError(msg, 400);
        }
      });
    }

    if (req.method === "POST" && url.pathname === VELLUM_CONTROL_HTTP_PATH.chainClose) {
      return serialize(mux, async () => {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return vellumJsonError("invalid json", 400);
        }
        const parsed = EndOffersRequestSchema.safeParse(body);
        if (!parsed.success) {
          return vellumJsonError("bad request", 400, { detail: parsed.error.flatten() });
        }
        const handle = state.handles.get(parsed.data.sessionId);
        if (handle === undefined) {
          return vellumJsonError(`unknown session: ${parsed.data.sessionId}`, 404);
        }
        try {
          await handle.terminate("closed");
          state.handles.delete(parsed.data.sessionId);
          return Response.json({ ok: true as const });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return vellumJsonError(msg, 400);
        }
      });
    }

    if (req.method === "POST" && url.pathname === VELLUM_CONTROL_HTTP_PATH.chainInit) {
      return serialize(mux, async () => {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return vellumJsonError("invalid json", 400);
        }
        const parsed = ChainInitRequestSchema.safeParse(body);
        if (!parsed.success) {
          return vellumJsonError("bad request", 400, { detail: parsed.error.flatten() });
        }
        if (isSessionAllocated !== undefined) {
          const allocated = await Promise.resolve(isSessionAllocated(parsed.data.init.session_id));
          if (!allocated) {
            return vellumJsonError("session slot not allocated on relay", 409);
          }
        }
        if (state.conn === undefined) {
          return vellumJsonError("multiplex not ready", 503);
        }
        const wi = parsed.data.init;
        let genesisNb: NbcTurnBody | undefined;
        if (parsed.data.genesis_turn !== undefined) {
          try {
            genesisNb = parseGenesisTurnOrThrow(parsed.data.genesis_turn);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return vellumJsonError(msg, 400);
          }
        }

        const [didA, didB] = wi.party_dids;
        const peerDid = didA === myDid ? didB : didA;
        let peerPubkeyHex = meta.getRosterActor(peerDid);
        if (peerPubkeyHex === undefined) {
          peerPubkeyHex = wi.peer_identity_key;
          meta.upsertRosterEntry(peerDid, peerPubkeyHex, Date.now());
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
          initiators.set(norm.session_id, myDid);
          meta.upsertChain(norm.session_id, norm.genesis_hash, Date.now(), myDid);
          for (const party of norm.parties) {
            await persistence.registerParty({ id: party.id, name: party.id });
          }
          if (genesisNb !== undefined) {
            await handle.sendTurn(genesisNb);
            emit(opts, { kind: "committed", sessionId: norm.session_id });
          }
          const out: ChainInitResponse = {
            ok: true,
            session_id: norm.session_id,
          };
          return Response.json(out);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return vellumJsonError(msg, 400);
        }
      });
    }

    if (req.method === "POST" && url.pathname === VELLUM_CONTROL_HTTP_PATH.turn) {
      return serialize(mux, async () => {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return vellumJsonError("invalid json", 400);
        }
        const parsed = TurnRequestSchema.safeParse(body);
        if (!parsed.success) {
          return vellumJsonError("bad request", 400, { detail: parsed.error.flatten() });
        }
        const { sessionId, body: turnBody } = parsed.data;
        const handle = state.handles.get(sessionId);
        if (handle === undefined) {
          return vellumJsonError(`unknown session: ${sessionId}`, 404);
        }
        try {
          const nb = parseNbcTurnBody(turnBody);
          await handle.sendTurn(nb);
          emit(opts, { kind: "committed", sessionId });
          return Response.json({ ok: true as const });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return vellumJsonError(msg, 400);
        }
      });
    }

    return vellumJsonError("not found", 404);
  };
}
