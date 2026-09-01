import { describe, expect, test } from "bun:test";
import { stagedClientExports, stagedDependencies } from "./stage-vellum-libs-release";

describe("stage vellum libs helpers", () => {
  test("client exports include schema, root, and subpath dist entries", () => {
    const exports = stagedClientExports();
    const e = exports["."] as Record<string, string>;
    expect(e.types).toBe("./dist/index.d.ts");
    expect(e.import).toBe("./dist/index.js");
    expect(exports["./vellum-config.schema.json"]).toBe("./vellum-config.schema.json");
    for (const sub of [
      "./contracts",
      "./transport",
      "./session",
      "./persistence",
      "./sqlite",
      "./pool",
    ] as const) {
      const s = exports[sub] as Record<string, string>;
      expect(s.types.startsWith("./dist/")).toBe(true);
      expect(s.types.endsWith(".d.ts")).toBe(true);
      expect(s.import.startsWith("./dist/")).toBe(true);
      expect(s.import.endsWith(".js")).toBe(true);
      expect(s.default).toBe(s.import);
    }
  });

  test("client publishes OBP/relay runtime deps and omits workspace-only packages", () => {
    const deps = stagedDependencies("vellum-client", "1.2.3");
    expect(deps["@khoralabs/vellum-contracts"]).toBeUndefined();
    expect(deps["better-sqlite3"]).toBeUndefined();
    expect(deps["@khoralabs/did-key-identity"]).toBe("^0.1.0");
    expect(deps["@khoralabs/obp-core"]).toBe("^0.2.1");
    expect(deps["@khoralabs/obp-nbc"]).toBe("^0.2.1");
    expect(deps["@khoralabs/obp-wire"]).toBe("^0.2.1");
    expect(deps["@khoralabs/relay"]).toBe("^0.1.1");
    expect(deps.zod).toBe("^4");
  });
});
