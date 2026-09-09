import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reconstructAgreement } from "./domain/itex-agreement.ts";
import {
  enumerateContracts,
  loadItexFixture,
  nashBargainingPoint,
  profileFor,
  scoreContract,
  utilityOf,
} from "./domain/itex-cypress.ts";
import { runEpisode } from "./episode-runner.ts";
import {
  computeConvergenceMetrics,
  defaultRoleForDid,
  runConventionExperiment,
} from "./experiment.ts";
import { libraryReuseRate, observeLibraryFromGraph } from "./library.ts";
import { MarkdownMemoryStore } from "./memory.ts";
import { createScriptedBindPolicy } from "./policy.ts";
import { protocolSignature, signatureStability, slope } from "./protocol-signature.ts";
import { labTurnToWire } from "./turn-wire.ts";
import { AGENT_A, AGENT_B, AGENT_C, type EpisodeRecord } from "./types.ts";

function emptyTokens() {
  return { input: 0, output: 0, total: 0 };
}

function fixtureEpisode(
  partial: Partial<EpisodeRecord> & Pick<EpisodeRecord, "id" | "condition" | "graph">,
): EpisodeRecord {
  return {
    initiatorDid: AGENT_A,
    counterpartyDid: AGENT_B,
    purpose: "test",
    outcome: "bound",
    offers: partial.graph.offers.length,
    turns: 2,
    modelCalls: 0,
    tokens: emptyTokens(),
    negotiationTokens: emptyTokens(),
    reflectionTokens: emptyTokens(),
    wallMs: 1,
    protocolSignature: protocolSignature(partial.graph, AGENT_A),
    agreement: null,
    memoryDiffs: [],
    memoryShown: {
      initiator: { general: "", peer: "" },
      counterparty: { general: "", peer: "" },
    },
    experiencesShown: {
      initiator: { chains: [], recentIndex: [] },
      counterparty: { chains: [], recentIndex: [] },
    },
    ...partial,
  };
}

describe("itex-cypress domain", () => {
  test("fixture has four issues and 180 unique outcomes", () => {
    const fixture = loadItexFixture();
    expect(fixture.issues).toHaveLength(4);
    const outcomes = enumerateContracts(fixture);
    expect(outcomes).toHaveLength(180);
    const keys = new Set(outcomes.map((c) => JSON.stringify(c)));
    expect(keys.size).toBe(180);
  });

  test("utility and nash scoring are deterministic", () => {
    const contract = {
      Price: "$3.98",
      Delivery: "45 days",
      Payment: "Upon delivery",
      Returns: "5% spoilage allowed",
    } as const;
    const a = profileFor("manufacturer");
    const b = profileFor("buyer");
    const uA = utilityOf(contract, a);
    const uB = utilityOf(contract, b);
    expect(uA).toBeGreaterThan(0);
    expect(uB).toBeGreaterThan(0);
    const scored = scoreContract(contract, a, b);
    expect(scored.utilityA).toBeCloseTo(uA, 10);
    expect(scored.utilityB).toBeCloseTo(uB, 10);
    expect(scored.socialWelfare).toBeCloseTo(uA + uB, 10);
    const nash = nashBargainingPoint(a, b);
    expect(nash.nashProduct).toBeGreaterThan(0);
    expect(nash.pareto).toBe(true);
  });
});

describe("agreement reconstruction", () => {
  test("complete terminal graph yields valid contract utilities", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const memory = new MarkdownMemoryStore(root);
      const policy = createScriptedBindPolicy();
      const episode = await runEpisode({
        id: "agr",
        condition: "scripted",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_B,
        purpose: "test",
        maxTurns: 4,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
      });
      expect(episode.outcome).toBe("bound");
      expect(episode.agreement?.status).toBe("valid");
      expect(episode.agreement?.contract?.Price).toBe("$3.98");
      expect(episode.agreement?.score?.utilityA).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("conflicting commitments are invalid", () => {
    const graph = {
      parties: [],
      extends: [],
      exposes: [],
      offers: [
        { id: "o1", type: "service.a", expires_turn: 0, expires_at_ms: 0, partyId: AGENT_A },
        { id: "o2", type: "service.b", expires_turn: 0, expires_at_ms: 0, partyId: AGENT_B },
      ],
      ports: [
        {
          id: "p1",
          kind: "c",
          promise: "x",
          ref: "",
          expires_turn: 0,
          expires_at_ms: 0,
          exposedOnOfferIds: ["o1"],
          bindCount: 1,
          terminal: false,
          bind_policy: {
            type: "object",
            properties: { Price: { const: "$4.37" } },
          },
        },
        {
          id: "p2",
          kind: "c",
          promise: "y",
          ref: "",
          expires_turn: 0,
          expires_at_ms: 0,
          exposedOnOfferIds: ["o1"],
          bindCount: 1,
          terminal: true,
          bind_policy: {
            type: "object",
            properties: { Price: { const: "$3.47" } },
          },
        },
      ],
      binds: [
        { offerId: "o2", portId: "p1", bind_payload: {} },
        { offerId: "o2", portId: "p2", bind_payload: {} },
      ],
    };
    const result = reconstructAgreement(graph, "manufacturer", "buyer");
    expect(result.status).toBe("conflict");
  });

  test("reconstructs from issue-named ports, value fields, and JSON promises", () => {
    const graph = {
      parties: [],
      extends: [],
      exposes: [],
      offers: [
        { id: "o1", type: "service.a", expires_turn: 0, expires_at_ms: 0, partyId: AGENT_A },
        { id: "o2", type: "service.b", expires_turn: 0, expires_at_ms: 0, partyId: AGENT_B },
      ],
      ports: [
        {
          id: "p1",
          kind: "Price",
          promise: "$3.98",
          ref: "",
          expires_turn: 0,
          expires_at_ms: 0,
          exposedOnOfferIds: ["o1"],
          bindCount: 1,
          terminal: false,
        },
        {
          id: "p2",
          kind: "Delivery",
          promise: "open",
          ref: "",
          expires_turn: 0,
          expires_at_ms: 0,
          exposedOnOfferIds: ["o1"],
          bindCount: 1,
          terminal: false,
        },
        {
          id: "p3",
          kind: "offer",
          promise: '{"Payment":"Upon delivery","Returns":"5% spoilage allowed"}',
          ref: "",
          expires_turn: 0,
          expires_at_ms: 0,
          exposedOnOfferIds: ["o1"],
          bindCount: 1,
          terminal: true,
        },
      ],
      binds: [
        { offerId: "o2", portId: "p1", bind_payload: {} },
        { offerId: "o2", portId: "p2", bind_payload: { value: "45 days" } },
        { offerId: "o2", portId: "p3", bind_payload: {} },
      ],
    };
    const result = reconstructAgreement(
      graph as import("@khoralabs/obp-nbc").NbcChainGraph,
      "manufacturer",
      "buyer",
    );
    expect(result.status).toBe("valid");
    expect(result.contract).toEqual({
      Price: "$3.98",
      Delivery: "45 days",
      Payment: "Upon delivery",
      Returns: "5% spoilage allowed",
    });
  });
});

describe("lab turn wire", () => {
  test("allows expose-only, bind-only, expose+bind, and disconnect", () => {
    expect(labTurnToWire({ disconnect: true })).toEqual({ kind: "disconnect" });
    const exposeOnly = labTurnToWire({
      expose: [{ kind: "a", promise: "b", terminal: false, max_bindings: 1 }],
    });
    expect(exposeOnly.kind).toBe("offer");
    if (exposeOnly.kind === "offer") {
      expect(exposeOnly.body.bind_port_id).toBe("");
      expect((exposeOnly.body.ports as unknown[]).length).toBe(1);
    }
    const bindOnly = labTurnToWire({
      bind: { portId: "p1", payload: { Price: "$3.98" } },
    });
    expect(bindOnly.kind).toBe("offer");
    if (bindOnly.kind === "offer") {
      expect(bindOnly.body.bind_port_id).toBe("p1");
    }
    const both = labTurnToWire({
      bind: { portId: "p1", payload: {} },
      expose: [{ kind: "x", promise: "y" }],
    });
    expect(both.kind).toBe("offer");
  });
});

describe("negotiation-lab", () => {
  test("scripted opening→bind reaches terminal graph with stable signature", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const memory = new MarkdownMemoryStore(root);
      const policy = createScriptedBindPolicy();
      const a = await runEpisode({
        id: "e1",
        condition: "scripted",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_B,
        purpose: "test",
        maxTurns: 4,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
      });
      expect(a.outcome).toBe("bound");
      expect(a.turns).toBe(2);
      expect(a.graph.binds.length).toBe(1);
      const sig = protocolSignature(a.graph, AGENT_A);
      expect(sig).toContain("contract.complete");
      expect(sig).toContain("itex.v1");
      expect(sig).toContain("binds=counterparty:T:");
      expect(signatureStability([sig, sig])).toBe(1);

      const b = await runEpisode({
        id: "e2",
        condition: "scripted",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_B,
        purpose: "test",
        maxTurns: 4,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
      });
      expect(b.outcome).toBe("bound");
      expect(b.protocolSignature).toBe(a.protocolSignature);
      expect(b.experiencesShown.initiator.chains.length).toBe(1);
      expect(b.experiencesShown.initiator.chains[0]?.graph.binds.length).toBe(1);
      const prior = b.experiencesShown.initiator.chains[0];
      expect(prior?.validityEvaluation?.kind).toBe("deal_validity_evaluation");
      expect(prior?.validityEvaluation?.source).toBe("oracle");
      expect(prior?.validityEvaluation?.satisfied).toBe(true);
      expect(prior?.validityEvaluation?.status).toBe("valid");
      // Viewer-scoped: no peer utility field leakage from score
      expect(JSON.stringify(prior?.validityEvaluation)).not.toContain("utilityB");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reflection failures become episode errors", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const memory = new MarkdownMemoryStore(root);
      const policy = createScriptedBindPolicy();
      const episode = await runEpisode({
        id: "reflection-error",
        condition: "scripted",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_B,
        purpose: "test",
        maxTurns: 4,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
        reflect: async () => {
          throw new Error("gateway unavailable");
        },
      });

      expect(episode.outcome).toBe("error");
      expect(episode.error).toBe("reflection failed: gateway unavailable");
      expect(episode.graph.binds.length).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("nonterminal bind continues until a terminal bind", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const memory = new MarkdownMemoryStore(root);
      const policy = createScriptedBindPolicy({ terminal: false });
      const episode = await runEpisode({
        id: "multi",
        condition: "scripted",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_B,
        purpose: "test",
        maxTurns: 6,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
      });
      expect(episode.outcome).toBe("bound");
      expect(episode.turns).toBeGreaterThan(2);
      expect(episode.graph.binds.length).toBeGreaterThan(1);
      expect(episode.agreement?.status).toBe("valid");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("turn limit stops without terminal bind", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const memory = new MarkdownMemoryStore(root);
      const policy = createScriptedBindPolicy();
      const episode = await runEpisode({
        id: "limit",
        condition: "limit",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_B,
        purpose: "test",
        maxTurns: 1,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
      });
      expect(episode.outcome).toBe("turn-limit");
      expect(episode.turns).toBe(1);
      expect(episode.graph.binds.length).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("Markdown scope isolation: B notes withheld from A↔C", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const memory = new MarkdownMemoryStore(root);
      memory.appendGeneral(AGENT_A, "general convention: use plan payload");
      memory.appendPeer(AGENT_A, AGENT_B, "SECRET_B_ONLY peer convention");

      const shownAb = memory.readScoped(AGENT_A, AGENT_B);
      expect(shownAb.peer).toContain("SECRET_B_ONLY");
      expect(shownAb.general).toContain("general convention");

      const shownAc = memory.readScoped(AGENT_A, AGENT_C);
      expect(shownAc.general).toContain("general convention");
      expect(shownAc.peer).not.toContain("SECRET_B_ONLY");
      expect(shownAc.peer).toBe("");

      const policy = createScriptedBindPolicy();
      const episode = await runEpisode({
        id: "ac",
        condition: "ac-trained",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_C,
        purpose: "test",
        maxTurns: 4,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
        reflect: async () => ({
          generalNote: "shared",
          peerNote: "with-c",
        }),
      });
      expect(episode.memoryShown.initiator.peer).toBe("");
      expect(episode.memoryShown.initiator.general).toContain("general convention");
      expect(
        episode.memoryDiffs.some((d) => d.actorDid === AGENT_A && d.peerAppend === "with-c"),
      ).toBe(true);
      const after = memory.readScoped(AGENT_A, AGENT_B);
      expect(after.peer).toContain("SECRET_B_ONLY");
      expect(after.peer).not.toContain("with-c");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("agents receive all prior chains including cross-peer", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const memory = new MarkdownMemoryStore(root);
      const policy = createScriptedBindPolicy();
      const ab = await runEpisode({
        id: "ab-1",
        condition: "scripted",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_B,
        purpose: "test",
        maxTurns: 4,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
      });
      expect(ab.outcome).toBe("bound");

      const withB = memory.readScopedExperiences(AGENT_A, AGENT_B);
      expect(withB.chains.length).toBe(1);
      expect(withB.chains[0]?.peerDid).toBe(AGENT_B);

      const ac = await runEpisode({
        id: "ac-1",
        condition: "ac-trained",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_C,
        purpose: "test",
        maxTurns: 4,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
      });
      expect(ac.experiencesShown.initiator.chains.length).toBe(1);
      expect(ac.experiencesShown.initiator.chains[0]?.peerDid).toBe(AGENT_B);
      expect(ac.experiencesShown.initiator.chains[0]?.graph.binds.length).toBe(1);
      // Private opponent utility never appears in graph experiences.
      expect(JSON.stringify(ac.experiencesShown)).not.toContain("SECRET_B_ONLY");
      expect(JSON.stringify(ac.experiencesShown)).not.toContain("0.4700166576535899");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("offer/port libraries attribute and fingerprint reuse", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const memory = new MarkdownMemoryStore(root);
      const policy = createScriptedBindPolicy();
      await runEpisode({
        id: "lib-1",
        condition: "scripted",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_B,
        purpose: "test",
        maxTurns: 4,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
      });
      await runEpisode({
        id: "lib-2",
        condition: "scripted",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_B,
        purpose: "test",
        maxTurns: 4,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
      });
      const libA = memory.readLibrary(AGENT_A);
      const libB = memory.readLibrary(AGENT_B);
      expect(libA.some((e) => e.kind === "offer" && e.authored)).toBe(true);
      expect(libA.some((e) => e.kind === "port" && e.authored)).toBe(true);
      expect(libB.some((e) => e.kind === "bound-peer-port" && e.bound)).toBe(true);
      expect(libA.some((e) => e.useCount >= 2)).toBe(true);
      expect(libraryReuseRate(libA)).toBeGreaterThan(0);

      const priorGraph = memory.readScopedExperiences(AGENT_A, AGENT_B).chains[0]?.graph;
      if (priorGraph === undefined) throw new Error("expected prior experience graph");
      const observed = observeLibraryFromGraph({
        actorDid: AGENT_A,
        episodeId: "x",
        peerDid: AGENT_B,
        role: "initiator",
        outcome: "bound",
        graph: priorGraph,
      });
      expect(observed.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("experiment arm order, isolation, and metrics", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const policy = createScriptedBindPolicy();
      const summary = await runConventionExperiment({
        runId: "scripted-arms",
        rootDir: root,
        model: "scripted",
        repeats: 1,
        maxTurns: 4,
        timeoutMs: 5_000,
        armOrder: "memory-first",
        policy,
        reflectEnabled: false,
      });

      expect(summary.domain).toBe("itex-cypress");
      expect(summary.episodes.map((e) => e.condition)).toEqual([
        "ab-persistent-baseline",
        "ab-persistent-repeat-1",
        "ac-trained",
        "ab-reset-1",
        "ab-reset-2",
        "ac-fresh-control",
      ]);
      expect(summary.metrics.overallAgreementRate).toBe(1);
      expect(summary.metrics.persistentAgreementRate).toBe(1);
      expect(summary.metrics.resetAgreementRate).toBe(1);
      expect(summary.metrics.latePersistentSimilarity).toBe(1);
      expect(summary.metrics.libraryReuseRatePersistentA).toBeGreaterThan(0);
      expect(slope([4, 3, 2])).toBeCloseTo(-1, 5);

      const trained = summary.episodes.find((e) => e.condition === "ac-trained");
      expect(trained?.memoryShown.initiator.peer).toBe("");
      expect(trained?.experiencesShown.initiator.chains.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reset arm starts blank each episode", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const policy = createScriptedBindPolicy();
      let resetSeen = 0;
      const summary = await runConventionExperiment({
        runId: "reset-blank",
        rootDir: root,
        model: "scripted",
        repeats: 1,
        maxTurns: 4,
        timeoutMs: 5_000,
        armOrder: "reset-first",
        policy,
        reflect: async ({ actorDid }) => {
          resetSeen += 1;
          return {
            generalNote: `note-${actorDid}-${resetSeen}`,
            peerNote: `peer-${resetSeen}`,
          };
        },
      });
      expect(summary.armOrder).toBe("reset-first");
      expect(summary.episodes[0]?.condition).toBe("ab-reset-1");
      const resetEpisodes = summary.episodes.filter((e) => e.condition.startsWith("ab-reset-"));
      for (const ep of resetEpisodes) {
        expect(ep.memoryShown.initiator.general).toBe("");
        expect(ep.memoryShown.initiator.peer).toBe("");
        expect(ep.memoryShown.counterparty.general).toBe("");
        expect(ep.memoryShown.counterparty.peer).toBe("");
        expect(ep.experiencesShown.initiator.chains).toEqual([]);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("negotiation-lab metrics fixtures", () => {
  test("fixture metrics prefer negotiation tokens and late-three turn deltas", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const memory = new MarkdownMemoryStore(root);
      const policy = createScriptedBindPolicy();
      const g1 = await runEpisode({
        id: "g1",
        condition: "tmp",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_B,
        purpose: "test",
        maxTurns: 4,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
      });
      const g2 = await runEpisode({
        id: "g2",
        condition: "tmp",
        initiatorDid: AGENT_A,
        counterpartyDid: AGENT_B,
        purpose: "test",
        maxTurns: 4,
        timeoutMs: 5_000,
        memory,
        policyFor: () => policy,
        roleForDid: defaultRoleForDid,
      });

      const episodes = [
        fixtureEpisode({
          id: "p0",
          condition: "ab-persistent-baseline",
          turns: 4,
          negotiationTokens: { input: 100, output: 50, total: 150 },
          tokens: { input: 200, output: 100, total: 300 },
          agreement: g1.agreement,
          graph: g1.graph,
        }),
        fixtureEpisode({
          id: "p1",
          condition: "ab-persistent-repeat-1",
          turns: 3,
          negotiationTokens: { input: 40, output: 20, total: 60 },
          tokens: { input: 80, output: 40, total: 120 },
          agreement: g2.agreement,
          graph: g2.graph,
        }),
        fixtureEpisode({
          id: "p2",
          condition: "ab-persistent-repeat-2",
          turns: 2,
          negotiationTokens: { input: 40, output: 20, total: 60 },
          tokens: { input: 80, output: 40, total: 120 },
          agreement: g2.agreement,
          graph: g2.graph,
        }),
        fixtureEpisode({
          id: "r0",
          condition: "ab-reset-1",
          turns: 4,
          negotiationTokens: { input: 100, output: 50, total: 150 },
          tokens: { input: 200, output: 100, total: 300 },
          agreement: g1.agreement,
          graph: g1.graph,
        }),
        fixtureEpisode({
          id: "r1",
          condition: "ab-reset-2",
          turns: 4,
          negotiationTokens: { input: 110, output: 55, total: 165 },
          tokens: { input: 220, output: 110, total: 330 },
          agreement: g1.agreement,
          graph: g1.graph,
        }),
        fixtureEpisode({
          id: "r2",
          condition: "ab-reset-3",
          turns: 5,
          negotiationTokens: { input: 110, output: 55, total: 165 },
          tokens: { input: 220, output: 110, total: 330 },
          agreement: g1.agreement,
          graph: g1.graph,
        }),
        fixtureEpisode({
          id: "ac-t",
          condition: "ac-trained",
          counterpartyDid: AGENT_C,
          turns: 2,
          negotiationTokens: { input: 40, output: 20, total: 60 },
          agreement: g2.agreement,
          graph: g2.graph,
        }),
        fixtureEpisode({
          id: "ac-f",
          condition: "ac-fresh-control",
          counterpartyDid: AGENT_C,
          turns: 4,
          negotiationTokens: { input: 100, output: 50, total: 150 },
          agreement: g1.agreement,
          graph: g1.graph,
        }),
      ];

      const metrics = computeConvergenceMetrics(episodes);
      expect(metrics.persistentLateThreeMeanTurns).toBeCloseTo((4 + 3 + 2) / 3, 5);
      expect(metrics.resetLateThreeMeanTurns).toBeCloseTo((4 + 4 + 5) / 3, 5);
      expect(metrics.persistentMinusResetLateThreeTurnDelta).toBeCloseTo(
        (4 + 3 + 2) / 3 - (4 + 4 + 5) / 3,
        5,
      );
      expect(metrics.persistentTurnSlope).toBeLessThan(0);
      expect(metrics.trainedMinusFreshTransferSimilarity).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
