import type { JsonDocument } from "@khoralabs/obp-core";
import type { NbcChainGraph } from "@khoralabs/obp-nbc";

function sortedKeys(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).sort();
}

function policyShape(policy: JsonDocument | undefined): string {
  if (
    policy === null ||
    policy === undefined ||
    typeof policy !== "object" ||
    Array.isArray(policy)
  ) {
    return "none";
  }
  const rec = policy as Record<string, unknown>;
  const required = Array.isArray(rec.required)
    ? [...rec.required].map(String).sort().join(",")
    : "";
  const props =
    rec.properties !== null && typeof rec.properties === "object" && !Array.isArray(rec.properties)
      ? Object.keys(rec.properties as Record<string, unknown>)
          .sort()
          .join(",")
      : "";
  return `req:${required}|props:${props}`;
}

/** Normalized protocol fingerprint from a terminal NBC graph. */
export function protocolSignature(graph: NbcChainGraph, initiatorDid: string): string {
  const offerOrder = graph.offers.map((o) => `${o.partyId === initiatorDid ? "I" : "C"}:${o.type}`);
  const ports = [...graph.ports]
    .map((p) => `${p.kind}|${p.promise}|${policyShape(p.bind_policy)}`)
    .sort();
  const bind = graph.binds[0];
  let binderRole = "none";
  let payloadKeys = "";
  if (bind !== undefined) {
    const targetPort = graph.ports.find((port) => port.id === bind.portId);
    const ownerOffer = graph.offers.find((offer) =>
      targetPort?.exposedOnOfferIds.includes(offer.id),
    );
    binderRole =
      ownerOffer === undefined
        ? "unknown"
        : ownerOffer.partyId === initiatorDid
          ? "counterparty"
          : "initiator";
    payloadKeys = sortedKeys(bind.bind_payload).join(",");
  }
  return [
    `offers=${offerOrder.join(">")}`,
    `ports=${ports.join(";")}`,
    `binder=${binderRole}`,
    `payload=${payloadKeys}`,
  ].join("||");
}

export function signatureStability(signatures: string[]): number {
  const ok = signatures.filter((s) => s.length > 0);
  if (ok.length <= 1) return ok.length === 1 ? 1 : 0;
  const first = ok[0];
  if (first === undefined) return 0;
  const same = ok.filter((s) => s === first).length;
  return same / ok.length;
}
