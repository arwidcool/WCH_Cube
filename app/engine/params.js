// =============================================================================
//  params.js — peripheral parameter settings: baud rate, prescaler, period, the
//  numbers CubeMX puts under "Parameter Settings".
//
//  A `settings:` entry decides which SIGNALS a peripheral needs, so it changes the
//  pinout. A `params:` entry never touches a pin — it is a value the generated code
//  carries. That is why they are separate maps in S and separate tabs in the UI.
//
//  Schema, defaults and a worked CH32V006 example: app/assets/params.stub.yaml.
//  Every value is validated on the way in, so nothing downstream (codegen, export,
//  .wchproj) ever has to re-check a range.
// =============================================================================
import { M, S } from './model.js';
import { record } from './history.js';

// export.js already owns the name `num` at top level, and the browser bundle is one scope.
const toNumber = v => (typeof v === 'number' ? v : Number(String(v).trim()));

/** The definitions for one peripheral, normalised and in display order. */
export function paramDefs(pid) {
  const P = (M && M.peripherals && M.peripherals[pid]) || null;
  const list = P && Array.isArray(P.params) ? P.params : [];
  return list.filter(d => d && d.key).map(d => ({
    key: String(d.key),
    name: d.name || String(d.key),
    type: d.type || (Array.isArray(d.options) ? 'enum' : typeof d.default === 'boolean' ? 'bool' : 'number'),
    default: d.default,
    min: d.min, max: d.max, step: d.step,
    unit: d.unit || '',
    options: Array.isArray(d.options) ? d.options.map(String) : null,
    help: d.help || '',
    when: d.when || null,
  }));
}

/** Defaults for a peripheral, for initState(). Pure: no S, no undo. */
export function paramDefaults(P) {
  const out = {};
  for (const d of (P && Array.isArray(P.params) ? P.params : [])) {
    if (d && d.key !== undefined) out[String(d.key)] = d.default;
  }
  return out;
}

const defOf = (pid, key) => paramDefs(pid).find(d => d.key === key);

/**
 * Coerce and check one value against its definition.
 * Returns the value to store; throws a sentence a user can act on.
 */
export function validateParam(def, value, where) {
  const at = where || def.name;
  if (def.type === 'bool') {
    if (typeof value === 'boolean') return value;
    const s = String(value).toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
    throw new Error(`${at}: expected true or false, got "${value}"`);
  }
  if (def.type === 'enum') {
    const v = String(value);
    if (!def.options || !def.options.includes(v)) {
      throw new Error(`${at}: "${value}" is not one of ${(def.options || []).join(', ')}`);
    }
    return v;
  }
  const n = toNumber(value);
  if (!Number.isFinite(n)) throw new Error(`${at}: "${value}" is not a number`);
  if (def.type === 'int' && !Number.isInteger(n)) throw new Error(`${at}: ${n} must be a whole number`);
  if (def.min !== undefined && n < def.min) throw new Error(`${at}: ${n} is below the minimum ${def.min}${def.unit ? ' ' + def.unit : ''}`);
  if (def.max !== undefined && n > def.max) throw new Error(`${at}: ${n} is above the maximum ${def.max}${def.unit ? ' ' + def.unit : ''}`);
  return n;
}

/** Does this param apply with the peripheral's current settings? */
export function paramApplies(pid, def) {
  if (!def.when) return true;
  const st = S.periph[pid] && S.periph[pid].settings;
  if (!st) return true;
  return Object.entries(def.when).every(([setting, want]) => {
    const have = st[setting];
    if (have instanceof Set) return have.has(String(want));
    return String(have) === String(want);
  });
}

/** Everything the UI needs to draw the Parameter Settings tab for one peripheral. */
export function getParams(pid) {
  const store = (S.periph[pid] && S.periph[pid].params) || {};
  return paramDefs(pid).map(d => ({
    ...d,
    value: store[d.key] !== undefined ? store[d.key] : d.default,
    applicable: paramApplies(pid, d),
  }));
}

export function paramValue(pid, key) {
  const store = (S.periph[pid] && S.periph[pid].params) || {};
  if (store[key] !== undefined) return store[key];
  const d = defOf(pid, key);
  return d ? d.default : undefined;
}

/** Set one parameter. Validates, coerces, and records exactly one undo step. */
export function setParam(pid, key, value) {
  if (!M.peripherals[pid]) throw new Error(`No such peripheral: ${pid}`);
  const d = defOf(pid, key);
  if (!d) {
    const known = paramDefs(pid).map(x => x.key).join(', ');
    throw new Error(`${pid} has no parameter "${key}"${known ? ` (has: ${known})` : ' (it has none)'}`);
  }
  const v = validateParam(d, value, `${pid}.${d.name}`);
  record(`${pid} ${d.name}`);
  (S.periph[pid].params ||= {})[key] = v;
  return v;
}

/** Back to the file's defaults, as one undo step. */
export function resetParams(pid) {
  if (!M.peripherals[pid]) throw new Error(`No such peripheral: ${pid}`);
  record(`${pid} parameters reset`);
  S.periph[pid].params = paramDefaults(M.peripherals[pid]);
  return S.periph[pid].params;
}

/**
 * Apply a { key: value } map from a .wchproj. Unknown keys and values that no
 * longer validate are dropped and reported, never applied: a project saved
 * against an older MCU file must still open.
 */
export function applyParams(pid, obj) {
  const dropped = [];
  if (!obj || typeof obj !== 'object' || !S.periph[pid]) return dropped;
  const defs = paramDefs(pid);
  const store = (S.periph[pid].params ||= {});
  for (const [key, value] of Object.entries(obj)) {
    const d = defs.find(x => x.key === key);
    if (!d) { dropped.push(`${pid}.${key}: no such parameter any more`); continue; }
    try { store[key] = validateParam(d, value, `${pid}.${d.name}`); }
    catch (e) { dropped.push(e.message); }
  }
  return dropped;
}

/** Serialisable copy for .wchproj — only keys that differ from nothing. */
export function paramsObject(pid) {
  const store = (S.periph[pid] && S.periph[pid].params) || {};
  return { ...store };
}
