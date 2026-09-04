import {
  type VellumErrorCode,
  vellumErrorCodeForStatus,
  zVellumErrorCode,
} from "./contracts/control-errors";

export class VellumClientError extends Error {
  readonly status: number;
  readonly code?: VellumErrorCode;
  readonly bodyText?: string;

  constructor(message: string, status: number, bodyText?: string, code?: VellumErrorCode) {
    super(message);
    this.name = "VellumClientError";
    this.status = status;
    this.bodyText = bodyText;
    if (code !== undefined) this.code = code;
  }
}

export function throwFromFailedControlResponse(
  status: number,
  statusText: string,
  j: unknown,
): never {
  let message = statusText.length > 0 ? statusText : `Request failed with status ${status}`;
  let code: VellumErrorCode | undefined;
  let bodyText: string | undefined;
  if (typeof j === "object" && j !== null) {
    bodyText = JSON.stringify(j);
    const rec = j as { error?: unknown; code?: unknown };
    if (typeof rec.error === "string" && rec.error.length > 0) message = rec.error;
    const parsed = zVellumErrorCode.safeParse(rec.code);
    if (parsed.success) code = parsed.data;
  }
  throw new VellumClientError(message, status, bodyText, code ?? vellumErrorCodeForStatus(status));
}
