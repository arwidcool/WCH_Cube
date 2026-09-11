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
    zoom: 1, panX: 0, panY: 0,
  };
  for (const [pid, P] of Object.entries(m.peripherals)) {
    const ps = { settings: {}, remap: 0 };
    for (const s of P.settings || []) {
      const def = s.choices.find(c => c.default);
      ps.settings[s.name] = s.type === 'checkboxes' ? new Set(def ? [def.name] : []) : (def || s.choices[0]).name;
    }
    st.periph[pid] = ps;
  }
  return st;
}

// Load an MCU: accepts YAML text or an already-parsed object. Pure — no DOM.
export function loadMcu(source) {
  const y = typeof source === 'string' ? yamlLoad(source) : source;
  if (!y || !y.mcu || !y.packages || !y.pins || !y.peripherals)
    throw new Error('Not an MCU file (needs mcu, packages, pins, peripherals)');
  const src = typeof source === 'string' ? source : yamlDump(y);
  M = deriveMcu(y);
  M._src = src;
  MCU_FILES[y.mcu.name] ||= src;
  S = initState(M);
  applyPackageRemaps();
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
export function isEnabled(pid) {
  const P = M.peripherals[pid], st = S.periph[pid];
  for (const s of P.settings || []) {
    const v = st.settings[s.name];
    if (s.type === 'checkboxes' ? v.size : v !== s.choices[0].name) return true;
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
  S.pkg = pkg;
  applyPackageRemaps();
  return Object.keys(S.manual).filter(p => !pinExists(p));
}
