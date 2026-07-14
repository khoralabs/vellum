import { describe, expect, test } from "bun:test";
import { renderVellumFormula } from "./bump-homebrew-vellum-formula";
import {
  releaseTagForVersion,
  tarballDownloadUrl,
  tarballFilename,
} from "./package-vellum-release-tarballs";

describe("release tarball helpers", () => {
  test("release tag and download url", () => {
    expect(releaseTagForVersion("1.2.3")).toBe("vellum-cli-v1.2.3");
    expect(tarballFilename("darwin-arm64")).toBe("vellum-darwin-arm64.tar.gz");
    expect(tarballDownloadUrl("1.2.3", "darwin-arm64")).toBe(
      "https://github.com/khoralabs/vellum/releases/download/vellum-cli-v1.2.3/vellum-darwin-arm64.tar.gz",
    );
  });
});

describe("renderVellumFormula", () => {
  test("embeds version, url, and sha256 for apple silicon", () => {
    const body = renderVellumFormula({
      version: "0.2.0",
      darwinArm64Sha256: "abc123",
    });
    expect(body).toContain('version "0.2.0"');
    expect(body).toContain("vellum-cli-v0.2.0/vellum-darwin-arm64.tar.gz");
    expect(body).toContain('sha256 "abc123"');
    expect(body).toContain('system bin/"vellum", "setup"');
    expect(body).toContain("on_arm");
    expect(body).toContain('ENV["VELLUM_CLI_ASSETS_DIR"]');
  });
});
