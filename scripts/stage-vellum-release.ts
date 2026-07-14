#!/usr/bin/env bun
/**
 * Stage the 8 npm packages that ship as one vellum release.
 *
 * Inputs (in `workspaceRoot`):
 *   apps/cli/dist/<bun-target>/vellum
 *   apps/daemon/dist/<bun-target>/vellum-daemon
 *   apps/cli/assets/configs/*.json (base/cli/daemon templates + config.example.json)
 *   packages/client/vellum-config.schema.json (built via build:schema)
 *
 * Output tree: `<releaseDir>/{cli,daemon,cli-<slug>,daemon-<slug>}/...`
 * Publish order: all 6 platform pkgs first → daemon meta → cli meta.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export const SUPPORTED_TARGETS = [
  { slug: "darwin-arm64", bunTarget: "bun-darwin-arm64", os: "darwin", cpu: "arm64" },
  { slug: "linux-x64", bunTarget: "bun-linux-x64", os: "linux", cpu: "x64" },
  { slug: "linux-arm64", bunTarget: "bun-linux-arm64", os: "linux", cpu: "arm64" },
] as const;

export type PlatformTarget = (typeof SUPPORTED_TARGETS)[number];

export const SUPPORTED_SLUGS: ReadonlySet<string> = new Set(SUPPORTED_TARGETS.map((t) => t.slug));

/** Inline node-shim launcher for the cli meta-package's `bin`. */
export function cliLauncherSource(): string {
  const slugList = JSON.stringify(Array.from(SUPPORTED_SLUGS).sort());
  return `#!/usr/bin/env node
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const supported = new Set(${slugList});
const slug = \`\${process.platform}-\${process.arch}\`;
if (!supported.has(slug)) {
  console.error(\`vellum: no prebuilt binary for \${slug}; supported: \${[...supported].join(", ")}\`);
  process.exit(1);
}
const cliBin = require.resolve(\`@khoralabs/vellum-cli-\${slug}/vellum\`);
const daemonBin = require.resolve(\`@khoralabs/vellum-daemon-\${slug}/vellum-daemon\`);
const assetsDir = path.resolve(__dirname, "..");
let metaVersion = "";
try { metaVersion = String(require(path.resolve(assetsDir, "package.json")).version || ""); } catch (_) {}
const env = {
  ...process.env,
  VELLUM_DAEMON_BIN: daemonBin,
  VELLUM_CLI_ASSETS_DIR: assetsDir,
  VELLUM_CLI_VERSION: metaVersion,
};
const r = spawnSync(cliBin, process.argv.slice(2), { stdio: "inherit", env });
process.exit(r.status ?? 1);
`;
}

/** Inline node-shim launcher for the daemon meta-package's `bin`. */
export function daemonLauncherSource(): string {
  const slugList = JSON.stringify(Array.from(SUPPORTED_SLUGS).sort());
  return `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const supported = new Set(${slugList});
const slug = \`\${process.platform}-\${process.arch}\`;
if (!supported.has(slug)) {
  console.error(\`vellum-daemon: no prebuilt binary for \${slug}; supported: \${[...supported].join(", ")}\`);
  process.exit(1);
}
const bin = require.resolve(\`@khoralabs/vellum-daemon-\${slug}/vellum-daemon\`);
const r = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
process.exit(r.status ?? 1);
`;
}

export type MetaPkgJsonInput = {
  version: string;
  repoUrl?: string;
};

const REPO_URL_DEFAULT = "git+https://github.com/khoralabs/vellum.git";

export function cliMetaPkgJson({
  version,
  repoUrl = REPO_URL_DEFAULT,
}: MetaPkgJsonInput): Record<string, unknown> {
  const optionalDependencies: Record<string, string> = {};
  for (const t of SUPPORTED_TARGETS)
    optionalDependencies[`@khoralabs/vellum-cli-${t.slug}`] = version;
  return {
    name: "@khoralabs/vellum-cli",
    version,
    description: "CLI for Vellum NBC channels. Native binaries; no runtime required.",
    license: "MIT",
    author: "Khora Labs",
    homepage: "https://github.com/khoralabs/vellum/tree/main/apps/cli",
    repository: { type: "git", url: repoUrl, directory: "apps/cli" },
    keywords: ["vellum", "obp", "cli", "khoralabs"],
    type: "module",
    bin: { vellum: "./bin/vellum.cjs" },
    files: [
      "bin/**",
      "configs/**",
      "postinstall.js",
      "vellum-config.schema.json",
      "README.md",
      "LICENSE",
    ],
    scripts: { postinstall: "node ./postinstall.js" },
    dependencies: { "@khoralabs/vellum-daemon": version },
    optionalDependencies,
  };
}

export function daemonMetaPkgJson({
  version,
  repoUrl = REPO_URL_DEFAULT,
}: MetaPkgJsonInput): Record<string, unknown> {
  const optionalDependencies: Record<string, string> = {};
  for (const t of SUPPORTED_TARGETS)
    optionalDependencies[`@khoralabs/vellum-daemon-${t.slug}`] = version;
  return {
    name: "@khoralabs/vellum-daemon",
    version,
    description:
      "Vellum NBC channel daemon: WebSocket multiplex, SQLite graph, HTTP control. Native binaries; no runtime required.",
    license: "MIT",
    author: "Khora Labs",
    homepage: "https://github.com/khoralabs/vellum/tree/main/apps/daemon",
    repository: { type: "git", url: repoUrl, directory: "apps/daemon" },
    keywords: ["vellum", "obp", "daemon", "khoralabs"],
    type: "module",
    bin: { "vellum-daemon": "./bin/vellum-daemon.cjs" },
    files: ["bin/**", "README.md", "LICENSE"],
    optionalDependencies,
  };
}

export type PlatformPkgJsonInput = {
  kind: "cli" | "daemon";
  target: PlatformTarget;
  version: string;
  repoUrl?: string;
};

export function platformPkgJson({
  kind,
  target,
  version,
  repoUrl = REPO_URL_DEFAULT,
}: PlatformPkgJsonInput): Record<string, unknown> {
  const binName = kind === "cli" ? "vellum" : "vellum-daemon";
  return {
    name: `@khoralabs/vellum-${kind}-${target.slug}`,
    version,
    description: `Vellum ${kind} native binary for ${target.os}-${target.cpu}.`,
    license: "MIT",
    author: "Khora Labs",
    repository: { type: "git", url: repoUrl, directory: `apps/${kind}` },
    os: [target.os],
    cpu: [target.cpu],
    files: [binName],
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await Bun.write(file, `${JSON.stringify(value, null, 2)}\n`);
}

export type StageOptions = {
  workspaceRoot: string;
  releaseDir: string;
  version: string;
  /**
   * When false, the staging script does not attempt to copy cross-compiled
   * binaries (used by unit tests that don't run `bun build --compile`).
   */
  copyBinaries?: boolean;
};

export type StageResult = {
  releaseDir: string;
  packages: string[];
};

/** Stage all 8 release packages into `releaseDir`. Idempotent — wipes `releaseDir` first. */
export async function stageVellumRelease(opts: StageOptions): Promise<StageResult> {
  const { workspaceRoot, releaseDir, version } = opts;
  const copyBinaries = opts.copyBinaries ?? true;

  if (existsSync(releaseDir)) rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(releaseDir, { recursive: true });

  const packages: string[] = [];

  for (const target of SUPPORTED_TARGETS) {
    for (const kind of ["cli", "daemon"] as const) {
      const pkgDir = path.join(releaseDir, `${kind}-${target.slug}`);
      mkdirSync(pkgDir, { recursive: true });
      const binName = kind === "cli" ? "vellum" : "vellum-daemon";
      if (copyBinaries) {
        const src = path.join(workspaceRoot, "apps", kind, "dist", target.bunTarget, binName);
        if (!existsSync(src)) {
          throw new Error(`missing compiled binary: ${src}`);
        }
        await Bun.write(path.join(pkgDir, binName), Bun.file(src));
        await Bun.$`chmod +x ${path.join(pkgDir, binName)}`.quiet();
      }
      await writeJson(
        path.join(pkgDir, "package.json"),
        platformPkgJson({ kind, target, version }),
      );
      packages.push(pkgDir);
    }
  }

  const daemonMetaDir = path.join(releaseDir, "daemon");
  mkdirSync(path.join(daemonMetaDir, "bin"), { recursive: true });
  await Bun.write(path.join(daemonMetaDir, "bin", "vellum-daemon.cjs"), daemonLauncherSource());
  await Bun.$`chmod +x ${path.join(daemonMetaDir, "bin", "vellum-daemon.cjs")}`.quiet();
  await writeJson(path.join(daemonMetaDir, "package.json"), daemonMetaPkgJson({ version }));
  const daemonReadme = path.join(workspaceRoot, "apps/daemon/README.md");
  if (existsSync(daemonReadme)) {
    await Bun.write(path.join(daemonMetaDir, "README.md"), Bun.file(daemonReadme));
  }
  packages.push(daemonMetaDir);

  const cliMetaDir = path.join(releaseDir, "cli");
  mkdirSync(path.join(cliMetaDir, "bin"), { recursive: true });
  await Bun.write(path.join(cliMetaDir, "bin", "vellum.cjs"), cliLauncherSource());
  await Bun.$`chmod +x ${path.join(cliMetaDir, "bin", "vellum.cjs")}`.quiet();

  // bundle postinstall.entry.ts -> postinstall.js (target=node)
  const postinstallSrc = path.join(workspaceRoot, "apps/cli/scripts/postinstall.entry.ts");
  const postinstallOut = path.join(cliMetaDir, "postinstall.js");
  const piResult = await Bun.build({
    entrypoints: [postinstallSrc],
    target: "node",
    format: "esm",
    packages: "bundle",
    outdir: cliMetaDir,
    naming: { entry: "postinstall.js" },
    minify: false,
  });
  if (!piResult.success) {
    for (const log of piResult.logs) console.error(log);
    throw new Error("failed to bundle postinstall.entry.ts");
  }
  if (!existsSync(postinstallOut)) {
    throw new Error(`postinstall bundle missing at ${postinstallOut}`);
  }

  mkdirSync(path.join(cliMetaDir, "configs"), { recursive: true });
  const configsSrc = path.join(workspaceRoot, "apps/cli/assets/configs");
  for (const name of [
    "base.config.json",
    "cli.config.json",
    "daemon.config.json",
    "config.example.json",
  ]) {
    let body = await Bun.file(path.join(configsSrc, name)).text();
    // Published layout: schema sits next to `configs/` at the meta-package root.
    if (name === "config.example.json") {
      body = body.replace(/"\$schema"\s*:\s*"[^"]*"/, '"$schema": "../vellum-config.schema.json"');
    }
    await Bun.write(path.join(cliMetaDir, "configs", name), body);
  }
  const schemaSrc = path.join(workspaceRoot, "packages/client/vellum-config.schema.json");
  if (!existsSync(schemaSrc)) {
    throw new Error(`missing vellum-config.schema.json at ${schemaSrc} — run build:schema first`);
  }
  await Bun.write(path.join(cliMetaDir, "vellum-config.schema.json"), Bun.file(schemaSrc));

  await writeJson(path.join(cliMetaDir, "package.json"), cliMetaPkgJson({ version }));
  const cliReadme = path.join(workspaceRoot, "apps/cli/README.md");
  if (existsSync(cliReadme)) {
    await Bun.write(path.join(cliMetaDir, "README.md"), Bun.file(cliReadme));
  }
  packages.push(cliMetaDir);

  return { releaseDir, packages };
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) {
    console.error("usage: stage-vellum-release.ts <semver>");
    process.exit(1);
  }
  const workspaceRoot = path.resolve(import.meta.dir, "..");
  const releaseDir = path.join(workspaceRoot, "apps/release");
  const result = await stageVellumRelease({ workspaceRoot, releaseDir, version });
  console.log(
    `staged ${result.packages.length} packages under ${path.relative(process.cwd(), result.releaseDir)}`,
  );
}
