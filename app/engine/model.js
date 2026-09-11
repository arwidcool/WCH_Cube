// =============================================================================
//  model.js — MCU file parsing, derived maps, configuration state, pin helpers.
//  No DOM. Owned by AGENT-2 (ENGINE).
//
//  Public state:
//    M  parsed MCU model + derived maps (_pinSignals, _phys, _alias, _src)
//    S  configuration state { pkg, periph, manual, gpio, sel, selPin, clock, zoom, panX, panY }
//  The UI reads M/S/E as globals in the browser bundle and as live ES module
//  bindings in Node tests. Never reassign M or S from outside this module.
// =============================================================================
import { defaultClock } from './clock.js';
import { resolveInherits } from './inherit.js';
import { record, clearHistory } from './history.js';

export const PACKAGES = {};          // package id -> geometry (from data/packages/packages.yaml)
export const MCU_FILES = {};         // mcu.name -> yaml source text (bundled + opened from disk)

export let M = null;
export let S = null;

// ---- YAML hook ---------------------------------------------------------------
// Browser: js-yaml is on globalThis. Node tests: call setYaml(jsyaml) first.
let YAML = null;
export function setYaml(y) { YAML = y; }
function yaml() {
  const y = YAML || (typeof globalThis !== 'undefined' ? globalThis.jsyaml : null);
  if (!y) throw new Error('No YAML parser available — call setYaml(jsyaml) first');
  return y;
}
export const yamlLoad = text => yaml().load(text);
export const yamlDump = (obj, opt) => yaml().dump(obj, opt);

// ---- registries --------------------------------------------------------------
export function loadPackages(src) {
  const y = typeof src === 'string' ? yamlLoad(src) : src;
  for (const p of y.packages) PACKAGES[p.id] = p;
  return PACKAGES;
}
export function registerMcuFile(text) {
  const y = yamlLoad(text);
  if (!y || !y.mcu || !y.mcu.name) throw new Error('Not an MCU file (no mcu.name)');
  MCU_FILES[y.mcu.name] = text;
  return y.mcu.name;
}

// ---- derive ------------------------------------------------------------------
// Pin alternate functions are NOT listed per pin in the data files; they are
// derived here from every peripheral's remap table (single source of truth).
export function deriveMcu(y) {
  y._pinSignals = {};                                   // pin name -> [{periph, signal, remap}]
  for (const [pid, P] of Object.entries(y.peripherals)) {
    (P.remaps || []).forEach((r, ri) => {
      for (const [sig, pin] of Object.entries(r.pins || {})) {
        (y._pinSignals[pin] ||= []).push({ periph: pid, signal: sig, remap: ri });
      }
    });
  }
  y._phys = {};                                         // package -> {pin number: [names]}
  y._alias = {};                                        // package -> {name: canonical name}
  for (const [pk, map] of Object.entries(y.packages)) {
    y._phys[pk] = {}; y._alias[pk] = {};
    for (const [num, v] of Object.entries(map)) {
      const names = Array.isArray(v) ? v : [v];
      y._phys[pk][num] = names;
      for (const n of names) y._alias[pk][n] = names[0];   // shorted pins share one canonical name
    }
  }
  return y;
}

// The priority grouping a part starts in: the one the data marks `default: true`,
// else the first. A part with no `nvic.scheme.groups` has no grouping to choose and
// the index stays 0, which every reader treats as "no group data".
export function defaultNvicGroup(nvic) {
  const groups = ((nvic || {}).scheme || {}).groups || [];
  const i = groups.findIndex(g => g && g.default);
  return i >= 0 ? i : 0;
}

export function initState(m) {
  const pkgs = Object.keys(m.packages);
  const st = {
    pkg: pkgs.includes(m.mcu.default_package) ? m.mcu.default_package : pkgs[0],
    periph: {},            // pid -> { settings: {name: choice | Set}, remap: index }
    manual: {},            // pin -> 'GPIO_Output' | …
    gpio: {},              // pin -> { mode, pull, speed, label }
    sel: null,             // selected peripheral
    selPin: null,
    clock: defaultClock(m.clock),
    // What the user has asked the DMA controller and the interrupt controller to do.
    // Both are shared resources rather than pins, so they live beside `periph` rather
    // than inside it: one DMA channel serves several peripherals, and one vector can be
    // the only interrupt a peripheral has. Shapes and rules: app/engine/resources.js.
    // Generator options, as the round-3 brief puts them: in S, so they round-trip
    // through .wchproj and undo like everything else. The list of options that EXIST
    // is generatorOptions() in export.js - an option the engine cannot honour is not
    // offered, so this map only ever holds keys that one of them names.
    project: { options: {} },
    dma: { requests: [] },     // [{ id, request, channel, params: {key: value} }]
    nvic: { group: defaultNvicGroup(m.nvic), vectors: {} },  // name -> { enabled, preempt, sub }
    zoom: 1, panX: 0, panY: 0,
  };
  for (const [pid, P] of Object.entries(m.peripherals)) {
    // params are values (baud, period); settings decide pins. Separate maps on purpose.
    const params = {};
    for (const d of (Array.isArray(P.params) ? P.params : [])) if (d && d.key !== undefined) params[String(d.key)] = d.default;
    // channelParams: TIM_OCInitTypeDef is filled once per CHANNEL, so its values are
    // keyed by the channel number the data uses. Empty until somebody sets one.
    const ps = { settings: {}, remap: 0, params, channelParams: {} };
    for (const s of P.settings || []) {
      const def = s.choices.find(c => c.default);
      ps.settings[s.name] = s.type === 'checkboxes' ? new Set(def ? [def.name] : []) : (def || s.choices[0]).name;
    }
    st.periph[pid] = ps;
  }
  return st;
}

// Parse a file and resolve `mcu.inherits:` against the loaded files, without
// deriving or installing it. The New Project dialog uses this to list a derived
// part's packages and variants.
export function mcuModel(source) {
  const text = typeof source === 'string' && source in MCU_FILES ? MCU_FILES[source] : source;
  const y = typeof text === 'string' ? yamlLoad(text) : text;
  return resolveInherits(y, name => MCU_FILES[name], yamlLoad);
}

// Load an MCU: accepts a registered mcu.name, YAML text, or a parsed object.
// Pure — no DOM.
export function loadMcu(source) {
  const y = mcuModel(source);
  if (!y || !y.mcu || !y.packages || !y.pins || !y.peripherals)
    throw new Error('Not an MCU file (needs mcu, packages, pins, peripherals)');
  const src = typeof source === 'string' ? (MCU_FILES[source] || source) : yamlDump(y);
  M = deriveMcu(y);
  M._src = src;
  MCU_FILES[y.mcu.name] ||= src;
  S = initState(M);
  applyPackageRemaps();
  clearHistory();            // a different part is a different document
  return M;
}

// ---- pin helpers (current package) -------------------------------------------
export const pkgPins  = () => M._phys[S.pkg];
export const canon    = name => M._alias[S.pkg][name] || name;
export const pinExists = name => name in M._alias[S.pkg];
export const pinType  = name => (M.pins[name] || {}).type || 'io';
export const pinNum   = name => Object.keys(pkgPins()).find(n => pkgPins()[n].includes(name));
export const pinLabel = name => { const num = pinNum(name); return num === undefined ? name : pkgPins()[num].join('/'); };
export const groupOf  = name => { const num = pinNum(name); return num === undefined ? [name] : pkgPins()[num]; };
export const sigName  = (pid, sig) => `${pid}_${sig}`;
export const GPIO_SIGS = ['GPIO_Input', 'GPIO_Output', 'GPIO_Analog', 'GPIO_EXTI'];

// ---- GPIO output speed -------------------------------------------------------
// The speeds this part HAS, in the data's order: [{ name, macro }]. `gpio.speeds`
// in the MCU file is the authority; `name` is what the GPIO table shows and what a
// .wchproj stores, `macro` is the SPL enum member.
//
// **A one-entry list means the control is not shown** (data/FORMAT.md): CH32V006 and
// CH32V005 have exactly one, `GPIO_Speed_30MHz`, because `GPIOx_CFGLR.MODEy` is a
// single bit (RM v1.4 7.3.1.1) and `GPIOSpeed_TypeDef` in the EVT header
// data/sources/V006/Evt/EXAM/SRC/Peripheral/inc/ch32v00X_gpio.h lines 22-26 has one
// member. Offering Low/Medium/High there offered a choice the silicon does not have,
// and generated three macro names that do not compile.
//
// A part with no `gpio.speeds` makes no claim. Rather than invent a list, fall back to
// the legacy `codegen.speeds` map's keys, which is what such a file used to mean.
export function gpioSpeeds() {
  const list = ((M && M.gpio) || {}).speeds;
  if (Array.isArray(list) && list.length) {
    return list.filter(s => s && s.name).map(s => ({ name: String(s.name), macro: s.macro || null }));
  }
  const legacy = ((M && M.codegen) || {}).speeds;
  if (legacy && typeof legacy === 'object') {
    return Object.entries(legacy).map(([name, macro]) => ({ name, macro }));
  }
  return [];
}

// ---- GPIO mode and pull ------------------------------------------------------
// `GPIOMode_TypeDef` is per family exactly as `GPIOSpeed_TypeDef` was, so a mode macro
// from another CH32 part is the same defect class the round opened with. `gpio.modes`
// lists the five real modes and `gpio.input_modes` the three the SPL reaches through
// the PULL column - the SDK folds pull into the mode, so `Input` has no single macro
// and the list is keyed by pull name rather than by a fourth mode.
export function gpioModes() {
  const list = ((M && M.gpio) || {}).modes;
  if (!Array.isArray(list)) return [];
  return list.filter(x => x && x.name).map(x => ({ name: String(x.name), macro: x.macro || null }));
}

export function gpioInputModes() {
  const list = ((M && M.gpio) || {}).input_modes;
  if (!Array.isArray(list)) return [];
  return list.filter(x => x && x.name).map(x => ({ name: String(x.name), macro: x.macro || null }));
}

// True when the part offers a real choice. False (one speed, or none stated) means the
// UI shows fixed text and no selector - never a disabled selector.
export const gpioSpeedIsChoice = () => gpioSpeeds().length > 1;

// The speed name to USE for a pin, given whatever S.gpio[pin].speed holds. A part with
// one speed always answers with that one, so a .wchproj saved when the app still offered
// "High" opens as "30 MHz" rather than carrying a name the part cannot express.
export function gpioSpeedFor(stored) {
  const list = gpioSpeeds();
  if (!list.length) return stored || null;
  if (list.length === 1) return list[0].name;
  const hit = list.find(s => s.name === stored);
  return hit ? hit.name : list[0].name;
}

// Some peripherals sit on different pins depending on the package (bonding, not AFIO).
export function applyPackageRemaps() {
  for (const [pid, P] of Object.entries(M.peripherals))
    if (P.remap_by_package && S.pkg in P.remap_by_package) S.periph[pid].remap = P.remap_by_package[S.pkg];
}

// ---- peripheral queries ------------------------------------------------------
// Which signals this peripheral needs, given its current settings.
export function requiredSignals(pid) {
  const P = M.peripherals[pid], st = S.periph[pid], out = new Set();
  for (const s of P.settings || []) {
    const v = st.settings[s.name];
    for (const c of s.choices) {
      const on = s.type === 'checkboxes' ? v.has(c.name) : v === c.name;
      if (on) (c.signals || []).forEach(x => out.add(x));
    }
  }
  return out;
}
// The choice that means "off": the first one that needs no pins. Usually
// choices[0] ("Disable"), but not always — CH32V006's external reset pin is
// ENABLED at the factory, so its off switch is the RST_MODE=11 choice at the end.
// Anything keyed off choices[0] would be unable to release that pin.
export const neutralChoice = setting =>
  setting.choices.find(c => !c.signals || !c.signals.length) || setting.choices[0];

export function isEnabled(pid) {
  const P = M.peripherals[pid], st = S.periph[pid];
  for (const s of P.settings || []) {
    const v = st.settings[s.name];
    if (s.type === 'checkboxes' ? v.size : v !== neutralChoice(s).name) return true;
  }
  return false;
}
// Can any non-default choice of this peripheral be satisfied on this package?
export function isAvailable(pid) {
  const P = M.peripherals[pid];
  if (!P.remaps || !P.remaps.length) return true;
  for (const s of P.settings || []) for (const c of s.choices) {
    if (!c.signals) continue;
    if (P.remaps.some(r => c.signals.every(sig => r.pins[sig] && pinExists(r.pins[sig])))) return true;
  }
  return !((P.settings || []).some(s => s.choices.some(c => c.signals)));
}

// Switch package, keeping everything that still exists. Returns the pin names that
// are no longer bonded (the caller decides how loudly to say so).
export function setPackage(pkg) {
  if (!(pkg in M.packages)) throw new Error(`No such package: ${pkg}`);
  record(`Package ${pkg}`);
  S.pkg = pkg;
  applyPackageRemaps();
  return Object.keys(S.manual).filter(p => !pinExists(p));
}
