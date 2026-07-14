/** Canonicalize deprecated config keys before strict schema validation. */
export function normalizeVellumAppConfigRaw(
  merged: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...merged };
  if (out.relayBaseUrl === undefined && typeof out.baseUrl === "string" && out.baseUrl.length > 0) {
    out.relayBaseUrl = out.baseUrl;
  }
  delete out.baseUrl;
  return out;
}
