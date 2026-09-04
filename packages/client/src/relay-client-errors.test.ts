import { describe, expect, test } from "bun:test";
import { RelayClientError } from "@khoralabs/relay/client/errors";
import { VellumClientError } from "./client-error";
import { VELLUM_ERROR_CODE } from "./contracts/control-errors";
import {
  rethrowRelayAsVellumClientError,
  vellumErrorCodeFromRelay,
  withRelayClientErrors,
} from "./relay-client-errors";

describe("relay → vellum error mapping", () => {
  test("maps known relay codes onto VELLUM_ERROR_CODE", () => {
    expect(vellumErrorCodeFromRelay("not_found", 404)).toBe(VELLUM_ERROR_CODE.not_found);
    expect(vellumErrorCodeFromRelay("conflict", 409)).toBe(VELLUM_ERROR_CODE.conflict);
    expect(vellumErrorCodeFromRelay("service_unavailable", 503)).toBe(
      VELLUM_ERROR_CODE.unavailable,
    );
    expect(vellumErrorCodeFromRelay("rate_limited", 429)).toBe(VELLUM_ERROR_CODE.unavailable);
    expect(vellumErrorCodeFromRelay("unauthorized", 401)).toBe(VELLUM_ERROR_CODE.invalid_request);
    expect(vellumErrorCodeFromRelay(undefined, 502)).toBe(VELLUM_ERROR_CODE.internal_error);
  });

  test("withRelayClientErrors surfaces VellumClientError with mapped code", async () => {
    try {
      await withRelayClientErrors(async () => {
        throw new RelayClientError("channel missing", 404, { code: "not_found" });
      });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(VellumClientError);
      expect((e as VellumClientError).status).toBe(404);
      expect((e as VellumClientError).code).toBe(VELLUM_ERROR_CODE.not_found);
      expect((e as VellumClientError).message).toBe("channel missing");
    }
  });

  test("non-relay errors pass through", () => {
    expect(() => rethrowRelayAsVellumClientError(new Error("plain"))).toThrow("plain");
  });
});
