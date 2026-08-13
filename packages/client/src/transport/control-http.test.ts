import { describe, expect, test } from "bun:test";
import { createVellumControlTransportFromEnv, FetchVellumControlTransport } from "./control-http";

describe("FetchVellumControlTransport", () => {
  test("joins base URL and path", async () => {
    let seenUrl = "";
    const t = new FetchVellumControlTransport({
      resolveBaseUrl: () => "http://127.0.0.1:9",
      fetch: async (input) => {
        seenUrl = typeof input === "string" ? input : input.toString();
        return new Response('{"ok":true}', { status: 200 });
      },
    });
    const res = await t.fetch("/health");
    expect(res.ok).toBe(true);
    expect(seenUrl).toBe("http://127.0.0.1:9/health");
  });
});

describe("createVellumControlTransportFromEnv", () => {
  test("http default returns Fetch transport", () => {
    const t = createVellumControlTransportFromEnv({
      resolveBaseUrl: () => "http://127.0.0.1:1",
      env: {},
    });
    expect(t).toBeInstanceOf(FetchVellumControlTransport);
  });

  test("unsupported mode throws", () => {
    expect(() =>
      createVellumControlTransportFromEnv({
        resolveBaseUrl: () => "http://127.0.0.1:1",
        env: { VELLUM_CONTROL_TRANSPORT: "unix" },
      }),
    ).toThrow(/VELLUM_CONTROL_TRANSPORT=unix/);
  });
});
