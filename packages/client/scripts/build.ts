#!/usr/bin/env bun
/**
 * Publish build for @khoralabs/vellum-client:
 * - JS: bun bundler (public packages external) for root + subpath entries
 * - .d.ts: tsc emit into dist (paths mirror src)
 *
 * @see https://bun.com/docs/bundler
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const distDir = path.join(root, "dist");
const dtsOutDir = path.join(root, ".dts-build");

const publicExternals = [
  "@khoralabs/did-key-identity",
  "@khoralabs/obp-core",
  "@khoralabs/obp-nbc",
  "@khoralabs/obp-wire",
  "@khoralabs/relay",
  "zod",
  "bun:sqlite",
] as const;

type Entry = {
  src: string;
  /** Path under dist/, mirrors src (sans .ts) */
  outRel: string;
  target: "node" | "bun";
};

const entries: Entry[] = [
  { src: "src/index.ts", outRel: "index.js", target: "bun" },
  { src: "src/contracts/index.ts", outRel: "contracts/index.js", target: "node" },
  { src: "src/transport/index.ts", outRel: "transport/index.js", target: "node" },
  { src: "src/session/index.ts", outRel: "session/index.js", target: "bun" },
  {
    src: "src/persistence/core/index.ts",
    outRel: "persistence/core/index.js",
    target: "node",
  },
  {
    src: "src/persistence/sqlite/index.ts",
    outRel: "persistence/sqlite/index.js",
    target: "bun",
  },
  { src: "src/pool/index.ts", outRel: "pool/index.js", target: "bun" },
];

rmSync(distDir, { recursive: true, force: true });
rmSync(dtsOutDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const externalFlags = publicExternals.flatMap((e) => ["--external", e]);

for (const entry of entries) {
  const outfile = path.join(distDir, entry.outRel);
  mkdirSync(path.dirname(outfile), { recursive: true });
  const js =
    await Bun.$`bun build ${path.join(root, entry.src)} --outfile=${outfile} --target=${entry.target} --format=esm ${externalFlags}`.nothrow();
  if (js.exitCode !== 0) {
    console.error(js.stderr.toString() || js.stdout.toString());
    throw new Error(`bun build failed for ${entry.src}`);
  }
  // Types-only entry points (e.g. persistence/core) emit an empty bundle.
  if (!Bun.file(outfile).size) {
    await Bun.write(outfile, "export {};\n");
  }
}

const clientDts = await Bun.$`tsc -p ${path.join(root, "tsconfig.build.json")}`.nothrow();
if (clientDts.exitCode !== 0) {
  console.error(clientDts.stderr.toString() || clientDts.stdout.toString());
  throw new Error("client declaration emit failed");
}

// Merge declaration tree into dist so subpath relative imports resolve.
cpSync(dtsOutDir, distDir, { recursive: true });
rmSync(dtsOutDir, { recursive: true, force: true });

console.log(`built ${entries.map((e) => e.outRel).join(", ")} + .d.ts tree`);
