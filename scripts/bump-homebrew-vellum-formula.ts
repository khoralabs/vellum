#!/usr/bin/env bun
/**
 * Render and sync the Homebrew formula for vellum.
 *
 * Updates `homebrew-tap/Formula/vellum.rb` in this repo, then optionally pushes to
 * `khoralabs/homebrew-tap` when HOMEBREW_TAP_TOKEN is set.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type ReleaseTarballManifest,
  releaseTagForVersion,
  tarballDownloadUrl,
  VELLUM_RELEASE_REPO,
} from "./package-vellum-release-tarballs";

export const HOMEBREW_TAP_REPO = "khoralabs/homebrew-tap";

export function renderVellumFormula(opts: {
  version: string;
  darwinArm64Sha256: string;
  repo?: string;
}): string {
  const repo = opts.repo ?? VELLUM_RELEASE_REPO;
  const url = tarballDownloadUrl(opts.version, "darwin-arm64", repo);
  return `class Vellum < Formula
  desc "CLI for Vellum NBC channels"
  homepage "https://github.com/${repo}"
  version "${opts.version}"
  license "MIT"

  on_macos do
    on_arm do
      url "${url}"
      sha256 "${opts.darwinArm64Sha256}"
    end
  end

  def install
    bin.install "vellum"
    bin.install "vellum-daemon"
    pkgshare.install "configs"
    pkgshare.install "vellum-config.schema.json"
  end

  def post_install
    ENV["VELLUM_CLI_ASSETS_DIR"] = pkgshare.to_s
    system bin/"vellum", "setup"
  end

  test do
    assert_match "vellum", shell_output("#{bin}/vellum", 2)
  end
end
`;
}

export function darwinArm64Sha256FromManifest(manifest: ReleaseTarballManifest): string {
  const entry = manifest.tarballs.find((t) => t.slug === "darwin-arm64");
  if (entry === undefined) {
    throw new Error("manifest missing darwin-arm64 tarball");
  }
  return entry.sha256;
}

export function writeVellumFormula(opts: {
  workspaceRoot: string;
  version: string;
  darwinArm64Sha256: string;
}): string {
  const formulaDir = path.join(opts.workspaceRoot, "homebrew-tap/Formula");
  mkdirSync(formulaDir, { recursive: true });
  const formulaPath = path.join(formulaDir, "vellum.rb");
  const body = renderVellumFormula({
    version: opts.version,
    darwinArm64Sha256: opts.darwinArm64Sha256,
  });
  writeFileSync(formulaPath, body);
  return formulaPath;
}

async function pushFormulaToTapRepo(formulaPath: string, version: string): Promise<void> {
  const token = process.env.HOMEBREW_TAP_TOKEN?.trim();
  if (token === undefined || token.length === 0) {
    console.log("HOMEBREW_TAP_TOKEN not set; formula updated locally only");
    return;
  }

  const tmp = mkdtempSync(path.join(tmpdir(), "homebrew-tap-"));
  try {
    const cloneUrl = `https://x-access-token:${token}@github.com/${HOMEBREW_TAP_REPO}.git`;
    const result = await Bun.$`git clone ${cloneUrl} ${tmp}`.nothrow().quiet();
    if (result.exitCode !== 0) {
      throw new Error(
        `failed to clone ${HOMEBREW_TAP_REPO}: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`,
      );
    }

    mkdirSync(path.join(tmp, "Formula"), { recursive: true });
    writeFileSync(path.join(tmp, "Formula/vellum.rb"), readFileSync(formulaPath, "utf8"));
    await Bun.$`git -C ${tmp} config user.name github-actions[bot]`.quiet();
    await Bun.$`git -C ${tmp} config user.email 41898282+github-actions[bot]@users.noreply.github.com`.quiet();
    await Bun.$`git -C ${tmp} add Formula/vellum.rb`.quiet();
    const commit = await Bun.$`git -C ${tmp} commit -m vellum-cli@${version}`.nothrow().quiet();
    if (commit.exitCode !== 0) {
      const msg = commit.stderr.toString();
      if (msg.includes("nothing to commit")) {
        console.log("homebrew-tap formula already at requested version");
        return;
      }
      throw new Error(`homebrew-tap commit failed: ${msg.trim()}`);
    }
    const push = await Bun.$`git -C ${tmp} push origin HEAD:main`.nothrow().quiet();
    if (push.exitCode !== 0) {
      throw new Error(`homebrew-tap push failed: ${push.stderr.toString().trim()}`);
    }
    console.log(`pushed ${HOMEBREW_TAP_REPO} Formula/vellum.rb for ${version}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
    console.error("usage: bump-homebrew-vellum-formula.ts <semver>");
    process.exit(1);
  }

  const workspaceRoot = path.resolve(import.meta.dir, "..");
  const manifestPath = path.join(workspaceRoot, "apps/release/tarballs/manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`missing ${manifestPath}; run package-vellum-release-tarballs.ts first`);
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReleaseTarballManifest;
  const darwinArm64Sha256 = darwinArm64Sha256FromManifest(manifest);
  const formulaPath = writeVellumFormula({ workspaceRoot, version, darwinArm64Sha256 });
  console.log(
    `wrote ${path.relative(workspaceRoot, formulaPath)} (${releaseTagForVersion(version)})`,
  );
  await pushFormulaToTapRepo(formulaPath, version);
}
