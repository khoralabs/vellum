import { describe, expect, test } from "bun:test";
import { stagedClientExports, stagedDependencies } from "./stage-vellum-libs-release";

describe("stage vellum libs helpers", () => {
  test("client exports include schema and dist entry", () => {
    const e = stagedClientExports()["."] as Record<string, string>;
    expect(e.types).toBe("./dist/index.d.ts");
    expect(e.import).toBe("./dist/index.js");
    expect(stagedClientExports()["./vellum-config.schema.json"]).toBe(
      "./vellum-config.schema.json",
    );
  });

  test("client does not depend on workspace contracts package", () => {
    const deps = stagedDependencies("vellum-client", "1.2.3");
    expect(deps["@khoralabs/vellum-contracts"]).toBeUndefined();
    expect(deps["@khoralabs/did-key-identity"]).toBe("^0.1.0");
    expect(deps["better-sqlite3"]).toBe("^11.10.0");
    expect(deps.zod).toBe("^4");
  });
});
