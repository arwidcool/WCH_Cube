// =============================================================================
//  util.js — the few primitives every other engine module needs.
// =============================================================================

// Deep copy that keeps Sets as Sets (the checkbox settings in S are Sets) and
// does not depend on structuredClone, which jsdom does not implement and older
// webviews do not have. The data is plain YAML: scalars, arrays, maps, Sets.
export function deepClone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepClone);
  if (v instanceof Set) return new Set([...v].map(deepClone));
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [deepClone(k), deepClone(x)]));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = deepClone(x);
  return out;
}
