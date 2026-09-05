import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("daemon spawn bundler safety", () => {
  test("built client index does not embed apps/daemon", async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "vellum-client-build-"));
    const outfile = path.join(outDir, "index.js");
    const entry = path.join(import.meta.dir, "index.ts");
    try {
      const result =
        await Bun.$`bun build ${entry} --outfile=${outfile} --target=bun --format=esm --external=@khoralabs/did-key-identity --external=@khoralabs/obp-core --external=@khoralabs/obp-nbc --external=@khoralabs/obp-wire --external=@khoralabs/relay --external=zod --external=bun:sqlite`.nothrow();
      expect(result.exitCode).toBe(0);
      const text = readFileSync(outfile, "utf8");
      expect(text.includes("apps/daemon")).toBe(false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
