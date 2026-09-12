// =============================================================================
//  util.js — the few primitives every other engine module needs.
// =============================================================================

/**
 * Is this parameter definition a `const:` member - one whose value is fixed by WHICH
 * INSTANCE the peripheral is, rather than chosen by the user? (`ch32x035_opa.h:139`
 * OPA_NUM, and CMP's, which `ch32x035_opa.c:117` branches on.)
 *
 * It lives here, in the module with no dependencies, because two modules that cannot
 * import each other both need the answer: `model.js` seeds the parameter store in
 * `initState()` and `params.js` filters the list the UI draws, and `params.js` already
 * imports `model.js`. Two copies of this predicate would drift silently - a const member
 * that reached the store would put a null into every .wchproj that carries the
 * peripheral - so there is one definition and `app/tests/params.test.js` asserts the two
 * callers agree.
 */
export const isConstParam = d => !!d && d.const !== undefined;

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
