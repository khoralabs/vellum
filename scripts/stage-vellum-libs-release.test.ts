import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  resolveCatalogVersion,
  resolveDependencyMap,
  stagedClientExports,
  stagedDependencies,
} from "./stage-vellum-libs-release";

const workspaceRoot = path.resolve(import.meta.dir, "..");

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
      "./pool/host",
    ] as const) {
      const s = exports[sub] as Record<string, string>;
      expect(s.types.startsWith("./dist/")).toBe(true);
      expect(s.types.endsWith(".d.ts")).toBe(true);
      expect(s.import.startsWith("./dist/")).toBe(true);
      expect(s.import.endsWith(".js")).toBe(true);
      expect(s.default).toBe(s.import);
    }
  });

  test("resolveCatalogVersion maps catalog: to root catalog ranges", () => {
    const catalogs = {
      defaultCatalog: { zod: "^4", "@khoralabs/relay": "^0.1.1" },
      named: { testing: { jest: "30.0.0" } },
    };
    expect(resolveCatalogVersion("zod", "catalog:", catalogs)).toBe("^4");
    expect(resolveCatalogVersion("jest", "catalog:testing", catalogs)).toBe("30.0.0");
    expect(resolveCatalogVersion("left-alone", "^1.0.0", catalogs)).toBe("^1.0.0");
  });

  test("resolveDependencyMap resolves mixed catalog and literal versions", () => {
    const catalogs = {
      defaultCatalog: { zod: "^4" },
      named: {},
    };
    expect(resolveDependencyMap({ zod: "catalog:", leftover: "^9.0.0" }, catalogs)).toEqual({
      zod: "^4",
      leftover: "^9.0.0",
    });
  });

  test("client publishes OBP/relay runtime deps resolved from workspace catalog", () => {
    const deps = stagedDependencies(workspaceRoot, "vellum-client");
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
