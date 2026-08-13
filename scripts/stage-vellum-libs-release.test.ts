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

  test("client does not depend on workspace contracts package", () => {
    const deps = stagedDependencies("vellum-client", "1.2.3");
    expect(deps["@khoralabs/vellum-contracts"]).toBeUndefined();
    expect(deps["@khoralabs/did-key-identity"]).toBe("^0.1.0");
    expect(deps["better-sqlite3"]).toBeUndefined();
    expect(deps.zod).toBe("^4");
  });
});
