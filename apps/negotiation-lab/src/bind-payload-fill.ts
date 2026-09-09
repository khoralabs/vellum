import type { JsonDocument } from "@khoralabs/obp-core";

/**
 * When a bind policy pins values via `const` / single-value `enum`, fill missing
 * payload fields so AJV required checks pass. Does not invent free values.
 */
export function fillPayloadFromBindPolicy(policy: unknown, payload: unknown): JsonDocument {
  const base =
    payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? { ...(payload as Record<string, unknown>) }
      : {};
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) {
    return base as JsonDocument;
  }
  const props = (policy as { properties?: unknown }).properties;
  if (props === null || typeof props !== "object" || Array.isArray(props)) {
    return base as JsonDocument;
  }
  for (const [key, schema] of Object.entries(props as Record<string, unknown>)) {
    if (base[key] !== undefined) continue;
    if (schema === null || typeof schema !== "object" || Array.isArray(schema)) continue;
    const s = schema as { const?: unknown; enum?: unknown };
    if (s.const !== undefined) {
      base[key] = s.const;
      continue;
    }
    if (Array.isArray(s.enum) && s.enum.length === 1) {
      base[key] = s.enum[0];
    }
  }
  return base as JsonDocument;
}
