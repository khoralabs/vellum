import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runEpisode } from "./episode-runner.ts";
import { MarkdownMemoryStore } from "./memory.ts";
import { createScriptedBindPolicy } from "./policy.ts";
import { protocolSignature, signatureStability } from "./protocol-signature.ts";
import { AGENT_A, AGENT_B, AGENT_C } from "./types.ts";

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
      });
      expect(a.outcome).toBe("bound");
      expect(a.turns).toBe(2);
      expect(a.graph.binds.length).toBe(1);
      const sig = protocolSignature(a.graph, AGENT_A);
      expect(sig).toContain("coord.slot");
      expect(sig).toContain("orchestration.v1");
      expect(sig).toContain("binder=counterparty");
      expect(sig).toContain("payload=plan");
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
      });
      expect(b.outcome).toBe("bound");
      expect(b.protocolSignature).toBe(a.protocolSignature);
      // Fresh persistence each episode (no cross-episode offer/bind carry-over).
      expect(b.graph.offers.length).toBe(a.graph.offers.length);
      expect(b.graph.binds.length).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("turn limit stops without bind", async () => {
    const root = mkdtempSync(join(tmpdir(), "neg-lab-"));
    try {
      const memory = new MarkdownMemoryStore(root);
      const policy = createScriptedBindPolicy();
      // Opening-only policy that never binds after first expose cycle stalls on continue without ports?
      // Use disconnect-never / expose-only: force maxTurns=1 so initiator opens then limit hits before bind.
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
});
