#!/usr/bin/env bun
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const SUPPORTED_TARGETS = ["bun-darwin-arm64", "bun-linux-x64", "bun-linux-arm64"] as const;
type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];

function isSupportedTarget(value: string | undefined): value is SupportedTarget {
  return value !== undefined && (SUPPORTED_TARGETS as readonly string[]).includes(value);
}

const target = process.argv[2];
if (!isSupportedTarget(target)) {
  console.error(`usage: build.ts <${SUPPORTED_TARGETS.join("|")}>`);
  process.exit(1);
}

const PKG_ROOT = path.resolve(import.meta.dir, "..");
const ENTRY = path.join(PKG_ROOT, "src", "index.ts");
const OUT_DIR = path.join(PKG_ROOT, "dist", target);
const OUT_FILE = path.join(OUT_DIR, "vellum-daemon");

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const result = await Bun.$`bun build --compile --target=${target} --outfile=${OUT_FILE} ${ENTRY}`
  .nothrow()
  .quiet();

if (result.exitCode !== 0) {
  process.stderr.write(result.stderr);
  process.stdout.write(result.stdout);
  process.exit(result.exitCode);
}

console.log(`built ${path.relative(process.cwd(), OUT_FILE)} (${target})`);
