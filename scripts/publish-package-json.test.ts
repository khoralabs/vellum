import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyPublishedPackageJson,
  srcPathToDistPaths,
  toPublishedExports,
} from "./publish-package-json";

describe("publish-package-json", () => {
  test("srcPathToDistPaths maps src to dist js + d.ts", () => {
    expect(srcPathToDistPaths("./src/pool/host.ts")).toEqual({
      types: "./dist/pool/host.d.ts",
      import: "./dist/pool/host.js",
      default: "./dist/pool/host.js",
    });
  });

  test("toPublishedExports rewrites src entries and leaves schema string", () => {
    const published = toPublishedExports({
      ".": {
        types: "./src/index.ts",
        import: "./src/index.ts",
        default: "./src/index.ts",
      },
      "./pool/host": {
        types: "./src/pool/host.ts",
        import: "./src/pool/host.ts",
        default: "./src/pool/host.ts",
      },
      "./vellum-config.schema.json": "./vellum-config.schema.json",
    });
    expect(published["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js",
    });
    expect(published["./pool/host"]).toEqual({
      types: "./dist/pool/host.d.ts",
      import: "./dist/pool/host.js",
      default: "./dist/pool/host.js",
    });
    expect(published["./vellum-config.schema.json"]).toBe("./vellum-config.schema.json");
  });

  test("applyPublishedPackageJson rewrites then restores", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vellum-publish-"));
    const pkgPath = path.join(dir, "package.json");
    const original = {
      name: "@khoralabs/vellum-client",
      files: ["dist", "vellum-config.schema.json", "README.md", "LICENSE"],
      module: "./src/index.ts",
      types: "./src/index.ts",
      exports: {
        ".": {
          types: "./src/index.ts",
          import: "./src/index.ts",
          default: "./src/index.ts",
        },
        "./vellum-config.schema.json": "./vellum-config.schema.json",
      },
    };
    writeFileSync(pkgPath, `${JSON.stringify(original, null, 2)}\n`);

    const restore = applyPublishedPackageJson(dir);
    const mid = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      main?: string;
      types?: string;
      module?: string;
      files?: string[];
      exports: Record<string, unknown>;
    };
    expect(mid.main).toBe("./dist/index.js");
    expect(mid.types).toBe("./dist/index.d.ts");
    expect(mid.module).toBe("./dist/index.js");
    expect(mid.files).toEqual(original.files);
    expect(mid.exports["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js",
    });
    expect(mid.exports["./vellum-config.schema.json"]).toBe("./vellum-config.schema.json");

    restore();
    expect(JSON.parse(readFileSync(pkgPath, "utf8"))).toEqual(original);
    rmSync(dir, { recursive: true, force: true });
  });
});
