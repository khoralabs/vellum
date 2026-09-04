import { RelayClientError } from "@khoralabs/relay/client";
import { VellumClientError } from "./client-error";
import {
  VELLUM_ERROR_CODE,
  type VellumErrorCode,
  vellumErrorCodeForStatus,
} from "./contracts/control-errors";

/** Map a relay error code (or status) onto the vellum control error catalog. */
export function vellumErrorCodeFromRelay(
  code: string | undefined,
  status: number,
): VellumErrorCode {
  if (code === "not_found") return VELLUM_ERROR_CODE.not_found;
  if (code === "conflict") return VELLUM_ERROR_CODE.conflict;
  if (code === "service_unavailable" || code === "rate_limited") {
    return VELLUM_ERROR_CODE.unavailable;
  }
  if (code === "internal_error") return VELLUM_ERROR_CODE.internal_error;
  if (
    code === "invalid_request" ||
    code === "unauthorized" ||
    code === "forbidden" ||
    code === "gone" ||
    code === "payload_too_large" ||
    code === "not_implemented"
  ) {
    return VELLUM_ERROR_CODE.invalid_request;
  }
  return vellumErrorCodeForStatus(status);
}

/** Re-throw {@link RelayClientError} as {@link VellumClientError}; otherwise rethrow. */
export function rethrowRelayAsVellumClientError(e: unknown): never {
  if (e instanceof RelayClientError) {
    throw new VellumClientError(
      e.message,
      e.status,
      undefined,
      vellumErrorCodeFromRelay(e.code, e.status),
    );
  }
  throw e;
}

export async function withRelayClientErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    rethrowRelayAsVellumClientError(e);
  }
}
