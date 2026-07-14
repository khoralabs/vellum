import path from "node:path";
import { fileURLToPath } from "node:url";
import { runVellumPostinstall } from "./postinstall";

/**
 * Entry script for the npm postinstall hook on `@khoralabs/vellum-cli`.
 *
 * Bundled by [scripts/stage-vellum-release.ts](../../../../scripts/stage-vellum-release.ts)
 * into `release/cli/postinstall.js`. Run `vellum setup` if lifecycle scripts are blocked.
 */
function main(): void {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    console.error("vellum-cli postinstall: HOME / USERPROFILE not set; skipping");
    return;
  }
  const pkgDistDir = path.dirname(fileURLToPath(import.meta.url));
  try {
    const result = runVellumPostinstall({ pkgDistDir, home });
    const summary =
      result.copied.length > 0 ? `wrote ${result.copied.join(", ")}` : "no new config files";
    console.log(`vellum-cli: ${summary} in ${result.destDir}`);
  } catch (err) {
    console.error(
      `vellum-cli postinstall failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

main();
