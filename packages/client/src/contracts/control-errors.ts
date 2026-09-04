import { z } from "zod";

/** Stable machine-readable codes for control-plane JSON error envelopes. */
export const VELLUM_ERROR_CODE = {
  invalid_request: "invalid_request",
  not_found: "not_found",
  conflict: "conflict",
  unavailable: "unavailable",
  internal_error: "internal_error",
} as const;

export type VellumErrorCode = (typeof VELLUM_ERROR_CODE)[keyof typeof VELLUM_ERROR_CODE];

export const zVellumErrorCode = z.enum([
  VELLUM_ERROR_CODE.invalid_request,
  VELLUM_ERROR_CODE.not_found,
  VELLUM_ERROR_CODE.conflict,
  VELLUM_ERROR_CODE.unavailable,
  VELLUM_ERROR_CODE.internal_error,
]);

export const zVellumErrorEnvelope = z.object({
  error: z.string(),
  code: zVellumErrorCode.optional(),
  detail: z.unknown().optional(),
});

export type VellumErrorEnvelope = z.infer<typeof zVellumErrorEnvelope>;

export function vellumErrorCodeForStatus(status: number): VellumErrorCode {
  if (status === 404) return VELLUM_ERROR_CODE.not_found;
  if (status === 409) return VELLUM_ERROR_CODE.conflict;
  if (status === 503) return VELLUM_ERROR_CODE.unavailable;
  if (status >= 500) return VELLUM_ERROR_CODE.internal_error;
  if (status >= 400) return VELLUM_ERROR_CODE.invalid_request;
  return VELLUM_ERROR_CODE.internal_error;
}

export function vellumJsonError(
  message: string,
  status: number,
  opts?: { code?: VellumErrorCode; detail?: unknown },
): Response {
  const code = opts?.code ?? vellumErrorCodeForStatus(status);
  const body: Record<string, unknown> = { error: message, code };
  if (opts?.detail !== undefined) body.detail = opts.detail;
  return Response.json(body, { status });
}
