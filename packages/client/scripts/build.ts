#!/usr/bin/env bun
/**
 * Publish build for @khoralabs/vellum-client:
 * - JS: bun bundler (workspace internals inlined; public packages external)
 * - .d.ts: tsc emit + API Extractor rollup (bun does not generate declarations)
 *
 * @see https://bun.com/docs/bundler
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const repoRoot = path.resolve(root, "../..");
const distDir = path.join(root, "dist");
const dtsOutDir = path.join(root, ".dts-build");
const entry = path.join(root, "src/index.ts");

const publicExternals = ["@khoralabs/did-key-identity", "zod", "better-sqlite3"] as const;

/** Workspace packages whose types must be .d.ts for API Extractor, then rolled into client. */
const bundledTypePackages = [
  { dir: path.join(repoRoot, "packages/contracts"), name: "@khoralabs/vellum-contracts" },
  { dir: path.join(repoRoot, "packages/transport"), name: "@khoralabs/vellum-transport" },
  { dir: path.join(repoRoot, "vendor/relay/packages/relay"), name: "@khoralabs/relay" },
  { dir: path.join(repoRoot, "vendor/obp/packages/core"), name: "@khoralabs/obp-core" },
  { dir: path.join(repoRoot, "vendor/obp/packages/nbc"), name: "@khoralabs/obp-nbc" },
] as const;

type PkgJson = {
  types?: string;
  exports?: Record<string, unknown>;
  [key: string]: unknown;
};

function pointPackageTypesAtDist(pkgDir: string): () => void {
  const pkgPath = path.join(pkgDir, "package.json");
  const original = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(original) as PkgJson;
  const dts = "./dist/index.d.ts";
  pkg.types = dts;
  if (pkg.exports && typeof pkg.exports === "object" && "." in pkg.exports) {
    const exp = pkg.exports["."] as Record<string, unknown>;
    pkg.exports["."] = { ...exp, types: dts };
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return () => writeFileSync(pkgPath, original);
}

async function emitPackageDts(pkgDir: string): Promise<void> {
  const tsconfigPath = path.join(pkgDir, "tsconfig.build.dts.json");
  writeFileSync(
    tsconfigPath,
    `${JSON.stringify(
      {
        include: ["src/**/*.ts"],
        exclude: ["src/**/*.test.ts"],
        compilerOptions: {
          target: "ESNext",
          lib: ["ESNext", "DOM"],
          module: "ESNext",
          moduleResolution: "bundler",
          declaration: true,
          emitDeclarationOnly: true,
          outDir: "dist",
          rootDir: "src",
          strict: true,
          skipLibCheck: true,
          types: ["bun"],
        },
      },
      null,
      2,
    )}\n`,
  );
  const result = await Bun.$`tsc -p ${tsconfigPath}`.cwd(pkgDir).nothrow();
  rmSync(tsconfigPath, { force: true });
  if (result.exitCode !== 0) {
    console.error(result.stderr.toString() || result.stdout.toString());
    throw new Error(`declaration emit failed: ${pkgDir}`);
  }
  if (!existsSync(path.join(pkgDir, "dist/index.d.ts"))) {
    throw new Error(`missing dist/index.d.ts after emit: ${pkgDir}`);
  }
}

rmSync(distDir, { recursive: true, force: true });
rmSync(dtsOutDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const js =
  await Bun.$`bun build ${entry} --outfile=${path.join(distDir, "index.js")} --target=node --format=esm ${publicExternals.flatMap((e) => ["--external", e])}`.nothrow();
if (js.exitCode !== 0) {
  console.error(js.stderr.toString() || js.stdout.toString());
  throw new Error("bun build failed");
}
if (!Bun.file(path.join(distDir, "index.js")).size) {
  throw new Error("dist/index.js empty after bun build");
}

const restores: Array<() => void> = [];
try {
  for (const pkg of bundledTypePackages) {
    await emitPackageDts(pkg.dir);
    restores.push(pointPackageTypesAtDist(pkg.dir));
  }

  const clientDts = await Bun.$`tsc -p ${path.join(root, "tsconfig.build.json")}`.nothrow();
  if (clientDts.exitCode !== 0) {
    console.error(clientDts.stderr.toString() || clientDts.stdout.toString());
    throw new Error("client declaration emit failed");
  }

  const extractor = await Bun.$`bunx api-extractor run --local --verbose`.cwd(root).nothrow();
  if (extractor.exitCode !== 0 || !existsSync(path.join(distDir, "index.d.ts"))) {
    console.error(extractor.stderr.toString() || extractor.stdout.toString());
    throw new Error("api-extractor rollup failed");
  }
} finally {
  for (const restore of restores.reverse()) {
    try {
      restore();
    } catch (e) {
      console.error("failed to restore package.json", e);
    }
  }
}

rmSync(dtsOutDir, { recursive: true, force: true });
for (const pkg of bundledTypePackages) {
  rmSync(path.join(pkg.dir, "dist"), { recursive: true, force: true });
}

console.log(
  `built dist/index.js (${Bun.file(path.join(distDir, "index.js")).size} bytes) + dist/index.d.ts`,
);
