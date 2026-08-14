/**
 * In-process fan-out bus for one channelId.
 *
 * Write rule: deliver to every *other* local endpoint (no self short-circuit).
 * Uplink inbound is pushed separately via {@link LocalChannelBus.pushFromUplink} to all endpoints
 * (including the original writer — non-init echoes pass through; owned inits are filtered upstream).
 */

export class LocalChannelBus {
  #nextId = 1;
  readonly #endpoints = new Map<number, LocalBusEndpoint>();

  addEndpoint(): LocalBusEndpoint {
    const id = this.#nextId++;
    const ep = new LocalBusEndpoint(id, () => this.#endpoints.delete(id));
    this.#endpoints.set(id, ep);
    return ep;
  }

  /** Short-circuit deliver to peers (not the writer). */
  deliverFromLocal(writerId: number, bytes: Uint8Array): void {
    for (const [id, ep] of this.#endpoints) {
      if (id === writerId || ep.closed) continue;
      ep.enqueue(bytes.slice());
    }
  }

  /** Fan-in from shared uplink (including echoes) to every local endpoint. */
  pushFromUplink(bytes: Uint8Array): void {
    for (const ep of this.#endpoints.values()) {
      if (ep.closed) continue;
      ep.enqueue(bytes.slice());
    }
  }

  get size(): number {
    return this.#endpoints.size;
  }

  closeAll(reason?: unknown): void {
    for (const ep of [...this.#endpoints.values()]) {
      ep.close(reason);
    }
  }
}

export class LocalBusEndpoint {
  readonly id: number;
  #closed = false;
  /** Frames delivered through {@link read}. */
  #frameCount = 0;
  readonly #queue: Uint8Array[] = [];
  #wait: ((v: IteratorResult<Uint8Array>) => void) | undefined;
  readonly #onRemove: () => void;

  constructor(id: number, onRemove: () => void) {
    this.id = id;
    this.#onRemove = onRemove;
  }

  get closed(): boolean {
    return this.#closed;
  }

  getFrameCount(): number {
    return this.#frameCount;
  }

  enqueue(bytes: Uint8Array): void {
    if (this.#closed) return;
    if (this.#wait !== undefined) {
      const w = this.#wait;
      this.#wait = undefined;
      w({ value: bytes, done: false });
      return;
    }
    this.#queue.push(bytes);
  }

  async *read(): AsyncIterable<Uint8Array> {
    while (!this.#closed || this.#queue.length > 0) {
      if (this.#queue.length > 0) {
        const next = this.#queue.shift();
        if (next === undefined) continue;
        this.#frameCount++;
        yield next;
        continue;
      }
      if (this.#closed) break;
      const chunk = await new Promise<IteratorResult<Uint8Array>>((resolve) => {
        this.#wait = resolve;
      });
      if (chunk.done === true) break;
      this.#frameCount++;
      yield chunk.value;
    }
  }

  close(reason?: unknown): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#onRemove();
    if (this.#wait !== undefined) {
      const w = this.#wait;
      this.#wait = undefined;
      w({ value: undefined as unknown as Uint8Array, done: true });
    }
    void reason;
  }
}
