import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  maybeBootstrapVellumHome,
  printSetupSummary,
  resolveSetupAssets,
  runSetupCommand,
} from "./setup";

describe("resolveSetupAssets", () => {
  test("uses VELLUM_CLI_ASSETS_DIR when set", () => {
    const ws = mkdtempSync(path.join(tmpdir(), "vellum-assets-"));
    try {
      mkdirSync(path.join(ws, "configs"), { recursive: true });
      writeFileSync(path.join(ws, "vellum-config.schema.json"), "{}");
      const out = resolveSetupAssets({ VELLUM_CLI_ASSETS_DIR: ws });
      expect(out.configsDir).toBe(path.join(ws, "configs"));
      expect(out.schemaPath).toBe(path.join(ws, "vellum-config.schema.json"));
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  test("treats empty / whitespace VELLUM_CLI_ASSETS_DIR as unset (monorepo fallback)", () => {
    const out = resolveSetupAssets({ VELLUM_CLI_ASSETS_DIR: "   " });
    expect(out.configsDir.endsWith(path.join("cli", "assets", "configs"))).toBe(true);
    expect(out.schemaPath?.endsWith("vellum-config.schema.json")).toBe(true);
  });

  test("falls back to monorepo paths when env unset", () => {
    const out = resolveSetupAssets({});
    expect(out.configsDir.endsWith(path.join("cli", "assets", "configs"))).toBe(true);
    expect(out.schemaPath?.endsWith("vellum-config.schema.json")).toBe(true);
  });
});

describe("printSetupSummary", () => {
  test("prints destDir line when no files are copied (Phase 2 default)", () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (msg: unknown) => {
      lines.push(String(msg));
    };
    try {
      printSetupSummary({
        destDir: "/home/me/.vellum",
        copied: [],
        overwritten: [],
        skipped: [],
        schema: "missing",
      });
    } finally {
      console.log = log;
    }
    expect(lines.at(-1)).toContain("at /home/me/.vellum");
  });

  test("prints wrote/overwrote/skipped lines when files are present", () => {
    const prevNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    const lines: string[] = [];
    const log = console.log;
    console.log = (msg: unknown) => {
      lines.push(String(msg));
    };
    try {
      printSetupSummary({
        destDir: "/home/me/.vellum",
        copied: ["a.json"],
        overwritten: ["b.json"],
        skipped: ["c.json"],
        schema: "copied",
      });
    } finally {
      console.log = log;
      if (prevNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prevNoColor;
    }
    expect(lines[0]).toContain("wrote a.json");
    expect(lines[1]).toContain("overwrote b.json");
    expect(lines[2]).toContain("skipped c.json");
    expect(lines[3]).toContain("vellum-config.schema.json");
    expect(lines.at(-1)).toContain("at /home/me/.vellum");
  });
});

describe("runSetupCommand", () => {
  let workspace: string;
  let home: string;
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), "vellum-setup-cmd-"));
    home = path.join(workspace, "home");
    mkdirSync(home, { recursive: true });
    origEnv = { ...process.env };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    process.env = origEnv;
  });

  test("creates ~/.vellum on first run", async () => {
    await runSetupCommand({});
    expect(existsSync(path.join(home, ".vellum"))).toBe(true);
  });

  test("idempotent: second run still succeeds", async () => {
    await runSetupCommand({});
    await runSetupCommand({});
    expect(existsSync(path.join(home, ".vellum"))).toBe(true);
  });

  test("--json emits structured result", async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (msg: unknown) => {
      lines.push(String(msg));
    };
    try {
      await runSetupCommand({ json: true });
    } finally {
      console.log = log;
    }
    const parsed = JSON.parse(lines.join("\n")) as { destDir: string };
    expect(parsed.destDir).toBe(path.join(home, ".vellum"));
  });

  test("throws when HOME and USERPROFILE are both unset", async () => {
    process.env.HOME = "";
    process.env.USERPROFILE = "";
    let err: Error | undefined;
    try {
      await runSetupCommand({});
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message ?? "").toContain("HOME");
  });
});

describe("maybeBootstrapVellumHome", () => {
  let workspace: string;
  let home: string;
  let assetsDir: string;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), "vellum-bootstrap-"));
    home = path.join(workspace, "home");
    assetsDir = path.join(workspace, "assets");
    mkdirSync(home, { recursive: true });
    mkdirSync(path.join(assetsDir, "configs"), { recursive: true });
    for (const name of ["base.config.json", "cli.config.json", "daemon.config.json"]) {
      writeFileSync(path.join(assetsDir, "configs", name), "{}\n");
    }
    writeFileSync(path.join(assetsDir, "vellum-config.schema.json"), '{"$id":"x"}');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("creates ~/.vellum on first invocation in a packaged install", () => {
    const errors: string[] = [];
    maybeBootstrapVellumHome({ VELLUM_CLI_ASSETS_DIR: assetsDir, HOME: home }, (line) =>
      errors.push(line),
    );
    expect(existsSync(path.join(home, ".vellum", "cli.config.json"))).toBe(true);
    expect(errors).toEqual([]);
  });

  test("short-circuits when canary cli.config.json already exists (no overwrite)", () => {
    mkdirSync(path.join(home, ".vellum"), { recursive: true });
    writeFileSync(path.join(home, ".vellum", "cli.config.json"), '{"keep":true}');
    maybeBootstrapVellumHome({ VELLUM_CLI_ASSETS_DIR: assetsDir, HOME: home });
    expect(readFileSync(path.join(home, ".vellum", "cli.config.json"), "utf8")).toBe(
      '{"keep":true}',
    );
  });

  test("no-op when VELLUM_CLI_ASSETS_DIR is unset (monorepo dev path)", () => {
    maybeBootstrapVellumHome({ HOME: home });
    expect(existsSync(path.join(home, ".vellum"))).toBe(false);
  });

  test("no-op when HOME is unset", () => {
    maybeBootstrapVellumHome({ VELLUM_CLI_ASSETS_DIR: assetsDir });
    expect(existsSync(path.join(home, ".vellum"))).toBe(false);
  });

  test("never throws; surfaces failures as a one-line stderr message", () => {
    unlinkSync(path.join(assetsDir, "configs", "base.config.json"));
    const errors: string[] = [];
    expect(() =>
      maybeBootstrapVellumHome({ VELLUM_CLI_ASSETS_DIR: assetsDir, HOME: home }, (line) =>
        errors.push(line),
      ),
    ).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0])).toContain("first-run setup failed");
    expect(String(errors[0])).toContain("vellum setup");
  });
});
