import type { NbcChainGraph } from "@khoralabs/obp-nbc";

import {
  ISSUE_IDS,
  type IssueId,
  type ItexContract,
  isCompleteContract,
  loadItexFixture,
  meetsReservation,
  type OutcomeScore,
  type ProfileId,
  profileFor,
  scoreContract,
} from "./itex-cypress.ts";

export type AgreementStatus =
  | "no-terminal-bind"
  | "incomplete"
  | "conflict"
  | "invalid-value"
  | "below-reservation"
  | "valid";

export type AgreementResult = {
  status: AgreementStatus;
  commitments: Partial<ItexContract>;
  contract: ItexContract | null;
  score: OutcomeScore | null;
  reason?: string;
};

const ISSUE_ALIASES: Record<string, IssueId> = {
  price: "Price",
  delivery: "Delivery",
  payment: "Payment",
  returns: "Returns",
  return: "Returns",
  spoilage: "Returns",
};

function canonicalIssueKey(raw: string): IssueId | null {
  const trimmed = raw.trim();
  if ((ISSUE_IDS as readonly string[]).includes(trimmed)) return trimmed as IssueId;
  return ISSUE_ALIASES[trimmed.toLowerCase()] ?? null;
}

function allowedValues(issue: IssueId): readonly string[] {
  const def = loadItexFixture().issues.find((i) => i.id === issue);
  return def?.values ?? [];
}

function extractFromPayload(payload: unknown): Partial<ItexContract> {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return {};
  const out: Partial<ItexContract> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const issue = canonicalIssueKey(key);
    if (issue === null) continue;
    if (typeof value === "string") out[issue] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[issue] = String(value);
  }
  return out;
}

function extractFromPolicy(policy: unknown): Partial<ItexContract> {
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) return {};
  const props = (policy as { properties?: unknown }).properties;
  if (props === null || typeof props !== "object" || Array.isArray(props)) return {};
  const out: Partial<ItexContract> = {};
  for (const [key, schema] of Object.entries(props as Record<string, unknown>)) {
    const issue = canonicalIssueKey(key);
    if (issue === null) continue;
    if (schema === null || typeof schema !== "object" || Array.isArray(schema)) continue;
    const s = schema as { const?: unknown; enum?: unknown };
    if (typeof s.const === "string") {
      out[issue] = s.const;
      continue;
    }
    if (Array.isArray(s.enum) && s.enum.length === 1 && typeof s.enum[0] === "string") {
      out[issue] = s.enum[0];
    }
  }
  return out;
}

/** Observe issue commitments encoded on the bound port itself (kind/promise). */
function extractFromPort(
  port:
    | {
        kind?: string;
        promise?: string;
      }
    | undefined,
  payload: unknown,
): Partial<ItexContract> {
  if (port === undefined) return {};
  const out: Partial<ItexContract> = {};
  const kindIssue = port.kind !== undefined ? canonicalIssueKey(port.kind) : null;
  const promise = port.promise?.trim() ?? "";

  if (promise.startsWith("{")) {
    try {
      const parsed = JSON.parse(promise) as unknown;
      Object.assign(out, extractFromPayload(parsed));
    } catch {
      // not JSON
    }
  }

  if (kindIssue !== null) {
    if (allowedValues(kindIssue).includes(promise)) {
      out[kindIssue] = promise;
    }
    if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
      const value = (payload as Record<string, unknown>).value;
      if (typeof value === "string") out[kindIssue] = value;
    }
  }
  return out;
}

function mergeCommitments(
  base: Partial<ItexContract>,
  next: Partial<ItexContract>,
):
  | { ok: true; value: Partial<ItexContract> }
  | { ok: false; issue: IssueId; a: string; b: string } {
  const merged: Partial<ItexContract> = { ...base };
  for (const issue of ISSUE_IDS) {
    const incoming = next[issue];
    if (incoming === undefined) continue;
    const prior = merged[issue];
    if (prior !== undefined && prior !== incoming) {
      return { ok: false, issue, a: prior, b: incoming };
    }
    merged[issue] = incoming;
  }
  return { ok: true, value: merged };
}

function validateDomainValues(
  commitments: Partial<ItexContract>,
): { ok: true } | { ok: false; issue: IssueId; value: string } {
  for (const issue of ISSUE_IDS) {
    const value = commitments[issue];
    if (value === undefined) continue;
    if (!allowedValues(issue).includes(value)) {
      return { ok: false, issue, value };
    }
  }
  return { ok: true };
}

/**
 * External observer: reconstruct Itex commitments from bound ports in DAG order.
 * Does not instruct agents how to author the graph.
 */
export function reconstructAgreement(
  graph: NbcChainGraph,
  profileA: ProfileId,
  profileB: ProfileId,
): AgreementResult {
  const hasTerminal = graph.binds.some((bind) => {
    const port = graph.ports.find((p) => p.id === bind.portId);
    return port?.terminal === true;
  });
  if (!hasTerminal) {
    return {
      status: "no-terminal-bind",
      commitments: {},
      contract: null,
      score: null,
      reason: "no terminal bind",
    };
  }

  let commitments: Partial<ItexContract> = {};
  for (const bind of graph.binds) {
    const port = graph.ports.find((p) => p.id === bind.portId);
    const chunks = [
      extractFromPayload(bind.bind_payload),
      extractFromPolicy(port?.bind_policy),
      extractFromPort(port, bind.bind_payload),
    ];
    for (const chunk of chunks) {
      const merged = mergeCommitments(commitments, chunk);
      if (!merged.ok) {
        return {
          status: "conflict",
          commitments,
          contract: null,
          score: null,
          reason: `conflict on ${merged.issue}: ${merged.a} vs ${merged.b}`,
        };
      }
      commitments = merged.value;
    }
  }

  const domain = validateDomainValues(commitments);
  if (!domain.ok) {
    return {
      status: "invalid-value",
      commitments,
      contract: null,
      score: null,
      reason: `out-of-domain ${domain.issue}=${domain.value}`,
    };
  }

  if (!isCompleteContract(commitments)) {
    return {
      status: "incomplete",
      commitments,
      contract: null,
      score: null,
      reason: "missing one or more issue values",
    };
  }

  const a = profileFor(profileA);
  const b = profileFor(profileB);
  const score = scoreContract(commitments, a, b);
  if (!meetsReservation(score.utilityA, a) || !meetsReservation(score.utilityB, b)) {
    return {
      status: "below-reservation",
      commitments,
      contract: commitments,
      score,
      reason: "utility below reservation",
    };
  }

  return {
    status: "valid",
    commitments,
    contract: commitments,
    score,
  };
}
