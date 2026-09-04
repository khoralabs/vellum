import { describe, expect, test } from "bun:test";
import { VellumClientError } from "../vellum-client";
import { VELLUM_ERROR_CODE, vellumErrorCodeForStatus, vellumJsonError } from "./control-errors";

describe("vellumJsonError", () => {
  test("emits status-based code by default", async () => {
    const res = vellumJsonError("nope", 404);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "nope", code: VELLUM_ERROR_CODE.not_found });
  });

  test("preserves detail", async () => {
    const res = vellumJsonError("bad request", 400, { detail: { field: "x" } });
    expect(await res.json()).toEqual({
      error: "bad request",
      code: VELLUM_ERROR_CODE.invalid_request,
      detail: { field: "x" },
    });
  });
});

describe("VellumClientError", () => {
  test("stores status and code", () => {
    const err = new VellumClientError("x", 503, undefined, VELLUM_ERROR_CODE.unavailable);
    expect(err.status).toBe(503);
    expect(err.code).toBe(VELLUM_ERROR_CODE.unavailable);
    expect(vellumErrorCodeForStatus(409)).toBe(VELLUM_ERROR_CODE.conflict);
  });
});

describe("throwFromFailedControlResponse via control fetch failures", () => {
  // Exercise through a minimal stub: same decode path as VellumClient private helper.
  test("parses envelope code and falls back by status", async () => {
    const { throwFromFailedControlResponseForTest } = await import("../vellum-client");
    try {
      throwFromFailedControlResponseForTest(404, "Not Found", {
        error: "unknown session: x",
        code: "not_found",
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(VellumClientError);
      expect((e as VellumClientError).code).toBe(VELLUM_ERROR_CODE.not_found);
      expect((e as VellumClientError).message).toBe("unknown session: x");
    }
    try {
      throwFromFailedControlResponseForTest(503, "Unavailable", { error: "multiplex not ready" });
      expect.unreachable();
    } catch (e) {
      expect((e as VellumClientError).code).toBe(VELLUM_ERROR_CODE.unavailable);
    }
    try {
      throwFromFailedControlResponseForTest(400, "Bad Request", null);
      expect.unreachable();
    } catch (e) {
      expect((e as VellumClientError).code).toBe(VELLUM_ERROR_CODE.invalid_request);
      expect((e as VellumClientError).message).toBe("Bad Request");
    }
  });
});
