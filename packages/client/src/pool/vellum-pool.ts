import path from "node:path";
import type { PersistableSigner } from "@khoralabs/did-key-identity";
import {
  type OpenVellumAttachmentOptions,
  openVellumAttachment,
  type VellumAttachmentHandle,
} from "../session";
import { VellumClient } from "../vellum-client";

export type VellumPoolAttachmentRef = {
  did: string;
  channelId: string;
};

export type VellumPoolEvent =
  | { kind: "ready"; did: string; channelId: string }
  | { kind: "closed"; did: string; channelId: string }
  | { kind: "error"; did: string; channelId: string; error: unknown };

export type VellumPoolBindInput = {
  signer: PersistableSigner;
  channelId: string;
};

export type OpenPoolAttachment = (
  opts: OpenVellumAttachmentOptions,
) => VellumAttachmentHandle | Promise<VellumAttachmentHandle>;

export type VellumPoolOptions = {
  relayBaseUrl: string;
  /**
   * Root for per-attachment data dirs:
   * `{dataDirRoot}/{encodeURIComponent(did)}/{encodeURIComponent(channelId)}`
   *
   * Each attachment gets its own SQLite + control file so multiple DIDs can share a channelId.
   */
  dataDirRoot: string;
  /**
   * Optional injector for tests — default {@link openVellumAttachment}
   * (mint ticket + in-process session).
   */
  openAttachment?: OpenPoolAttachment;
};

function attachmentKey(did: string, channelId: string): string {
  return `${did}\0${channelId}`;
}

function attachmentDataDir(root: string, did: string, channelId: string): string {
  return path.join(root, encodeURIComponent(did), encodeURIComponent(channelId));
}

type BoundAttachment = {
  did: string;
  channelId: string;
  signer: PersistableSigner;
  dataDir: string;
  session: VellumAttachmentHandle;
  client: VellumClient;
};

/**
 * Host-facing channel attachment pool (Khora HarnessPoolInbox shape).
 *
 * Membership is per `(did, channelId)`. Wire still opens **one relay WebSocket per
 * attachment** today; demux is by did+channelId on this host.
 */
export class VellumPool {
  readonly #relayBaseUrl: string;
  readonly #dataDirRoot: string;
  readonly #openAttachment: OpenPoolAttachment;
  readonly #attachments = new Map<string, BoundAttachment>();
  /** In-flight bind promises keyed by attachment; concurrent binds await the same promise. */
  readonly #pendingBinds = new Map<string, Promise<void>>();
  /** Bumped on unbind/close so in-flight binds discard orphaned sessions. */
  readonly #bindGeneration = new Map<string, number>();
  readonly #listeners = new Set<(event: VellumPoolEvent) => void>();
  #closed = false;

  constructor(opts: VellumPoolOptions) {
    this.#relayBaseUrl = opts.relayBaseUrl.trim().replace(/\/$/, "");
    if (this.#relayBaseUrl.length === 0) {
      throw new Error("VellumPool: relayBaseUrl is required");
    }
    const dataDirRoot = opts.dataDirRoot.trim();
    if (dataDirRoot.length === 0) {
      throw new Error("VellumPool: dataDirRoot is required");
    }
    this.#dataDirRoot = path.resolve(dataDirRoot);
    this.#openAttachment = opts.openAttachment ?? openVellumAttachment;
  }

  /** Fan-out lifecycle events tagged with did + channelId. Returns unsubscribe. */
  subscribe(listener: (event: VellumPoolEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Currently bound attachments. */
  list(): readonly VellumPoolAttachmentRef[] {
    return [...this.#attachments.values()].map((a) => ({
      did: a.did,
      channelId: a.channelId,
    }));
  }

  /**
   * Bind a principal to a channel (idempotent). Starts an in-process session when missing.
   * Concurrent binds for the same key share one in-flight setup.
   */
  async bind(input: VellumPoolBindInput): Promise<void> {
    if (this.#closed) throw new Error("VellumPool: closed");
    const channelId = input.channelId.trim();
    if (channelId.length === 0) throw new Error("VellumPool.bind: channelId is required");
    const did = input.signer.did;
    const key = attachmentKey(did, channelId);
    if (this.#attachments.has(key)) return;

    const pending = this.#pendingBinds.get(key);
    if (pending !== undefined) {
      await pending;
      return;
    }

    const work = this.#bindOnce(key, did, channelId, input.signer);
    this.#pendingBinds.set(key, work);
    try {
      await work;
    } finally {
      if (this.#pendingBinds.get(key) === work) {
        this.#pendingBinds.delete(key);
      }
    }
  }

  async #bindOnce(
    key: string,
    did: string,
    channelId: string,
    signer: PersistableSigner,
  ): Promise<void> {
    const generation = this.#bindGeneration.get(key) ?? 0;
    const dataDir = attachmentDataDir(this.#dataDirRoot, did, channelId);
    let session: VellumAttachmentHandle | undefined;
    try {
      if (this.#closed) throw new Error("VellumPool: closed");
      session = await Promise.resolve(
        this.#openAttachment({
          relayBaseUrl: this.#relayBaseUrl,
          signer,
          channelId,
          cfg: { dataDir },
        }),
      );
      await session.ready;

      if (this.#closed || (this.#bindGeneration.get(key) ?? 0) !== generation) {
        session.close();
        session = undefined;
        if (this.#closed) throw new Error("VellumPool: closed");
        // Unbound during setup — treat as cancelled bind (no attachment).
        return;
      }

      const client = new VellumClient({
        relayBaseUrl: this.#relayBaseUrl,
        channelId,
        dataDir,
        signer,
        controlTransport: session.controlTransport,
      });
      this.#attachments.set(key, {
        did,
        channelId,
        signer,
        dataDir,
        session,
        client,
      });
      this.#fanout({ kind: "ready", did, channelId });
    } catch (error) {
      session?.close();
      this.#fanout({ kind: "error", did, channelId, error });
      throw error;
    }
  }

  /** Detach one principal from a channel. */
  async unbind(ref: VellumPoolAttachmentRef): Promise<void> {
    const key = attachmentKey(ref.did, ref.channelId.trim());
    this.#bumpGeneration(key);
    const att = this.#attachments.get(key);
    if (att === undefined) return;
    this.#attachments.delete(key);
    att.session.close();
    this.#fanout({ kind: "closed", did: att.did, channelId: att.channelId });
  }

  /**
   * Ops facade for a bound attachment (same surface as {@link VellumClient} channel ops).
   * @throws if not bound
   */
  handle(ref: VellumPoolAttachmentRef): VellumClient {
    const key = attachmentKey(ref.did, ref.channelId.trim());
    const att = this.#attachments.get(key);
    if (att === undefined) {
      throw new Error(`VellumPool: not bound did=${ref.did} channelId=${ref.channelId}`);
    }
    return att.client;
  }

  /** Unbind all attachments and reject further binds. */
  close(): void {
    this.#closed = true;
    for (const key of new Set([...this.#attachments.keys(), ...this.#pendingBinds.keys()])) {
      this.#bumpGeneration(key);
    }
    for (const att of this.#attachments.values()) {
      att.session.close();
      this.#fanout({ kind: "closed", did: att.did, channelId: att.channelId });
    }
    this.#attachments.clear();
    this.#listeners.clear();
  }

  #bumpGeneration(key: string): void {
    this.#bindGeneration.set(key, (this.#bindGeneration.get(key) ?? 0) + 1);
  }

  #fanout(event: VellumPoolEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // ignore subscriber errors
      }
    }
  }
}
