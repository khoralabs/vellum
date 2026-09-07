import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ScopedMemory } from "./types.ts";

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

/** Per-agent Markdown memory: general.md + peers/<peerDid>.md */
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

  /** Only general + current-peer files; never other peer notes. */
  readScoped(actorDid: string, peerDid: string): ScopedMemory {
    return {
      general: readText(this.generalPath(actorDid)),
      peer: readText(this.peerPath(actorDid, peerDid)),
    };
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

  resetAgent(did: string): void {
    rmSync(this.agentDir(did), { recursive: true, force: true });
  }

  resetAll(): void {
    rmSync(join(this.rootDir, "agents"), { recursive: true, force: true });
  }
}
