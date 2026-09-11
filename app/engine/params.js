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

// Identity of a parameter. `key:` if the file gives one, otherwise the display name.
// This matches the UI's derivation exactly (app/template.html): both sides have to
// agree, because this string is what a .wchproj stores.
export const paramKey = d => String(d.key !== undefined ? d.key : d.name);

// An option is either a plain string or { name, value } where value is the register
// encoding. The stored value is always the NAME - it is what a human reads in a
// .wchproj - and codegen asks paramRegisterValue() for the number.
function normOptions(list) {
  if (!Array.isArray(list)) return null;
  return list.map(o => (o && typeof o === 'object')
    ? { name: String(o.name), value: o.value, sdk: o.sdk }
    : { name: String(o), value: o });
}

// A dependency may compare instead of match: I2C fast-mode duty only matters above
// 100 kHz, which is `depends_on: { param: speed, gt: 100000 }` (AGENT-1, 11:20Z).
// `equals` remains the default, so every file written so far keeps its meaning.
const OPS = ['equals', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'];
function comparison(dep) {
  for (const op of OPS) if (dep[op] !== undefined) return { op, value: dep[op] };
  return { op: 'equals', value: true };
}

// `when: { Mode: Asynchronous }` (a settings dependency) and
// `depends_on: { param: 'CRC Calculation', equals: true }` (a parameter dependency)
// both mean "this only applies while ...". Normalise them to one list.
function normDeps(d) {
  const out = [];
  if (d.when && typeof d.when === 'object') {
    for (const [name, want] of Object.entries(d.when)) out.push({ kind: 'setting', name, op: 'equals', value: want });
  }
  const dep = d.depends_on;
  if (dep) {
    if (typeof dep === 'string') {
      const [name, ...rest] = dep.split('=');
      out.push({ kind: 'any', name: name.trim(), op: 'equals', value: rest.join('=').trim() });
    } else if (dep.param !== undefined) {
      out.push({ kind: 'param', name: String(dep.param), ...comparison(dep) });
    } else if (dep.setting !== undefined) {
      out.push({ kind: 'setting', name: String(dep.setting), ...comparison(dep) });
    } else {
      for (const [name, want] of Object.entries(dep)) out.push({ kind: 'any', name, op: 'equals', value: want });
    }
  }
  return out;
}

/**
 * Normalise a raw `params:`-schema list into display order. Exported because it is
 * not only peripherals: `dma.channel_params` is deliberately the SAME schema, so
 * resources.js renders and validates DMA_InitTypeDef fields through this one
 * definition rather than a second, drifting copy. `sdk_field` / `sdk` / `field` are
 * carried through untouched - codegen needs them and nothing here interprets them.
 */
export function normaliseParamDefs(list) {
  const raw = Array.isArray(list) ? list : [];
  return raw.filter(d => d && (d.key !== undefined || d.name !== undefined)).map(d => ({
    key: paramKey(d),
    name: d.name !== undefined ? String(d.name) : paramKey(d),
    type: d.type || (Array.isArray(d.options) ? 'enum' : typeof d.default === 'boolean' ? 'bool' : 'number'),
    default: d.default,
    min: d.min, max: d.max, step: d.step,
    unit: d.unit || '',
    options: normOptions(d.options),
    group: d.group || '',
    register: d.register || '',
    notes: d.notes || '',
    readonly: !!(d.readonly || d.computed),
    help: d.help || d.notes || '',
    deps: normDeps(d),
    // Carried through untouched: only codegen interprets these, and a generator that
    // cannot see them would have to infer the SDK mapping, which is the whole thing
    // data/FORMAT.md's "not every parameter is an init-struct member" section forbids.
    struct: d.struct, field: d.field, sdk_field: d.sdk_field,
    sdk_enabled: d.sdk_enabled, sdk_disabled: d.sdk_disabled,
    sdk_call: d.sdk_call, sdk_args: d.sdk_args, sdk_repeat: d.sdk_repeat,
    sdk_none: !!d.sdk_none, sdk_note: d.sdk_note || '',
  }));
}

/** The definitions for one peripheral, normalised and in display order. */
export function paramDefs(pid) {
  const P = (M && M.peripherals && M.peripherals[pid]) || null;
  return normaliseParamDefs(P && P.params);
}

/** Defaults for a peripheral, for initState(). Pure: no S, no undo. */
export function paramDefaults(P) {
  const out = {};
  for (const d of (P && Array.isArray(P.params) ? P.params : [])) {
    if (d && (d.key !== undefined || d.name !== undefined)) out[paramKey(d)] = d.default;
  }
  return out;
}

/** The register encoding behind the chosen option, for codegen. */
export function paramRegisterValue(pid, key) {
  const d = paramDefs(pid).find(x => x.key === key);
  if (!d) return undefined;
  const v = paramValue(pid, key);
  if (!d.options) return v;
  const hit = d.options.find(o => String(o.name) === String(v));
  return hit ? hit.value : undefined;
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
    const names = (def.options || []).map(o => String(o.name));
    if (!names.includes(v)) throw new Error(`${at}: "${value}" is not one of ${names.join(', ')}`);
    return v;
  }
  const n = toNumber(value);
  if (!Number.isFinite(n)) throw new Error(`${at}: "${value}" is not a number`);
  if (def.type === 'int' && !Number.isInteger(n)) throw new Error(`${at}: ${n} must be a whole number`);
  if (def.min !== undefined && n < def.min) throw new Error(`${at}: ${n} is below the minimum ${def.min}${def.unit ? ' ' + def.unit : ''}`);
  if (def.max !== undefined && n > def.max) throw new Error(`${at}: ${n} is above the maximum ${def.max}${def.unit ? ' ' + def.unit : ''}`);
  return n;
}

// A value that cannot be compared numerically leaves the field visible: a typo in the
// data must never silently hide a setting the user needs.
function compare(have, op, want) {
  if (op === 'in') return Array.isArray(want) && want.map(String).includes(String(have));
  if (have instanceof Set) return have.has(String(want));
  if (op === 'equals' || op === 'ne') {
    const same = typeof want === 'boolean' ? Boolean(have) === want : String(have) === String(want);
    return op === 'ne' ? !same : same;
  }
  const a = Number(have), b = Number(want);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  if (op === 'gt') return a > b;
  if (op === 'gte') return a >= b;
  if (op === 'lt') return a < b;
  if (op === 'lte') return a <= b;
  return true;
}

/**
 * Does this parameter apply right now? A dependency may name a setting or another
 * parameter. A dependency on something that does not exist is ignored rather than
 * treated as false: a typo in the data must not silently hide a field.
 */
export function paramApplies(pid, def) {
  const deps = def.deps || [];
  if (!deps.length) return true;
  const st = (S.periph[pid] && S.periph[pid].settings) || {};
  const ps = (S.periph[pid] && S.periph[pid].params) || {};
  return deps.every(dep => {
    let have;
    if (dep.kind === 'setting') have = st[dep.name];
    else if (dep.kind === 'param') have = ps[dep.name];
    else have = dep.name in ps ? ps[dep.name] : st[dep.name];
    if (have === undefined) return true;
    return compare(have, dep.op || 'equals', dep.value !== undefined ? dep.value : dep.equals);
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
  if (d.readonly) throw new Error(`${pid}.${d.name} is fixed by the hardware and cannot be set`);
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
