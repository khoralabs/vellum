import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PACKAGE_NAME,
  publishSkills,
  redactSecret,
  SKILL_DEST_NAME,
  SKILL_SOURCE_REL,
  type SkillSource,
  SOURCE_REPO,
  syncSkillDirectory,
} from "./publish-skills.ts";

describe("redactSecret", () => {
  test("replaces every occurrence of the secret", () => {
    expect(redactSecret("clone failed: ghp_abc in url ghp_abc", "ghp_abc")).toBe(
      "clone failed: *** in url ***",
    );
  });

  test("redacts base64-encoded auth header material", () => {
    const token = "ghp_secret_token";
    const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    expect(redactSecret(`failed: ${header}`, token)).toBe("failed: AUTHORIZATION: basic ***");
  });
});

describe("syncSkillDirectory", () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  test("replaces dest wholesale and writes skill-source.json", () => {
    root = mkdtempSync(path.join(os.tmpdir(), "vellum-publish-skills-sync-"));
    const sourceDir = path.join(root, "source");
    const destDir = path.join(root, "dest");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, "SKILL.md"), "# vellum\n");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(path.join(destDir, "stale.md"), "gone\n");

    const skillSource: SkillSource = {
      sourceRepo: SOURCE_REPO,
      packageName: PACKAGE_NAME,
      version: "1.2.3",
      sourceCommit: "abc123",
    };
    const result = syncSkillDirectory({ sourceDir, destDir, skillSource });

    expect(existsSync(path.join(destDir, "stale.md"))).toBe(false);
    expect(readFileSync(path.join(destDir, "SKILL.md"), "utf8")).toBe("# vellum\n");
    expect(JSON.parse(readFileSync(result.skillSourcePath, "utf8"))).toEqual(skillSource);
  });
});

describe("publishSkills", () => {
  let skillsRepo: string | undefined;
  let workspace: string | undefined;

  afterEach(() => {
    for (const dir of [skillsRepo, workspace]) {
      if (dir !== undefined && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    skillsRepo = undefined;
    workspace = undefined;
  });

  test("no-ops cleanly when skill source directory is missing", async () => {
    workspace = mkdtempSync(path.join(os.tmpdir(), "vellum-no-skills-"));
    const result = await publishSkills({
      workspaceRoot: workspace,
      version: "0.0.0-test",
      sourceCommit: "deadbeef",
      token: "should-not-matter",
    });
    expect(result).toEqual({ status: "skipped", reason: "source_missing" });
  });

  test("skips when token is unset and source exists", async () => {
    workspace = mkdtempSync(path.join(os.tmpdir(), "vellum-skills-src-"));
    const sourceDir = path.join(workspace, SKILL_SOURCE_REL);
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, "SKILL.md"), "# vellum\n");

    const result = await publishSkills({
      workspaceRoot: workspace,
      version: "0.0.0-test",
      sourceCommit: "deadbeef",
      token: "",
    });
    expect(result).toEqual({ status: "skipped", reason: "token_unset" });
  });

  test("syncs into a local skills checkout when source exists", async () => {
    workspace = mkdtempSync(path.join(os.tmpdir(), "vellum-skills-ws-"));
    const sourceDir = path.join(workspace, SKILL_SOURCE_REL);
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(path.join(sourceDir, "SKILL.md"), "# vellum\n");

    skillsRepo = mkdtempSync(path.join(os.tmpdir(), "vellum-skills-checkout-"));
    await Bun.$`git -C ${skillsRepo} init`.quiet();
    writeFileSync(path.join(skillsRepo, "README.md"), "# skills\n");
    await Bun.$`git -C ${skillsRepo} add README.md`.quiet();
    await Bun.$`git -C ${skillsRepo} -c user.name=test -c user.email=test@example.com commit -m init`.quiet();

    const result = await publishSkills({
      workspaceRoot: workspace,
      version: "9.9.9",
      sourceCommit: "abc",
      skillsRepoDir: skillsRepo,
    });
    expect(result.status).toBe("published");
    expect(existsSync(path.join(skillsRepo, SKILL_DEST_NAME, "SKILL.md"))).toBe(true);
    const provenance = JSON.parse(
      readFileSync(path.join(skillsRepo, SKILL_DEST_NAME, "skill-source.json"), "utf8"),
    ) as SkillSource;
    expect(provenance.packageName).toBe(PACKAGE_NAME);
    expect(provenance.version).toBe("9.9.9");
  });
});
