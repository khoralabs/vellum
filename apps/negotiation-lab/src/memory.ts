import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { NbcChainGraph } from "@khoralabs/obp-nbc";

import { mergeLibraryEntries, observeLibraryFromGraph } from "./library.ts";
import type {
  EpisodeOutcome,
  ExperienceIndexEntry,
  NegotiationExperience,
  OfferPortLibraryEntry,
  ScopedExperiences,
  ScopedMemory,
} from "./types.ts";

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function writeText(path: string, body: string): void {
  ensureParent(path);
  writeFileSync(path, body, "utf8");
}

function appendJsonl(path: string, row: unknown): void {
  ensureParent(path);
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
}

function readJsonl<T>(path: string): T[] {
  const text = readText(path);
  if (text.trim().length === 0) return [];
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // skip corrupt lines
    }
  }
  return out;
}

function writeJson(path: string, value: unknown): void {
  ensureParent(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Per-agent Markdown notes, full negotiation chains, and observed offer/port libraries. */
export class MarkdownMemoryStore {
  constructor(readonly rootDir: string) {
    mkdirSync(rootDir, { recursive: true });
  }

  private agentDir(did: string): string {
    return join(this.rootDir, "agents", encodeURIComponent(did));
  }

  private generalPath(did: string): string {
    return join(this.agentDir(did), "general.md");
  }

  private peerPath(actorDid: string, peerDid: string): string {
    return join(this.agentDir(actorDid), "peers", `${encodeURIComponent(peerDid)}.md`);
  }

  private experienceIndexPath(did: string): string {
    return join(this.agentDir(did), "experiences", "index.jsonl");
  }

  private experienceChainsPath(did: string): string {
    return join(this.agentDir(did), "experiences", "chains.jsonl");
  }

  private libraryPath(did: string): string {
    return join(this.agentDir(did), "library", "offers-ports.json");
  }

  /** Only general + current-peer files; never other peer notes. */
  readScoped(actorDid: string, peerDid: string): ScopedMemory {
    return {
      general: readText(this.generalPath(actorDid)),
      peer: readText(this.peerPath(actorDid, peerDid)),
    };
  }

  /**
   * Every complete prior chain for this agent (including cross-peer), plus compact index.
   */
  readScopedExperiences(actorDid: string, _peerDid: string): ScopedExperiences {
    const chains = readJsonl<NegotiationExperience>(this.experienceChainsPath(actorDid));
    const recentIndex = readJsonl<ExperienceIndexEntry>(this.experienceIndexPath(actorDid));
    return { chains, recentIndex };
  }

  readLibrary(actorDid: string): OfferPortLibraryEntry[] {
    const text = readText(this.libraryPath(actorDid));
    if (text.trim().length === 0) return [];
    try {
      const parsed = JSON.parse(text) as OfferPortLibraryEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  appendGeneral(actorDid: string, note: string): void {
    const trimmed = note.trim();
    if (trimmed.length === 0) return;
    const path = this.generalPath(actorDid);
    const prev = readText(path);
    writeText(path, prev.length === 0 ? `${trimmed}\n` : `${prev.trimEnd()}\n\n${trimmed}\n`);
  }

  appendPeer(actorDid: string, peerDid: string, note: string): void {
    const trimmed = note.trim();
    if (trimmed.length === 0) return;
    const path = this.peerPath(actorDid, peerDid);
    const prev = readText(path);
    writeText(path, prev.length === 0 ? `${trimmed}\n` : `${prev.trimEnd()}\n\n${trimmed}\n`);
  }

  /** Persist one completed episode for an actor (full chain + index + library observe). */
  appendExperience(
    actorDid: string,
    input: {
      episodeId: string;
      condition: string;
      peerDid: string;
      role: "initiator" | "counterparty";
      outcome: EpisodeOutcome;
      purpose: string;
      turns: number;
      protocolSignature: string;
      graph: NbcChainGraph;
      validityEvaluation?: NegotiationExperience["validityEvaluation"];
    },
  ): void {
    const index: ExperienceIndexEntry = {
      episodeId: input.episodeId,
      condition: input.condition,
      peerDid: input.peerDid,
      role: input.role,
      outcome: input.outcome,
      purpose: input.purpose,
      turns: input.turns,
      protocolSignature: input.protocolSignature,
      ...(input.validityEvaluation !== undefined
        ? { validityEvaluation: input.validityEvaluation }
        : {}),
    };
    const full: NegotiationExperience = { ...index, graph: input.graph };
    appendJsonl(this.experienceIndexPath(actorDid), index);
    appendJsonl(this.experienceChainsPath(actorDid), full);

    const observed = observeLibraryFromGraph({
      actorDid,
      episodeId: input.episodeId,
      peerDid: input.peerDid,
      role: input.role,
      outcome: input.outcome,
      graph: input.graph,
    });
    const merged = mergeLibraryEntries(this.readLibrary(actorDid), observed);
    writeJson(this.libraryPath(actorDid), merged);
  }

  resetAgent(did: string): void {
    rmSync(this.agentDir(did), { recursive: true, force: true });
  }

  resetAll(): void {
    rmSync(join(this.rootDir, "agents"), { recursive: true, force: true });
  }
}
