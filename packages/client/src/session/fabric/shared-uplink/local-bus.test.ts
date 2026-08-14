import { describe, expect, test } from "bun:test";
import { LocalChannelBus } from "./local-bus";

async function collectN(
  iter: AsyncIterable<Uint8Array>,
  n: number,
  ms = 200,
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  const deadline = Date.now() + ms;
  for await (const chunk of iter) {
    out.push(chunk);
    if (out.length >= n) break;
    if (Date.now() > deadline) break;
  }
  return out;
}

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

function expectFirstChunk(chunks: Uint8Array[], expected: number[]): void {
  expect(chunks.length).toBeGreaterThanOrEqual(1);
  const first = chunks[0];
  expect(first).toBeDefined();
  if (first === undefined) return;
  expect([...first]).toEqual(expected);
}

describe("LocalChannelBus", () => {
  test("two endpoints: A write delivers to B only (no self short-circuit)", async () => {
    const bus = new LocalChannelBus();
    const a = bus.addEndpoint();
    const b = bus.addEndpoint();
    const bRead = collectN(b.read(), 1);
    bus.deliverFromLocal(a.id, bytes(1, 2, 3));
    const got = await bRead;
    expectFirstChunk(got, [1, 2, 3]);
    expect(a.getFrameCount()).toBe(0);
    expect(b.getFrameCount()).toBe(1);
  });

  test("three endpoints: A write delivers one copy each to B and C", async () => {
    const bus = new LocalChannelBus();
    const a = bus.addEndpoint();
    const b = bus.addEndpoint();
    const c = bus.addEndpoint();
    const bRead = collectN(b.read(), 1);
    const cRead = collectN(c.read(), 1);
    bus.deliverFromLocal(a.id, bytes(9));
    expectFirstChunk(await bRead, [9]);
    expectFirstChunk(await cRead, [9]);
  });

  test("write after peer close does not throw; remaining peers still receive", async () => {
    const bus = new LocalChannelBus();
    const a = bus.addEndpoint();
    const b = bus.addEndpoint();
    const c = bus.addEndpoint();
    b.close();
    const cRead = collectN(c.read(), 1);
    expect(() => bus.deliverFromLocal(a.id, bytes(4))).not.toThrow();
    expectFirstChunk(await cRead, [4]);
  });

  test("concurrent writes from A and B both deliver", async () => {
    const bus = new LocalChannelBus();
    const a = bus.addEndpoint();
    const b = bus.addEndpoint();
    const aRead = collectN(a.read(), 1);
    const bRead = collectN(b.read(), 1);
    bus.deliverFromLocal(a.id, bytes(1));
    bus.deliverFromLocal(b.id, bytes(2));
    expectFirstChunk(await bRead, [1]);
    expectFirstChunk(await aRead, [2]);
  });

  test("getFrameCount is per-endpoint and monotonic", async () => {
    const bus = new LocalChannelBus();
    const a = bus.addEndpoint();
    const b = bus.addEndpoint();
    const bRead = collectN(b.read(), 2);
    bus.deliverFromLocal(a.id, bytes(1));
    bus.deliverFromLocal(a.id, bytes(2));
    await bRead;
    expect(b.getFrameCount()).toBe(2);
    expect(a.getFrameCount()).toBe(0);
    bus.pushFromUplink(bytes(3));
    const aUp = collectN(a.read(), 1);
    const bUp = collectN(b.read(), 1);
    expectFirstChunk(await aUp, [3]);
    expectFirstChunk(await bUp, [3]);
    expect(a.getFrameCount()).toBe(1);
    expect(b.getFrameCount()).toBe(3);
  });

  test("pushFromUplink fans to all endpoints", async () => {
    const bus = new LocalChannelBus();
    const a = bus.addEndpoint();
    const b = bus.addEndpoint();
    const aRead = collectN(a.read(), 1);
    const bRead = collectN(b.read(), 1);
    bus.pushFromUplink(bytes(7, 8));
    expectFirstChunk(await aRead, [7, 8]);
    expectFirstChunk(await bRead, [7, 8]);
  });
});
