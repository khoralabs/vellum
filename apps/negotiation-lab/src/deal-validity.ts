import type { AgreementResult, AgreementStatus } from "./domain/itex-agreement.ts";
import {
  ISSUE_IDS,
  type IssueId,
  type ItexContract,
  meetsReservation,
  publicDomain,
  type UtilityProfile,
} from "./domain/itex-cypress.ts";

/** Local copy to avoid circular import with types.ts */
type EpisodeOutcomeRef = "bound" | "left" | "turn-limit" | "timeout" | "error";

export type DealValidityConstraint =
  | { type: "complete_assignment"; issues: readonly IssueId[] }
  | { type: "domain_membership"; issues: readonly IssueId[] }
  | { type: "no_conflict"; scope: "episode"; on: "issue_values" }
  | { type: "terminal_close"; means: "terminal_bind" }
  | { type: "reservation"; party: "self"; utility_min: number };

export type DealValidityConstraintType = DealValidityConstraint["type"];

export type DealValidityConstraints = {
  kind: "deal_validity";
  version: 1;
  issues: readonly IssueId[];
  domain: Record<IssueId, readonly string[]>;
  constraints: readonly DealValidityConstraint[];
  notes: {
    peer_reservation: "private_unknown";
    below_own_reservation: "prefer_leave";
  };
};

export type DealValidityEvaluationStatus = AgreementStatus | "no_deal";

export type DealValidityViolation = {
  constraint: DealValidityConstraintType;
  detail: string;
};

/** Post-hoc oracle judgment (placeholder for a future reserved product surface). */
export type DealValidityEvaluation = {
  kind: "deal_validity_evaluation";
  version: 1;
  source: "oracle";
  satisfied: boolean;
  status: DealValidityEvaluationStatus;
  episode_outcome: EpisodeOutcomeRef;
  commitments: Partial<ItexContract>;
  violations: DealValidityViolation[];
  self: {
    utility: number | null;
    reservation: number;
    meets_reservation: boolean | null;
  };
};

/** Structured deal-validity constraints (placeholder for a future reserved statespace). */
export function dealValidityConstraints(profile: UtilityProfile): DealValidityConstraints {
  const issues = [...ISSUE_IDS] as IssueId[];
  const domain = Object.fromEntries(publicDomain().issues.map((i) => [i.id, i.values])) as Record<
    IssueId,
    readonly string[]
  >;

  return {
    kind: "deal_validity",
    version: 1,
    issues,
    domain,
    constraints: [
      { type: "complete_assignment", issues },
      { type: "domain_membership", issues },
      { type: "no_conflict", scope: "episode", on: "issue_values" },
      { type: "terminal_close", means: "terminal_bind" },
      { type: "reservation", party: "self", utility_min: profile.reservation },
    ],
    notes: {
      peer_reservation: "private_unknown",
      below_own_reservation: "prefer_leave",
    },
  };
}

export function dealValidityConstraintsBlock(profile: UtilityProfile): string {
  return [
    "## Deal validity constraints (reserved form placeholder)",
    "This object is the authority for what counts as a valid deal. OBP/NBC remains the negotiation medium.",
    JSON.stringify(dealValidityConstraints(profile), null, 2),
  ].join("\n");
}

function selfUtilityFromScore(
  agreement: AgreementResult | null,
  viewerSide: "A" | "B",
): number | null {
  const score = agreement?.score;
  if (score === null || score === undefined) return null;
  return viewerSide === "A" ? score.utilityA : score.utilityB;
}

/**
 * Viewer-scoped oracle evaluation. Never includes peer utility.
 * `viewerSide` is relative to reconstructAgreement(profileA, profileB).
 */
export function dealValidityEvaluation(input: {
  episodeOutcome: EpisodeOutcomeRef;
  agreement: AgreementResult | null;
  viewerProfile: UtilityProfile;
  viewerSide: "A" | "B";
}): DealValidityEvaluation {
  const { episodeOutcome, agreement, viewerProfile, viewerSide } = input;
  const reservation = viewerProfile.reservation;
  const selfUtility = selfUtilityFromScore(agreement, viewerSide);
  const meets = selfUtility === null ? null : meetsReservation(selfUtility, viewerProfile);

  if (agreement === null) {
    return {
      kind: "deal_validity_evaluation",
      version: 1,
      source: "oracle",
      satisfied: false,
      status: "no_deal",
      episode_outcome: episodeOutcome,
      commitments: {},
      violations: [
        {
          constraint: "terminal_close",
          detail: `episode ended as ${episodeOutcome} without a scored terminal deal`,
        },
      ],
      self: {
        utility: null,
        reservation,
        meets_reservation: null,
      },
    };
  }

  const violations: DealValidityViolation[] = [];
  switch (agreement.status) {
    case "valid":
      break;
    case "incomplete":
      violations.push({
        constraint: "complete_assignment",
        detail: agreement.reason ?? "missing one or more issue values",
      });
      break;
    case "conflict":
      violations.push({
        constraint: "no_conflict",
        detail: agreement.reason ?? "conflicting issue values",
      });
      break;
    case "invalid-value":
      violations.push({
        constraint: "domain_membership",
        detail: agreement.reason ?? "out-of-domain issue value",
      });
      break;
    case "below-reservation":
      // Reservation is self-scoped: do not surface peer reservation failure.
      if (meets === false) {
        violations.push({
          constraint: "reservation",
          detail: `self utility ${selfUtility} below reservation ${reservation}`,
        });
      }
      break;
    case "no-terminal-bind":
      violations.push({
        constraint: "terminal_close",
        detail: agreement.reason ?? "no terminal bind",
      });
      break;
  }

  const status: DealValidityEvaluationStatus =
    agreement.status === "below-reservation" && meets === true ? "valid" : agreement.status;

  return {
    kind: "deal_validity_evaluation",
    version: 1,
    source: "oracle",
    satisfied: status === "valid",
    status,
    episode_outcome: episodeOutcome,
    commitments: { ...agreement.commitments },
    violations,
    self: {
      utility: selfUtility,
      reservation,
      meets_reservation: meets,
    },
  };
}
