/**
 * Publish helpers for @khoralabs/vellum-client (memories/OBP-style in-place publish).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ExportTarget = {
  types?: string;
  import?: string;
  default?: string;
  [key: string]: unknown;
};

export function srcPathToDistPaths(srcPath: string): {
  types: string;
  import: string;
  default: string;
} {
  if (!srcPath.startsWith("./src/")) {
    throw new Error(`expected ./src/… export path, got ${srcPath}`);
  }
  const withoutExt = srcPath.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, "");
  return {
    types: `${withoutExt}.d.ts`,
    import: `${withoutExt}.js`,
    default: `${withoutExt}.js`,
  };
}

export function toPublishedExports(
  exportsMap: Record<string, ExportTarget | string>,
): Record<string, ExportTarget | string> {
  const out: Record<string, ExportTarget | string> = {};
  for (const [key, value] of Object.entries(exportsMap)) {
    if (typeof value === "string") {
      out[key] = value.startsWith("./src/") ? srcPathToDistPaths(value) : value;
      continue;
    }
    const importPath =
      (typeof value.import === "string" && value.import) ||
      (typeof value.default === "string" && value.default) ||
      (typeof value.types === "string" && value.types);
    if (!importPath || typeof importPath !== "string" || !importPath.startsWith("./src/")) {
      out[key] = value;
      continue;
    }
    out[key] = srcPathToDistPaths(importPath);
  }
  return out;
}

/** Rewrite package.json for npm; returns restore fn. Preserves schema/LICENSE in files. */
export function applyPublishedPackageJson(pkgDir: string): () => void {
  const pkgPath = path.join(pkgDir, "package.json");
  const original = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(original) as {
    exports?: Record<string, ExportTarget | string>;
    files?: string[];
    main?: string;
    types?: string;
    module?: string;
  };

  if (pkg.exports) {
    pkg.exports = toPublishedExports(pkg.exports);
    const root = pkg.exports["."];
    if (root && typeof root === "object") {
      if (typeof root.import === "string") pkg.main = root.import;
      if (typeof root.types === "string") pkg.types = root.types;
      pkg.module = typeof root.import === "string" ? root.import : pkg.module;
    }
  }
  // Keep existing files list (dist, schema, README, LICENSE) — do not shrink.

  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return () => writeFileSync(pkgPath, original);
}
