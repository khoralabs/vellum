import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runVellumConfigSetup, runVellumPostinstall } from "./postinstall";

let workspace: string;
let pkgDistDir: string;
let home: string;

const BASE_BODY = JSON.stringify(
  {
    $schema: "./vellum-config.schema.json",
    relayBaseUrl: "http://localhost:8790",
    dataDir: "~/.vellum/data",
  },
  null,
  2,
);
const SCHEMA_BODY = JSON.stringify({ $id: "vellum-config", type: "object" });

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "vellum-postinstall-"));
  pkgDistDir = path.join(workspace, "dist");
  home = path.join(workspace, "home");
  mkdirSync(path.join(pkgDistDir, "configs"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(path.join(pkgDistDir, "configs", "base.config.json"), `${BASE_BODY}\n`);
  writeFileSync(path.join(pkgDistDir, "configs", "cli.config.json"), `{}\n`);
  writeFileSync(path.join(pkgDistDir, "configs", "daemon.config.json"), `{}\n`);
  writeFileSync(path.join(pkgDistDir, "vellum-config.schema.json"), SCHEMA_BODY);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("runVellumPostinstall", () => {
  test("copies all configs and schema on a clean home", () => {
    const result = runVellumPostinstall({ pkgDistDir, home });
    const dest = path.join(home, ".vellum");
    expect(result.destDir).toBe(dest);
    expect(result.copied.sort()).toEqual([
      "base.config.json",
      "cli.config.json",
      "daemon.config.json",
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.schemaCopied).toBe(true);
    expect(existsSync(path.join(dest, "base.config.json"))).toBe(true);
    expect(existsSync(path.join(dest, "vellum-config.schema.json"))).toBe(true);
  });

  test("expands path placeholders in copied base.config.json", () => {
    runVellumPostinstall({ pkgDistDir, home });
    const dest = path.join(home, ".vellum");
    const written = readFileSync(path.join(dest, "base.config.json"), "utf8");
    expect(written.includes("~/.vellum")).toBe(false);
    expect(written.includes(path.join(home, ".vellum", "data"))).toBe(true);
  });

  test("idempotent on repeat invocations", () => {
    const first = runVellumPostinstall({ pkgDistDir, home });
    expect(first.copied.length).toBe(3);
    expect(first.schemaCopied).toBe(true);
    const second = runVellumPostinstall({ pkgDistDir, home });
    expect(second.copied).toEqual([]);
    expect(second.schemaCopied).toBe(false);
    expect(second.skipped.sort()).toEqual([
      "base.config.json",
      "cli.config.json",
      "daemon.config.json",
    ]);
  });
});

describe("runVellumConfigSetup", () => {
  test("force overwrites existing cli.config.json", () => {
    const dest = path.join(home, ".vellum");
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, "cli.config.json"), '{"old":true}');
    writeFileSync(path.join(dest, "vellum-config.schema.json"), '{"old":true}');
    const result = runVellumConfigSetup({
      configsDir: path.join(pkgDistDir, "configs"),
      schemaPath: path.join(pkgDistDir, "vellum-config.schema.json"),
      home,
      force: true,
    });
    expect(result.overwritten).toContain("cli.config.json");
    expect(result.schema).toBe("overwritten");
    expect(readFileSync(path.join(dest, "cli.config.json"), "utf8")).not.toBe('{"old":true}');
  });
});
