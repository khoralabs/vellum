import type { Database } from "bun:sqlite";
import type { PersistableSigner } from "@khoralabs/did-key-identity";
import type { ObpPersistenceClient } from "@khoralabs/obp-core/persistence";
import type { FrameMultiplexOpenerApi, FrameSessionHandle } from "@khoralabs/obp-wire";
import type { VellumPersistence } from "../../persistence/core/types";

export type VellumControlEvent =
  | { kind: "committed"; sessionId: string }
  | { kind: "graph-advanced"; sessionId: string }
  | { kind: "your-turn"; sessionId: string; offersLength: number };

export type VellumControlServerState = {
  /** Set when multiplex connection is ready — `conn.init` / `sendTurn` require this. */
  conn: FrameMultiplexOpenerApi | undefined;
  /** Per `session_id`, `FrameSessionHandle.sendTurn` bridge. */
  handles: Map<string, FrameSessionHandle>;
  /** Optional wake bus for `/events` and in-process subscribers. */
  events?: Set<(e: VellumControlEvent) => void>;
  /** Chain opener DID (empty-graph `whoShouldAct`). */
  initiators?: Map<string, string>;
};

export type VellumControlDispatch = (req: Request) => Promise<Response>;

export type CreateVellumControlDispatchOptions = {
  state: VellumControlServerState;
  /** OBP sqlite for graph summary counts only (not vellum_* meta). */
  db: Database;
  /** Vellum bookkeeping + graph reads (named `meta` to avoid clashing with OBP `persistence`). */
  meta: VellumPersistence;
  persistence: ObpPersistenceClient;
  signer: PersistableSigner;
  myActorPubkeyHex: string;
  /** When set, chain/init requires a prior relay allocation for session_id. */
  isSessionAllocated?: (sessionId: string) => boolean | Promise<boolean>;
};
