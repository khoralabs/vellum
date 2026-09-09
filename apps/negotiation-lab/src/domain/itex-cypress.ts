import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ISSUE_IDS = ["Price", "Delivery", "Payment", "Returns"] as const;
export type IssueId = (typeof ISSUE_IDS)[number];

export type ProfileId = "manufacturer" | "buyer" | "buyer_transfer";

export type ItexContract = Record<IssueId, string>;

export type IssueDef = {
  id: IssueId;
  values: readonly string[];
};

export type UtilityProfile = {
  role: ProfileId;
  party: string;
  goal: string;
  reservation: number;
  weights: Record<IssueId, number>;
  evaluations: Record<IssueId, Record<string, number>>;
};

export type ItexFixture = {
  meta: {
    name: string;
    description: string;
    source: {
      label: string;
      url: string;
      files: string[];
      sha256: Record<string, string>;
      citation: string;
    };
    notes: string[];
  };
  issues: IssueDef[];
  profiles: Record<ProfileId, UtilityProfile>;
};

export type OutcomeScore = {
  contract: ItexContract;
  utilityA: number;
  utilityB: number;
  socialWelfare: number;
  nashProduct: number;
  pareto: boolean;
  distanceToFrontier: number;
};

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/itex-cypress.json",
);

let cached: ItexFixture | undefined;

export function loadItexFixture(): ItexFixture {
  if (cached !== undefined) return cached;
  cached = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as ItexFixture;
  return cached;
}

export function publicDomain(fixture = loadItexFixture()): {
  name: string;
  issues: IssueDef[];
} {
  return { name: fixture.meta.name, issues: fixture.issues };
}

export function profileFor(id: ProfileId, fixture = loadItexFixture()): UtilityProfile {
  const profile = fixture.profiles[id];
  if (profile === undefined) throw new Error(`unknown profile: ${id}`);
  return profile;
}

export function isCompleteContract(
  value: unknown,
  fixture = loadItexFixture(),
): value is ItexContract {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  for (const issue of fixture.issues) {
    const v = rec[issue.id];
    if (typeof v !== "string" || !issue.values.includes(v)) return false;
  }
  return true;
}

export function enumerateContracts(fixture = loadItexFixture()): ItexContract[] {
  const [price, delivery, payment, returns] = fixture.issues;
  if (
    price === undefined ||
    delivery === undefined ||
    payment === undefined ||
    returns === undefined
  ) {
    throw new Error("fixture must define four issues");
  }
  const out: ItexContract[] = [];
  for (const p of price.values) {
    for (const d of delivery.values) {
      for (const pay of payment.values) {
        for (const r of returns.values) {
          out.push({ Price: p, Delivery: d, Payment: pay, Returns: r });
        }
      }
    }
  }
  return out;
}

function maxEval(profile: UtilityProfile, issue: IssueId): number {
  const evals = Object.values(profile.evaluations[issue] ?? {});
  const max = Math.max(...evals, 0);
  if (max <= 0)
    throw new Error(`profile ${profile.role} issue ${issue} has no positive evaluations`);
  return max;
}

/** Genius additive utility in [0, 1] (when weights sum to 1). */
export function utilityOf(contract: ItexContract, profile: UtilityProfile): number {
  let u = 0;
  for (const issue of ISSUE_IDS) {
    const evalValue = profile.evaluations[issue]?.[contract[issue]];
    if (evalValue === undefined) {
      throw new Error(`missing evaluation for ${profile.role}.${issue}=${contract[issue]}`);
    }
    u += profile.weights[issue] * (evalValue / maxEval(profile, issue));
  }
  return u;
}

export function meetsReservation(utility: number, profile: UtilityProfile): boolean {
  return utility >= profile.reservation;
}

export function isParetoOptimal(
  contract: ItexContract,
  profileA: UtilityProfile,
  profileB: UtilityProfile,
  universe: readonly ItexContract[] = enumerateContracts(),
): boolean {
  const uA = utilityOf(contract, profileA);
  const uB = utilityOf(contract, profileB);
  for (const other of universe) {
    const oA = utilityOf(other, profileA);
    const oB = utilityOf(other, profileB);
    if ((oA >= uA && oB > uB) || (oA > uA && oB >= uB)) return false;
  }
  return true;
}

type UtilityPoint = { contract: ItexContract; utilityA: number; utilityB: number };

function utilityPoints(
  profileA: UtilityProfile,
  profileB: UtilityProfile,
  universe: readonly ItexContract[],
): UtilityPoint[] {
  return universe.map((contract) => ({
    contract,
    utilityA: utilityOf(contract, profileA),
    utilityB: utilityOf(contract, profileB),
  }));
}

function paretoPoints(points: readonly UtilityPoint[]): UtilityPoint[] {
  return points.filter(
    (p) =>
      !points.some(
        (o) =>
          (o.utilityA >= p.utilityA && o.utilityB > p.utilityB) ||
          (o.utilityA > p.utilityA && o.utilityB >= p.utilityB),
      ),
  );
}

export function paretoFrontier(
  profileA: UtilityProfile,
  profileB: UtilityProfile,
  universe: readonly ItexContract[] = enumerateContracts(),
): OutcomeScore[] {
  const frontier = paretoPoints(utilityPoints(profileA, profileB, universe));
  return frontier.map((p) => ({
    contract: p.contract,
    utilityA: p.utilityA,
    utilityB: p.utilityB,
    socialWelfare: p.utilityA + p.utilityB,
    nashProduct: nashProduct(p.utilityA, p.utilityB, profileA, profileB),
    pareto: true,
    distanceToFrontier: 0,
  }));
}

export function nashProduct(
  utilityA: number,
  utilityB: number,
  profileA: UtilityProfile,
  profileB: UtilityProfile,
): number {
  return (
    Math.max(0, utilityA - profileA.reservation) * Math.max(0, utilityB - profileB.reservation)
  );
}

export function distanceToParetoFrontier(
  utilityA: number,
  utilityB: number,
  profileA: UtilityProfile,
  profileB: UtilityProfile,
  universe: readonly ItexContract[] = enumerateContracts(),
): number {
  const frontier = paretoPoints(utilityPoints(profileA, profileB, universe));
  if (frontier.length === 0) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const p of frontier) {
    const d = Math.hypot(p.utilityA - utilityA, p.utilityB - utilityB);
    if (d < best) best = d;
  }
  return best;
}

export function scoreContract(
  contract: ItexContract,
  profileA: UtilityProfile,
  profileB: UtilityProfile,
  universe: readonly ItexContract[] = enumerateContracts(),
): OutcomeScore {
  const utilityA = utilityOf(contract, profileA);
  const utilityB = utilityOf(contract, profileB);
  return {
    contract,
    utilityA,
    utilityB,
    socialWelfare: utilityA + utilityB,
    nashProduct: nashProduct(utilityA, utilityB, profileA, profileB),
    pareto: isParetoOptimal(contract, profileA, profileB, universe),
    distanceToFrontier: distanceToParetoFrontier(utilityA, utilityB, profileA, profileB, universe),
  };
}

export function nashBargainingPoint(
  profileA: UtilityProfile,
  profileB: UtilityProfile,
  universe: readonly ItexContract[] = enumerateContracts(),
): OutcomeScore {
  let best: OutcomeScore | undefined;
  for (const c of universe) {
    const utilityA = utilityOf(c, profileA);
    const utilityB = utilityOf(c, profileB);
    const np = nashProduct(utilityA, utilityB, profileA, profileB);
    if (
      best === undefined ||
      np > best.nashProduct ||
      (np === best.nashProduct && utilityA + utilityB > best.socialWelfare)
    ) {
      best = {
        contract: c,
        utilityA,
        utilityB,
        socialWelfare: utilityA + utilityB,
        nashProduct: np,
        pareto: true,
        distanceToFrontier: 0,
      };
    }
  }
  if (best === undefined) throw new Error("empty outcome space");
  best.pareto = isParetoOptimal(best.contract, profileA, profileB, universe);
  best.distanceToFrontier = distanceToParetoFrontier(
    best.utilityA,
    best.utilityB,
    profileA,
    profileB,
    universe,
  );
  return best;
}

export function roleForDid(
  did: string,
  mapping: { manufacturer: string; buyer: string; buyer_transfer?: string },
): ProfileId {
  if (did === mapping.manufacturer) return "manufacturer";
  if (did === mapping.buyer) return "buyer";
  if (mapping.buyer_transfer !== undefined && did === mapping.buyer_transfer)
    return "buyer_transfer";
  throw new Error(`no Itex role for ${did}`);
}
