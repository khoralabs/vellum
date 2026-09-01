#!/usr/bin/env bun
/**
 * Publish @khoralabs/vellum-client from packages/client (in-place).
 * Usage: bun run scripts/publish-client.ts [--dry-run] [--tag <dist-tag>]
 *
 * Expects version already set and dist built (CI builds first).
 * Auth: NPM_CONFIG_TOKEN / NPM_TOKEN / NODE_AUTH_TOKEN.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { applyPublishedPackageJson } from "./publish-package-json";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tagIdx = args.indexOf("--tag");
const tag = tagIdx >= 0 ? args[tagIdx + 1] : undefined;
if (tagIdx >= 0 && (!tag || tag.startsWith("--"))) {
  console.error("usage: publish-client.ts [--dry-run] [--tag <dist-tag>]");
  process.exit(1);
}

const root = path.resolve(import.meta.dir, "..");
const pkgDir = path.join(root, "packages/client");

const token = process.env.NPM_CONFIG_TOKEN ?? process.env.NPM_TOKEN ?? process.env.NODE_AUTH_TOKEN;
if (!token && !dryRun) {
  console.warn(
    "Warning: NPM_CONFIG_TOKEN (or NPM_TOKEN) is not set; bun publish may fail without auth.",
  );
}

function removePackArtifacts(dir: string): void {
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".tgz")) rmSync(path.join(dir, name), { force: true });
  }
}

let restore: (() => void) | undefined;
let exitCode = 0;
try {
  restore = applyPublishedPackageJson(pkgDir);

  if (dryRun) {
    console.log(`(dry-run) bun publish --access public${tag ? ` --tag ${tag}` : ""}`);
    const pack = spawnSync("bun", ["pm", "pack", "--quiet"], {
      cwd: pkgDir,
      stdio: "inherit",
      env: process.env,
    });
    if (pack.status !== 0) {
      exitCode = pack.status ?? 1;
    } else {
      console.log("packed successfully (dry-run)");
    }
  } else {
    const publishArgs = ["publish", "--access", "public"];
    if (tag) publishArgs.push("--tag", tag);
    const result = spawnSync("bun", publishArgs, {
      cwd: pkgDir,
      stdio: "inherit",
      env: {
        ...process.env,
        ...(token ? { NPM_CONFIG_TOKEN: token } : {}),
      },
    });
    if (result.status !== 0) {
      exitCode = result.status ?? 1;
    }
  }
} finally {
  restore?.();
  removePackArtifacts(pkgDir);
}

if (exitCode !== 0) process.exit(exitCode);

console.log(dryRun ? "publish-client dry-run complete" : "published @khoralabs/vellum-client");
