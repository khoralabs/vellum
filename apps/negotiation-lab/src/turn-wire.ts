import type { JsonDocument } from "@khoralabs/obp-core";
import { type NbcTurnBody, serializeNbcTurnBodyForWire } from "@khoralabs/obp-nbc";

import type { LabPortDef, LabTurn } from "./types.ts";

export type LabTurnWire = { kind: "disconnect" } | { kind: "offer"; body: Record<string, unknown> };

function offerTypeFor(expose: readonly LabPortDef[]): string {
  const first = expose[0]?.kind.trim() ?? "";
  return first.length > 0 ? `service.${first}` : "service.slot";
}

function toPortSpec(p: LabPortDef) {
  return {
    id: p.id ?? "",
    kind: p.kind,
    promise: p.promise,
    expires_turn: p.expires_turn ?? 0,
    expires_at_ms: p.expires_at_ms ?? 0,
    bind_policy: (p.bind_policy as JsonDocument | null | undefined) ?? null,
    ref: p.ref ?? "",
    ...(p.max_bindings !== undefined ? { max_bindings: p.max_bindings } : {}),
    ...(p.terminal !== undefined ? { terminal: p.terminal } : {}),
  };
}

/** Map a lab turn onto NBC wire, allowing expose-only continues. */
export function labTurnToWire(turn: LabTurn): LabTurnWire {
  if ("disconnect" in turn && turn.disconnect === true) {
    return { kind: "disconnect" };
  }

  if ("bind" in turn) {
    const expose = turn.expose ?? [];
    const payload = turn.bind.payload;
    const body: NbcTurnBody = {
      offer: { id: "", type: offerTypeFor(expose), expires_turn: 0, expires_at_ms: 0 },
      ports: expose.map(toPortSpec),
      bind_port_id: turn.bind.portId,
      bind_payload: payload === undefined ? {} : (payload as JsonDocument),
    };
    return { kind: "offer", body: serializeNbcTurnBodyForWire(body) };
  }

  if (!("expose" in turn)) {
    throw new Error("invalid lab turn");
  }
  const expose = turn.expose;
  if (expose.length === 0) {
    throw new Error("expose-only turn requires at least one port");
  }
  const body: NbcTurnBody = {
    offer: { id: "", type: offerTypeFor(expose), expires_turn: 0, expires_at_ms: 0 },
    ports: expose.map(toPortSpec),
    bind_port_id: "",
    bind_payload: null,
  };
  return { kind: "offer", body: serializeNbcTurnBodyForWire(body) };
}
