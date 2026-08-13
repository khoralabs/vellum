import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import {
  loadVellumAppConfig,
  readVellumConfigFileWithExtends,
  vellumAppConfigBuiltinDefaults,
  vellumAppConfigFromEnv,
  zVellumAppConfigBase,
} from "./index";

describe("zVellumAppConfigBase", () => {
  test("accepts empty object", () => {
    const r = zVellumAppConfigBase.safeParse({});
    expect(r.success).toBe(true);
  });

  test("accepts sample valid document", () => {
    const r = zVellumAppConfigBase.safeParse({
      relayBaseUrl: "http://127.0.0.1:8790",
      dataDir: "/tmp/v",
      agentKeyPath: "/k",
      defaultChannelWebSocketUrl: "ws://x",
      daemonJson: true,
    });
    expect(r.success).toBe(true);
  });

  test("rejects unknown keys (strict)", () => {
    const r = zVellumAppConfigBase.safeParse({ extra: 1 });
    expect(r.success).toBe(false);
  });

  test("rejects unknown baseUrl key (strict)", () => {
    const r = zVellumAppConfigBase.safeParse({ baseUrl: "http://x" });
    expect(r.success).toBe(false);
  });
});

describe("loadVellumAppConfig", () => {
  test("builtin defaults apply when no file and no env", () => {
    const { config } = loadVellumAppConfig({
      schema: zVellumAppConfigBase,
      layers: [vellumAppConfigBuiltinDefaults(), vellumAppConfigFromEnv({})],
      filePath: null,
    });
    expect(config.dataDir).toBe(path.join(homedir(), ".vellum", "data"));
  });

  test("env-only layer validates", () => {
    const { config } = loadVellumAppConfig({
      schema: zVellumAppConfigBase,
      layers: [
        vellumAppConfigBuiltinDefaults(),
        vellumAppConfigFromEnv({ VELLUM_BASE_URL: "http://env" }),
      ],
      filePath: null,
    });
    expect(config.relayBaseUrl).toBe("http://env");
  });
});

describe("readVellumConfigFileWithExtends", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  test("resolves extends chain", () => {
    dir = mkdtempSync(path.join(tmpdir(), "vellum-cfg-"));
    writeFileSync(path.join(dir, "base.json"), JSON.stringify({ dataDir: "/from-base" }));
    writeFileSync(
      path.join(dir, "child.json"),
      JSON.stringify({ extends: "./base.json", relayBaseUrl: "http://child" }),
    );
    const read = readVellumConfigFileWithExtends(path.join(dir, "child.json"));
    expect(read).toBeDefined();
    expect(read?.merged.relayBaseUrl).toBe("http://child");
    expect(read?.merged.dataDir).toBe("/from-base");
  });
});
