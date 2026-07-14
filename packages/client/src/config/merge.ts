function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Last-wins merge left-to-right (no `plugins` map semantics). */
export function mergeVellumAppConfigLayers(
  layers: ReadonlyArray<unknown>,
): Record<string, unknown> {
  const objs: Array<Record<string, unknown>> = [];
  for (const l of layers) {
    if (l === undefined || l === null) continue;
    if (!isPlainObject(l)) continue;
    objs.push(l);
  }
  const out: Record<string, unknown> = {};
  const keys = new Set<string>();
  for (const o of objs) for (const k of Object.keys(o)) keys.add(k);
  for (const k of keys) {
    let last: unknown;
    let seen = false;
    for (const o of objs) {
      if (k in o && o[k] !== undefined) {
        last = o[k];
        seen = true;
      }
    }
    if (seen) out[k] = last;
  }
  return out;
}
