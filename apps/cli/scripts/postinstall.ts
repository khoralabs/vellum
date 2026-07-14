import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Pure library for the canonical-config drop into `~/.vellum/`.
 *
 * Imported by the compiled `vellum` binary (`commands/setup.ts`,
 * `maybeBootstrapVellumHome`) and bundled into the npm postinstall script
 * (`postinstall.entry.ts`). Must remain free of top-level side effects.
 */

const CONFIG_FILES = ["base.config.json", "cli.config.json", "daemon.config.json"] as const;
const SCHEMA_FILE = "vellum-config.schema.json";

export type VellumSetupSchemaStatus = "copied" | "overwritten" | "skipped" | "missing";

export type VellumSetupResult = {
  destDir: string;
  copied: string[];
  overwritten: string[];
  skipped: string[];
  schema: VellumSetupSchemaStatus;
};

export type PostinstallResult = {
  destDir: string;
  copied: string[];
  skipped: string[];
  schemaCopied: boolean;
};

function expandHomePlaceholders(body: string, vellumHome: string): string {
  return body.replaceAll("~/.vellum", vellumHome);
}

export function runVellumConfigSetup(opts: {
  configsDir: string;
  schemaPath: string | undefined;
  home: string;
  force?: boolean;
}): VellumSetupResult {
  const force = opts.force ?? false;
  const dest = path.join(opts.home, ".vellum");
  fs.mkdirSync(dest, { recursive: true });

  const copied: string[] = [];
  const overwritten: string[] = [];
  const skipped: string[] = [];

  for (const name of CONFIG_FILES) {
    const target = path.join(dest, name);
    const exists = fs.existsSync(target);
    if (exists && !force) {
      skipped.push(name);
      continue;
    }
    const src = path.join(opts.configsDir, name);
    let body = fs.readFileSync(src, "utf8");
    body = expandHomePlaceholders(body, dest);
    fs.writeFileSync(target, body);
    if (exists) overwritten.push(name);
    else copied.push(name);
  }

  let schema: VellumSetupSchemaStatus = "missing";
  if (opts.schemaPath !== undefined && fs.existsSync(opts.schemaPath)) {
    const schemaTarget = path.join(dest, SCHEMA_FILE);
    const exists = fs.existsSync(schemaTarget);
    if (exists && !force) {
      schema = "skipped";
    } else {
      fs.copyFileSync(opts.schemaPath, schemaTarget);
      schema = exists ? "overwritten" : "copied";
    }
  }

  return { destDir: dest, copied, overwritten, skipped, schema };
}

export function runVellumPostinstall(opts: {
  pkgDistDir: string;
  home: string;
}): PostinstallResult {
  const setup = runVellumConfigSetup({
    configsDir: path.join(opts.pkgDistDir, "configs"),
    schemaPath: path.join(opts.pkgDistDir, SCHEMA_FILE),
    home: opts.home,
    force: false,
  });
  return {
    destDir: setup.destDir,
    copied: setup.copied,
    skipped: setup.skipped,
    schemaCopied: setup.schema === "copied",
  };
}

export const POSTINSTALL_SCHEMA_FILE = SCHEMA_FILE;
