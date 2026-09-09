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

function binderRoleFor(
  graph: NbcChainGraph,
  bind: { portId: string; offerId: string },
  initiatorDid: string,
): string {
  const bindingOffer = graph.offers.find((offer) => offer.id === bind.offerId);
  if (bindingOffer === undefined) return "unknown";
  return bindingOffer.partyId === initiatorDid ? "initiator" : "counterparty";
}

function terminalFlagFor(graph: NbcChainGraph, bind: { portId: string }): string {
  const targetPort = graph.ports.find((port) => port.id === bind.portId);
  return targetPort?.terminal === true ? "T" : "N";
}

/** Normalized protocol fingerprint from a terminal NBC graph (full bind sequence). */
export function protocolSignature(graph: NbcChainGraph, initiatorDid: string): string {
  const offerOrder = graph.offers.map((o) => `${o.partyId === initiatorDid ? "I" : "C"}:${o.type}`);
  const ports = [...graph.ports]
    .map(
      (p) =>
        `${p.kind}|${p.promise}|${policyShape(p.bind_policy)}|term:${p.terminal === true ? "1" : "0"}`,
    )
    .sort();
  const binds =
    graph.binds.length === 0
      ? "none"
      : graph.binds
          .map((bind) => {
            const role = binderRoleFor(graph, bind, initiatorDid);
            const term = terminalFlagFor(graph, bind);
            const payloadKeys = sortedKeys(bind.bind_payload).join(",");
            return `${role}:${term}:{${payloadKeys}}`;
          })
          .join(">");
  return [`offers=${offerOrder.join(">")}`, `ports=${ports.join(";")}`, `binds=${binds}`].join(
    "||",
  );
}

export function signatureStability(signatures: string[]): number {
  const ok = signatures.filter((s) => s.length > 0);
  if (ok.length <= 1) return ok.length === 1 ? 1 : 0;
  const first = ok[0];
  if (first === undefined) return 0;
  const same = ok.filter((s) => s === first).length;
  return same / ok.length;
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 1 : inter / union;
}

function sequenceSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const n = Math.max(a.length, b.length);
  if (n === 0) return 1;
  let same = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) same += 1;
  }
  return same / n;
}

export type ProtocolComponents = {
  offerOrder: string[];
  portKindsPromises: string[];
  policyKeys: string[];
  bindSequence: string[];
  payloadKeySets: string[];
};

export function protocolComponents(graph: NbcChainGraph, initiatorDid: string): ProtocolComponents {
  return {
    offerOrder: graph.offers.map((o) => `${o.partyId === initiatorDid ? "I" : "C"}:${o.type}`),
    portKindsPromises: [...graph.ports].map((p) => `${p.kind}|${p.promise}`).sort(),
    policyKeys: [...graph.ports].map((p) => policyShape(p.bind_policy)).sort(),
    bindSequence: graph.binds.map((bind) => {
      const role = binderRoleFor(graph, bind, initiatorDid);
      const term = terminalFlagFor(graph, bind);
      return `${role}:${term}`;
    }),
    payloadKeySets: graph.binds.map((bind) => sortedKeys(bind.bind_payload).join(",")),
  };
}

/** Equal-weight mean component similarity in [0, 1]. */
export function protocolSimilarity(
  a: NbcChainGraph,
  b: NbcChainGraph,
  initiatorDid: string,
): number {
  const ca = protocolComponents(a, initiatorDid);
  const cb = protocolComponents(b, initiatorDid);
  const scores = [
    sequenceSimilarity(ca.offerOrder, cb.offerOrder),
    jaccard(ca.portKindsPromises, cb.portKindsPromises),
    jaccard(ca.policyKeys, cb.policyKeys),
    sequenceSimilarity(ca.bindSequence, cb.bindSequence),
    sequenceSimilarity(ca.payloadKeySets, cb.payloadKeySets),
  ];
  return scores.reduce((s, x) => s + x, 0) / scores.length;
}

export function meanAdjacentSimilarity(
  episodes: readonly { graph: NbcChainGraph; initiatorDid: string }[],
): number | null {
  if (episodes.length < 2) return null;
  let sum = 0;
  let n = 0;
  for (let i = 1; i < episodes.length; i++) {
    const prev = episodes[i - 1];
    const cur = episodes[i];
    if (prev === undefined || cur === undefined) continue;
    sum += protocolSimilarity(prev.graph, cur.graph, cur.initiatorDid);
    n += 1;
  }
  return n === 0 ? null : sum / n;
}

export function slope(values: readonly number[]): number | null {
  const points = values.filter((y): y is number => typeof y === "number" && Number.isFinite(y));
  if (points.length < 2) return null;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const y = points[i];
    if (y === undefined) continue;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}
