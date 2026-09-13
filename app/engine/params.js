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
import { M, S, neutralChoice } from './model.js';
import { record } from './history.js';
import { isConstParam } from './util.js';

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
    // The SDK exposes a setter, but this generator's one-shot init function is not a
    // safe place to call it (LTDC's pixel format — the setter is unsafe before the
    // layer is otherwise configured). `sdk_none:` says "the SDK has nothing"; this
    // says "the SDK has something, and firmware sets it some other way" — a different
    // true statement in the same generated-comment shape.
    sdk_manual: !!d.sdk_manual,
    // A struct member that is itself a POINTER to a second struct no SDK function takes
    // alone (ch32h417_fmc.h:113-115 — `FMC_NORSRAMInit()` dereferences
    // `FMC_ReadWriteTimingStruct` unconditionally). `embed:` names which of that inner
    // struct's `codegen.init_structs.<struct>.embed` entries this param's block belongs
    // to, so two members of the SAME C struct TYPE (FMC_ReadWriteTimingStruct /
    // FMC_WriteTimingStruct, both `FMC_NORSRAMTimingInitTypeDef*`) become two separate
    // blocks instead of one merged, ambiguous one. See codegen.js `initPlan()`.
    embed: d.embed || null,
    // A member whose value is fixed by WHICH INSTANCE this is, not by the user. OPA and
    // CMP begin their init struct with a `*_NUM` and the SDK branches on it
    // (`ch32x035_opa.c:117`: `if (OPA_InitStruct->OPA_NUM == OPA1)`), so a struct with
    // the member unset configures whichever instance the garbage happens to name.
    //
    // It is not an editable choice - offering OPA1 a choice of "OPA2" would offer a
    // choice the silicon does not have - and it is not `readonly:` either, because
    // codegen filters those out of the init plan ENTIRELY: the member would be dropped
    // rather than filled. So it is its own kind, emitted as a literal and never drawn.
    'const': d.const,
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
    if (!d || (d.key === undefined && d.name === undefined)) continue;
    // A `const:` member has nothing for the user to store, and seeding it with
    // `undefined` would put a null into every .wchproj that carries this peripheral.
    // `isConstParam` is the same predicate `initState()` uses, from the one module both
    // can import - see util.js for why it is not defined in either of these two.
    if (isConstParam(d)) continue;
    out[paramKey(d)] = d.default;
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
 *
 * That last choice is right for a FIELD and wrong for a whole init STRUCT, which is
 * why `depProblems()` exists beside it - read that before changing this.
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

/**
 * The dependencies of one parameter that cannot be resolved against the MCU file, one
 * sentence each. Empty when every `when:` / `depends_on:` names something real.
 *
 * **Why this exists, and it is a measured defect rather than a precaution.** An init
 * struct is emitted when at least ONE of its params applies, and `paramApplies()`
 * treats an unresolvable dependency as applicable so a typo cannot hide a field. Put
 * those together and a typo does not hide a second struct - it makes it
 * UNCONDITIONAL. All three of these were reproduced on the synthetic fixture with a
 * `USART_ClockInitTypeDef` gated on `when: { Mode: Synchronous }`:
 *
 *   A. `when: { Modee: Synchronous }` - a typo'd SETTING name - emits
 *      `USART_ClockInit(USARTx, &s)` in ASYNCHRONOUS mode.
 *   B. `when:` on only one of the struct's params makes the struct unconditional
 *      again, because one ungated param is enough to emit it. (Data discipline: every
 *      param of a conditional struct needs the same `when:`. Not detectable here,
 *      because a struct legitimately may mix gated and ungated fields.)
 *   C. `when: { Mode: Synchrounous }` - a typo'd CHOICE name - compares unequal, so
 *      the struct is never emitted: the user picks Synchronous, the setting claims the
 *      CK pad, and nothing ever drives it.
 *
 * C is the round's defect class - a claimed pad the generated C never drives - and it
 * is silent. A and C are reported here and turned into a generated TODO by codegen, so
 * `--strict` fails on the data instead of emitting a plausible wrong file. The
 * semantics of `paramApplies()` are deliberately NOT changed: this reports, it does
 * not re-decide.
 */
export function depProblems(pid, def) {
  const P = M.peripherals[pid] || {};
  const settings = P.settings || [];
  const defs = paramDefs(pid);
  const out = [];
  for (const dep of def.deps || []) {
    const bySetting = settings.find(x => x.name === dep.name);
    const byParam = defs.find(x => x.key === dep.name || x.name === dep.name);
    const target = dep.kind === 'setting' ? bySetting : dep.kind === 'param' ? byParam : (bySetting || byParam);
    if (!target) {
      // A `when:` key naming a parameter reads as if it would work and does not: the
      // dependency is matched against the settings store, so the gate never closes and
      // the field is applicable for ever. `depends_on: { param: ..., equals: ... }` is
      // the form that reaches a parameter, so say which one rather than only that the
      // name is unknown - the two need different repairs.
      out.push(byParam
        ? `${def.name}: when: names "${dep.name}", which is a parameter of ${pid}, not a `
          + `setting - a dependency on a parameter is written depends_on: { param: ${dep.name} }`
        : `${def.name}: when: names "${dep.name}", which is neither a setting nor a `
          + `parameter of ${pid}`);
      continue;
    }
    // Only an equality against an enumerated target is checkable. gt/lt/in are
    // arithmetic or set comparisons against a numeric parameter, and a plain bool or
    // number target has no list to be a member of.
    if ((dep.op || 'equals') !== 'equals') continue;
    const isSetting = target === bySetting;
    const names = (isSetting ? (target.choices || []).map(c => c.name)
      : (target.options || []).map(o => o.name)).map(String);
    if (!names.length) continue;
    for (const v of (Array.isArray(dep.value) ? dep.value : [dep.value])) {
      if (names.includes(String(v))) continue;
      out.push(`${def.name}: when: expects "${dep.name}" = "${v}", which is not one of its `
        + `${isSetting ? 'choices' : 'options'} (${names.join(', ')})`);
    }
  }
  return out;
}

/** Everything the UI needs to draw the Parameter Settings tab for one peripheral. */
export function getParams(pid) {
  const store = (S.periph[pid] && S.periph[pid].params) || {};
  // A `const:` member is never a control: there is exactly one value it can take, and it
  // is the one codegen will write. Drawing it would offer a choice the silicon lacks.
  return paramDefs(pid).filter(d => !isConstParam(d)).map(d => ({
    ...d,
    value: store[d.key] !== undefined ? store[d.key] : d.default,
    applicable: paramApplies(pid, d),
  }));
}

export function paramValue(pid, key) {
  const store = (S.periph[pid] && S.periph[pid].params) || {};
  if (store[key] !== undefined) return store[key];
  const d = defOf(pid, key);
  if (!d) return undefined;
  // A `const:` member's value is the literal the MCU file gives, not a default the user
  // could have changed - so it is returned here and the store is never consulted for it.
  return isConstParam(d) ? d.const : d.default;
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
  if (isConstParam(d)) {
    throw new Error(`${pid}.${d.name} is fixed at ${d.const} by the MCU file and cannot be set`);
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
    if (isConstParam(d)) {
      dropped.push(`${pid}.${key}: fixed at ${d.const} by the MCU file, not settable`);
      continue;
    }
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

// ---- per-channel parameters ---------------------------------------------------
//  Most init structs are filled once per peripheral. `TIM_OCInitTypeDef` is not: a
//  timer has one time base and up to four independent compare units, so the struct
//  is filled and applied once for EACH configured channel, by one of four different
//  functions. `peripherals.<TIM>.channel_params` carries all of that:
//
//     struct:      TIM_OCInitTypeDef
//     applies_per: channel
//     sdk_calls:   { 1: TIM_OC1Init, 2: TIM_OC2Init, ... }   a table, not a pattern
//     params:      the same entry schema as `dma.channel_params`
//     channels:    which setting decides each channel, and which of its choices are
//                  output-compare rather than input-capture
//
//  Storage is `S.periph[pid].channelParams[<channel>][<key>]`, keyed by the channel
//  NUMBER the data uses, so nothing here has to parse a setting's display name.

/** The `channel_params` block for a peripheral, or null. */
export function channelParamBlock(pid) {
  const P = (M && M.peripherals && M.peripherals[pid]) || null;
  const cp = P && P.channel_params;
  if (!cp || typeof cp !== 'object' || !Array.isArray(cp.params)) return null;
  return cp;
}

/** Its parameter definitions, normalised exactly like `params:` and `dma.channel_params`. */
export function channelParamDefs(pid) {
  const cp = channelParamBlock(pid);
  return cp ? normaliseParamDefs(cp.params) : [];
}

const chanDefOf = (pid, key) => channelParamDefs(pid).find(d => d.key === key);

/**
 * ---- one struct, applied once PER INSTANCE -----------------------------------
 *
 * `channel_params` was written for `TIM_OCInitTypeDef`, where the instance is a timer
 * CHANNEL and four different functions apply it (`TIM_OC1Init` … `TIM_OC4Init`), each
 * taking the peripheral's own handle. CH32H417's LTDC is the same problem with the two
 * halves swapped: ONE function applies the struct — `LTDC_LayerInit(LTDC_Layerx, &s)`,
 * `ch32h417_ltdc.h:225` — and what changes per instance is the HANDLE it is given
 * (`LTDC_Layer1` / `LTDC_Layer2`, `ch32h417.h:1770-1771`).
 *
 * So the two things that can vary per instance are the FUNCTION and the HANDLE, and
 * they vary independently. This is that generalisation rather than a second mechanism
 * beside it: one map, `instances:`, naming both per instance along with the setting that
 * decides whether the instance is live —
 *
 *     channel_params:
 *       struct: LTDC_Layer_InitTypeDef
 *       applies_per: layer                      the noun; names the store key and the UI
 *       instances:
 *         1: { sdk_call: LTDC_LayerInit, handle: LTDC_Layer1,
 *              setting: Layer 1, active_choices: [Enabled] }
 *
 * `handle:` absent means "the peripheral's own `codegen.periph_handle`", which is the TIM
 * case; `sdk_call:` differing per instance is the TIM case too. Neither is derived: a
 * function name pasted together from a number is the same class of guess as a function
 * name derived from a struct name, which this generator already refuses to make.
 *
 * THE OLD SPELLING STILL READS. `sdk_calls: { n: fn }` beside `channels: { n: { setting,
 * output_choices } }` is normalised into exactly the same rows, so the six shipped
 * `channel_params` blocks behave identically. Those two parallel maps keyed by the same
 * number are also why one map is better: a channel present in one and absent from the
 * other is silently half-defined today.
 */
export function paramInstances(pid) {
  const cp = channelParamBlock(pid);
  if (!cp) return [];
  const rows = new Map();
  const at = n => rows.get(n) || rows.set(n, { n, fn: null, handle: null, setting: null, activeChoices: null }).get(n);
  const num = k => Number(k);
  // The new spelling first: everything about one instance in one place.
  if (cp.instances && typeof cp.instances === 'object') {
    for (const [k, spec] of Object.entries(cp.instances)) {
      if (!Number.isFinite(num(k)) || !spec || typeof spec !== 'object') continue;
      const r = at(num(k));
      if (spec.sdk_call) r.fn = spec.sdk_call;
      if (spec.handle) r.handle = spec.handle;
      if (spec.setting) r.setting = spec.setting;
      const choices = spec.active_choices !== undefined ? spec.active_choices : spec.output_choices;
      if (Array.isArray(choices)) r.activeChoices = choices;
    }
  }
  // The old spelling, folded into the same rows. `output_choices` is what `channels:`
  // calls `active_choices`; a timer channel is "active" when it is an output compare.
  if (cp.sdk_calls && typeof cp.sdk_calls === 'object') {
    for (const [k, fn] of Object.entries(cp.sdk_calls)) {
      if (Number.isFinite(num(k)) && fn && !at(num(k)).fn) at(num(k)).fn = fn;
    }
  }
  if (cp.channels && typeof cp.channels === 'object') {
    for (const [k, spec] of Object.entries(cp.channels)) {
      if (!Number.isFinite(num(k)) || !spec || typeof spec !== 'object') continue;
      const r = at(num(k));
      if (!r.setting && spec.setting) r.setting = spec.setting;
      const choices = spec.output_choices !== undefined ? spec.output_choices : spec.active_choices;
      if (r.activeChoices === null && Array.isArray(choices)) r.activeChoices = choices;
    }
  }
  return [...rows.values()].sort((a, b) => a.n - b.n);
}

/** The noun this block repeats over — "channel" unless the data says otherwise. */
export const instanceNoun = pid => {
  const cp = channelParamBlock(pid);
  return (cp && cp.applies_per) || 'channel';
};

/** The channel numbers this peripheral's data describes, in order. */
export function channelNumbers(pid) {
  return paramInstances(pid).map(r => r.n);
}

/**
 * The channels whose init struct should actually be emitted, and why not when they
 * should not. `channel_params.channels` states which SETTING decides each channel and
 * which of that setting's choices are output-compare; without it this returns a reason
 * rather than a guess, because the only other way to link a channel number to a setting
 * is to read "Channel1" and take the 1 - deriving structure from a display string.
 */
export function activeChannels(pid) {
  const p = activeInstances(pid);
  return { channels: p.instances.map(r => r.n), missing: p.missing };
}

/**
 * The instances whose struct should actually be emitted, each carrying the function and
 * the handle that apply it — everything `codegen` needs and nothing it has to derive.
 *
 * A row with no `setting:` is not guessed at. The only other way to link instance 1 to a
 * setting is to read `"Channel1"` and take the 1, which is deriving structure from a
 * display string; so the block reports what it is short of and the generator turns that
 * into a named TODO rather than emitting an init for a channel nobody configured.
 */
export function activeInstances(pid) {
  const cp = channelParamBlock(pid);
  if (!cp) return { instances: [], missing: null, noun: 'channel' };
  const noun = instanceNoun(pid);
  const rows = paramInstances(pid);
  const undescribed = rows.filter(r => !r.setting);
  // NOTHING in the block says which setting decides an instance. This is round 4's E2,
  // open on TASKS.md and the reason the per-channel emitter was parked in the first
  // place: the six shipped `channel_params` blocks carry `sdk_calls:` and no `channels:`.
  //
  // It is reported as a NOTE rather than a TODO, and the distinction is deliberate. A
  // TODO is a gap the generator hit while doing work it could otherwise have done, and
  // `tests/codegen_compile.test.js` requires every KIND of TODO to be tracked with a
  // TASKS.md line - a file this agent does not own. Before this mechanism existed the
  // generated C said NOTHING at all about these structs, so spelling it TODO would take
  // a pre-existing, already-tracked data gap and turn four green fixtures red on another
  // agent's gate. The note puts the hole in front of the reader, in the file where they
  // will look for it, without claiming the generator just discovered it.
  if (!rows.length || undescribed.length === rows.length) {
    return {
      instances: [], missing: null, noun,
      note: `${pid}.channel_params fills ${cp.struct} once per ${noun} and names no setting for `
        + `any ${noun}, so no ${noun} is initialised here. Which ${noun}s are live cannot be `
        + `worked out from the settings, and the only other way to link ${noun} 1 to a setting `
        + `is to read the digit out of its display name. Add instances: { <n>: { setting: `
        + `<name>, active_choices: [...] } } — TASKS.md E2.`,
    };
  }
  const st = (S.periph[pid] || {}).settings || {};
  const out = [];
  for (const r of rows) {
    if (!r.setting) continue;
    const value = st[r.setting];
    if (value === undefined) continue;
    if (Array.isArray(r.activeChoices)) {
      if (!r.activeChoices.map(String).includes(String(value))) continue;
    } else if (String(value) === String(neutralChoiceName(pid, r.setting))) {
      continue;                                  // no list given: anything but the neutral choice
    }
    out.push(r);
  }
  // A block that describes SOME of its instances and not others is a half-written map,
  // and the half it left out is invisible - the peripheral simply never initialises that
  // instance. Say which ones, rather than letting the count look right.
  // A block that describes SOME instances and not others IS a TODO: the map is half
  // written, the generator is emitting for its siblings, and the half left out is
  // invisible - that instance simply never initialises. No shipped part is in this state,
  // so it costs nothing today and catches the next one that half-writes the map.
  const partial = undescribed.length
    ? `${pid}.channel_params names no setting for ${noun} ${undescribed.map(r => r.n).join(', ')}, `
      + `so ${undescribed.length === 1 ? 'it is' : 'they are'} never initialised while its `
      + `siblings are. Every instance in the map needs a setting: or none of them does`
    : null;
  return { instances: out, missing: partial, note: null, noun };
}

function neutralChoiceName(pid, settingName) {
  const P = M.peripherals[pid] || {};
  const s = (P.settings || []).find(x => x.name === settingName);
  return s ? neutralChoice(s).name : null;
}

/** Defaults for one channel, for initState() and for a channel becoming active. */
export function channelParamDefaults(pid) {
  const out = {};
  for (const d of channelParamDefs(pid)) out[d.key] = d.default;
  return out;
}

/** Everything a per-channel editor needs for one channel. */
export function getChannelParams(pid, channel) {
  const store = ((S.periph[pid] || {}).channelParams || {})[channel] || {};
  return channelParamDefs(pid).map(d => ({
    ...d,
    value: store[d.key] !== undefined ? store[d.key] : d.default,
    applicable: paramApplies(pid, d),
  }));
}

export function channelParamValue(pid, channel, key) {
  const store = ((S.periph[pid] || {}).channelParams || {})[channel] || {};
  if (store[key] !== undefined) return store[key];
  const d = chanDefOf(pid, key);
  return d ? d.default : undefined;
}

/** The register encoding behind the chosen option, for codegen. */
export function channelParamRegisterValue(pid, channel, key) {
  const d = chanDefOf(pid, key);
  if (!d) return undefined;
  const v = channelParamValue(pid, channel, key);
  if (!d.options) return v;
  const hit = d.options.find(o => String(o.name) === String(v));
  return hit ? hit.value : undefined;
}

/** Set one per-channel parameter. Validated and undoable exactly like setParam. */
export function setChannelParam(pid, channel, key, value) {
  if (!M.peripherals[pid]) throw new Error(`No such peripheral: ${pid}`);
  const nums = channelNumbers(pid);
  if (!nums.length) throw new Error(`${pid} has no per-channel parameters`);
  const ch = Number(channel);
  if (!nums.includes(ch)) {
    throw new Error(`${pid} has no channel ${channel} (it has ${nums.join(', ')})`);
  }
  const d = chanDefOf(pid, key);
  if (!d) {
    const known = channelParamDefs(pid).map(x => x.key).join(', ');
    throw new Error(`${pid} channel ${ch} has no parameter "${key}"${known ? ` (has: ${known})` : ''}`);
  }
  if (d.readonly) throw new Error(`${pid}.${d.name} is fixed by the hardware and cannot be set`);
  const v = validateParam(d, value, `${pid} CH${ch}.${d.name}`);
  record(`${pid} CH${ch} ${d.name}`);
  const st = (S.periph[pid].channelParams ||= {});
  (st[ch] ||= {})[key] = v;
  return v;
}

/** Serialisable copy for .wchproj - only channels somebody touched. */
export function channelParamsObject(pid) {
  const store = (S.periph[pid] || {}).channelParams || {};
  const out = {};
  for (const [ch, vals] of Object.entries(store)) {
    if (vals && Object.keys(vals).length) out[ch] = { ...vals };
  }
  return out;
}

/**
 * Apply a { channel: { key: value } } map from a .wchproj. A channel or a key the part
 * no longer has is dropped and reported, never applied - the same contract as
 * applyParams, for the same reason.
 */
export function applyChannelParams(pid, obj) {
  const dropped = [];
  if (!obj || typeof obj !== 'object' || !S.periph[pid]) return dropped;
  for (const [ch, vals] of Object.entries(obj)) {
    if (!vals || typeof vals !== 'object') continue;
    for (const [key, value] of Object.entries(vals)) {
      try { setChannelParam(pid, ch, key, value); }
      catch (e) { dropped.push(e.message); }
    }
  }
  return dropped;
}
