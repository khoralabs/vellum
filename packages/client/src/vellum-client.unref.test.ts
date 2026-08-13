import { describe, expect, test } from "bun:test";
import { unrefDaemonChild } from "./vellum-client";

describe("unrefDaemonChild", () => {
  test("calls unref on the spawned child", () => {
    let calls = 0;
    unrefDaemonChild({
      unref() {
        calls += 1;
      },
    });
    expect(calls).toBe(1);
  });
});
