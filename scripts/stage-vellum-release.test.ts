import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cliLauncherSource,
  cliMetaPkgJson,
  daemonLauncherSource,
  platformPkgJson,
  SUPPORTED_TARGETS,
  stageVellumRelease,
} from "./stage-vellum-release";

describe("launcher sources", () => {
  test("cli launcher sets VELLUM_* env vars", () => {
    const src = cliLauncherSource();
    expect(src).toContain("VELLUM_DAEMON_BIN");
    expect(src).toContain("VELLUM_CLI_ASSETS_DIR");
    expect(src).toContain("VELLUM_CLI_VERSION");
    expect(src).toContain("@khoralabs/vellum-cli-");
  });

  test("daemon launcher resolves vellum-daemon slug packages", () => {
    const src = daemonLauncherSource();
    expect(src).toContain("@khoralabs/vellum-daemon-");
    expect(src).toContain("vellum-daemon");
  });
});

describe("package.json factories", () => {
  test("cli meta lists configs + schema in files", () => {
    const pkg = cliMetaPkgJson({ version: "1.2.3" }) as Record<string, unknown>;
    const files = pkg.files as string[];
    expect(files).toContain("configs/**");
    expect(files).toContain("vellum-config.schema.json");
  });

  test("platform pkg names vellum binaries", () => {
    const t = SUPPORTED_TARGETS[0];
    const cli = platformPkgJson({ kind: "cli", target: t, version: "1.0.0" }) as Record<
      string,
      unknown
    >;
    expect(cli.files).toEqual(["vellum"]);
    const daemon = platformPkgJson({ kind: "daemon", target: t, version: "1.0.0" }) as Record<
      string,
      unknown
    >;
    expect(daemon.files).toEqual(["vellum-daemon"]);
  });
});

describe("stageVellumRelease", () => {
  let workspace: string;
  let releaseDir: string;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), "vellum-stage-"));
    releaseDir = path.join(workspace, "apps/release");

    mkdirSync(path.join(workspace, "apps/cli/scripts"), { recursive: true });
    mkdirSync(path.join(workspace, "apps/cli/assets/configs"), { recursive: true });
    mkdirSync(path.join(workspace, "packages/client"), { recursive: true });

    writeFileSync(
      path.join(workspace, "apps/cli/scripts/postinstall.ts"),
      `import * as fs from "node:fs";
       export function runVellumPostinstall(_: { pkgDistDir: string; home: string }) {
         return { destDir: "/tmp", copied: [], skipped: [], schemaCopied: fs.existsSync("/") };
       }
      `,
    );
    writeFileSync(
      path.join(workspace, "apps/cli/scripts/postinstall.entry.ts"),
      `import { runVellumPostinstall } from "./postinstall";
       runVellumPostinstall({ pkgDistDir: ".", home: "/tmp" });
      `,
    );

    for (const name of [
      "base.config.json",
      "cli.config.json",
      "daemon.config.json",
      "config.example.json",
    ]) {
      const body =
        name === "config.example.json"
          ? '{ "$schema": "stale/path.json", "name": "config.example.json" }'
          : `{ "name": "${name}" }`;
      writeFileSync(path.join(workspace, "apps/cli/assets/configs", name), body);
    }
    writeFileSync(
      path.join(workspace, "packages/client/vellum-config.schema.json"),
      '{"$id":"vellum"}',
    );
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  test("cli meta includes configs and schema", async () => {
    await stageVellumRelease({
      workspaceRoot: workspace,
      releaseDir,
      version: "9.9.9",
      copyBinaries: false,
    });
    const cliMeta = path.join(releaseDir, "cli");
    expect(existsSync(path.join(cliMeta, "postinstall.js"))).toBe(true);
    expect(existsSync(path.join(cliMeta, "vellum-config.schema.json"))).toBe(true);
    for (const name of [
      "base.config.json",
      "cli.config.json",
      "daemon.config.json",
      "config.example.json",
    ]) {
      expect(existsSync(path.join(cliMeta, "configs", name))).toBe(true);
    }
    const example = await Bun.file(path.join(cliMeta, "configs", "config.example.json")).text();
    expect(example).toContain('"$schema": "../vellum-config.schema.json"');
  });
});
