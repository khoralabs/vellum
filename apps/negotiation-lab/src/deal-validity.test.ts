import { describe, expect, test } from "bun:test";
import {
  dealValidityConstraints,
  dealValidityConstraintsBlock,
  dealValidityEvaluation,
} from "./deal-validity.ts";
import type { AgreementResult } from "./domain/itex-agreement.ts";
import { profileFor } from "./domain/itex-cypress.ts";

describe("deal validity constraints", () => {
  test("builder emits kind, four issues, constraint types, and actor reservation", () => {
    const profile = profileFor("manufacturer");
    const doc = dealValidityConstraints(profile);

    expect(doc.kind).toBe("deal_validity");
    expect(doc.version).toBe(1);
    expect(doc.issues).toEqual(["Price", "Delivery", "Payment", "Returns"]);
    expect(doc.domain.Price.length).toBeGreaterThan(0);
    expect(doc.domain.Delivery.length).toBeGreaterThan(0);
    expect(doc.domain.Payment.length).toBeGreaterThan(0);
    expect(doc.domain.Returns.length).toBeGreaterThan(0);

    const types = doc.constraints.map((c) => c.type);
    expect(types).toEqual([
      "complete_assignment",
      "domain_membership",
      "no_conflict",
      "terminal_close",
      "reservation",
    ]);

    const reservation = doc.constraints.find((c) => c.type === "reservation");
    expect(reservation).toEqual({
      type: "reservation",
      party: "self",
      utility_min: profile.reservation,
    });
    expect(doc.notes.peer_reservation).toBe("private_unknown");
    expect(doc.notes.below_own_reservation).toBe("prefer_leave");
  });

  test("prompt block serializes JSON with reserved-form label", () => {
    const profile = profileFor("buyer");
    const block = dealValidityConstraintsBlock(profile);
    expect(block).toContain("## Deal validity constraints (reserved form placeholder)");
    expect(block).toContain('"kind": "deal_validity"');
    expect(block).toContain(`"utility_min": ${profile.reservation}`);
    expect(block).toContain("OBP/NBC remains the negotiation medium");
  });
});

describe("deal validity evaluation", () => {
  const mfg = profileFor("manufacturer");
  const buyer = profileFor("buyer");

  test("maps agreement statuses to constraint violations", () => {
    const cases: Array<{
      status: AgreementResult["status"];
      constraint:
        | "complete_assignment"
        | "domain_membership"
        | "no_conflict"
        | "terminal_close"
        | "reservation";
      score?: AgreementResult["score"];
    }> = [
      { status: "incomplete", constraint: "complete_assignment" },
      { status: "conflict", constraint: "no_conflict" },
      { status: "invalid-value", constraint: "domain_membership" },
      {
        status: "below-reservation",
        constraint: "reservation",
        score: {
          contract: {
            Price: "$3.98",
            Delivery: "45 days",
            Payment: "Upon delivery",
            Returns: "5% spoilage allowed",
          },
          utilityA: -0.2,
          utilityB: 0.5,
          socialWelfare: 0.3,
          nashProduct: 0,
          pareto: false,
          distanceToFrontier: 1,
        },
      },
      { status: "no-terminal-bind", constraint: "terminal_close" },
    ];
    for (const c of cases) {
      const evaln = dealValidityEvaluation({
        episodeOutcome: "bound",
        agreement: {
          status: c.status,
          commitments: { Price: "$3.98" },
          contract: null,
          score: c.score ?? null,
          reason: `test-${c.status}`,
        },
        viewerProfile: mfg,
        viewerSide: "A",
      });
      expect(evaln.kind).toBe("deal_validity_evaluation");
      expect(evaln.source).toBe("oracle");
      expect(evaln.satisfied).toBe(false);
      expect(evaln.status).toBe(c.status);
      expect(evaln.violations.map((v) => v.constraint)).toEqual([c.constraint]);
    }
  });

  test("valid agreement is satisfied with no violations and viewer-scoped utility only", () => {
    const score = {
      contract: {
        Price: "$3.98",
        Delivery: "45 days",
        Payment: "Upon delivery",
        Returns: "5% spoilage allowed",
      },
      utilityA: 0.7,
      utilityB: 0.55,
      socialWelfare: 1.25,
      nashProduct: 0.1,
      pareto: true,
      distanceToFrontier: 0,
    };
    const agreement: AgreementResult = {
      status: "valid",
      commitments: score.contract,
      contract: score.contract,
      score,
    };

    const evalA = dealValidityEvaluation({
      episodeOutcome: "bound",
      agreement,
      viewerProfile: mfg,
      viewerSide: "A",
    });
    expect(evalA.satisfied).toBe(true);
    expect(evalA.violations).toEqual([]);
    expect(evalA.self.utility).toBe(0.7);
    expect(evalA.self.reservation).toBe(mfg.reservation);
    expect(JSON.stringify(evalA)).not.toContain("0.55");
    expect(JSON.stringify(evalA)).not.toContain("utilityB");

    const evalB = dealValidityEvaluation({
      episodeOutcome: "bound",
      agreement,
      viewerProfile: buyer,
      viewerSide: "B",
    });
    expect(evalB.self.utility).toBe(0.55);
    expect(JSON.stringify(evalB)).not.toContain('"utility":0.7');
  });

  test("null agreement yields no_deal with terminal_close violation", () => {
    const evaln = dealValidityEvaluation({
      episodeOutcome: "left",
      agreement: null,
      viewerProfile: mfg,
      viewerSide: "A",
    });
    expect(evaln.status).toBe("no_deal");
    expect(evaln.satisfied).toBe(false);
    expect(evaln.violations[0]?.constraint).toBe("terminal_close");
    expect(evaln.self.utility).toBeNull();
  });

  test("below-reservation is viewer-scoped without leaking peer failure", () => {
    const contract = {
      Price: "$3.98",
      Delivery: "45 days",
      Payment: "Upon delivery",
      Returns: "5% spoilage allowed",
    };
    const agreement: AgreementResult = {
      status: "below-reservation",
      commitments: contract,
      contract,
      score: {
        contract,
        utilityA: 0.7,
        utilityB: -0.1,
        socialWelfare: 0.6,
        nashProduct: 0,
        pareto: false,
        distanceToFrontier: 1,
      },
      reason: "utility below reservation",
    };

    const evalA = dealValidityEvaluation({
      episodeOutcome: "bound",
      agreement,
      viewerProfile: mfg,
      viewerSide: "A",
    });
    expect(evalA.self.meets_reservation).toBe(true);
    expect(evalA.status).toBe("valid");
    expect(evalA.satisfied).toBe(true);
    expect(evalA.violations).toEqual([]);
    expect(JSON.stringify(evalA)).not.toContain("utility below reservation");
    expect(JSON.stringify(evalA)).not.toContain("-0.1");

    const evalB = dealValidityEvaluation({
      episodeOutcome: "bound",
      agreement,
      viewerProfile: { ...buyer, reservation: 0 },
      viewerSide: "B",
    });
    // buyer utility -0.1 with reservation 0 still fails meetsReservation (>=)
    expect(evalB.self.meets_reservation).toBe(false);
    expect(evalB.status).toBe("below-reservation");
    expect(evalB.satisfied).toBe(false);
    expect(evalB.violations).toEqual([
      {
        constraint: "reservation",
        detail: "self utility -0.1 below reservation 0",
      },
    ]);
  });
});
