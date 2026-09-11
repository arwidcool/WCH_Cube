// =============================================================================
//  project.js — one project = one MCU + one package + every setting, saved as
//  readable YAML (`.wchproj`). Pure: serialise/apply touch only M, S and PROJECT.
//  The browser download and the file dialogs live in the app shell.
// =============================================================================
import {
  M, S, MCU_FILES, loadMcu, applyPackageRemaps, yamlDump, yamlLoad, gpioSpeeds, gpioSpeedFor,
  defaultNvicGroup,
} from './model.js';
import {
  addDmaRequest, setDmaParam, setDmaRequest, dmaLegalChannels,
  setNvicVector, setNvicGroup, nvicGroups,
} from './resources.js';
import { generatorOptions, setGeneratorOption } from './export.js';
import { applyParams, paramsObject } from './params.js';
import { clearHistory } from './history.js';

export const PROJECT = { name: 'Untitled', variant: null, dirty: false };

// The .wchproj format number. Bump it only when an OLD file would be read wrongly
// by new code, and add the migration in MIGRATIONS at the same time. Adding a key
// that old files simply lack is not a bump: applying it is already tolerant.
export const PROJECT_FORMAT = 1;

// n -> function that turns a format-n object into a format-(n+1) object.
// Each one must be pure and must not need M or S: a project is migrated before
// its MCU is even loaded.
export const MIGRATIONS = {
  // 1: obj => ({ ...obj, wchproj: 2, ... }),
};

/**
 * Bring a project object up to PROJECT_FORMAT, or explain why it cannot be.
 * A file from the future is refused by name rather than half-applied.
 */
export function migrateProject(obj) {
  if (!obj || typeof obj !== 'object' || obj.wchproj === undefined) {
    throw new Error('Not a WCHCube project file (no `wchproj:` version key).');
  }
  let v = Number(obj.wchproj);
  if (!Number.isInteger(v) || v < 1) throw new Error(`Not a WCHCube project file (wchproj: ${obj.wchproj}).`);
  if (v > PROJECT_FORMAT) {
    throw new Error(`This project was saved in format ${v} by a newer WCHCube; this build reads format ${PROJECT_FORMAT}. Update WCHCube, or re-save the project from the version that wrote it.`);
  }
  let out = obj;
  while (v < PROJECT_FORMAT) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from project format ${v} to ${v + 1}.`);
    out = step(out);
    v = Number(out.wchproj);
  }
  return out;
}

export function setProject(p) { Object.assign(PROJECT, p); }

export function projectObject() {
  const periph = {};
  for (const [pid, st] of Object.entries(S.periph)) {
    const settings = {};
    for (const [k, v] of Object.entries(st.settings)) settings[k] = v instanceof Set ? [...v] : v;
    periph[pid] = { settings, remap: st.remap };
    const params = paramsObject(pid);
    if (Object.keys(params).length) periph[pid].params = params;
  }
  return {
    wchproj: PROJECT_FORMAT,
    name: PROJECT.name,
    saved: new Date().toISOString(),
    mcu: M.mcu.name,
    variant: PROJECT.variant,
    package: S.pkg,
    peripherals: periph,
    gpio_manual: S.manual,
    gpio_settings: S.gpio,
    clock: S.clock,
    ...dmaObject(),
    ...nvicObject(),
    ...generatorObject(),
  };
}

// Only options the user actually changed, so a project written by a build with fewer
// options still opens and a diff shows only real decisions.
function generatorObject() {
  const opts = ((S.project || {}).options) || {};
  const out = {};
  for (const d of generatorOptions()) {
    if (opts[d.key] !== undefined && opts[d.key] !== d.default) out[d.key] = opts[d.key];
  }
  return Object.keys(out).length ? { generator: out } : {};
}

// Both blocks are omitted when the user has not touched them, so a project saved
// before either existed round-trips byte-identically and a diff of two .wchproj
// files shows only what somebody actually changed.
function dmaObject() {
  const list = S.dma && S.dma.requests;
  if (!list || !list.length) return {};
  return { dma: list.map(r => ({ request: r.request, channel: Number(r.channel), params: { ...r.params } })) };
}

function nvicObject() {
  const n = S.nvic || {};
  const vectors = {};
  for (const [name, st] of Object.entries(n.vectors || {})) {
    if (!st || (!st.enabled && st.preempt === undefined && st.sub === undefined)) continue;
    vectors[name] = { enabled: !!st.enabled, preempt: st.preempt, sub: st.sub };
  }
  const groupChanged = n.group !== undefined && n.group !== defaultNvicGroup(M.nvic);
  if (!Object.keys(vectors).length && !groupChanged) return {};
  return { nvic: { group: n.group || 0, vectors } };
}

export function projectSerialize() {
  return yamlDump(projectObject(), { noRefs: true, lineWidth: 120 });
}

// A .wchproj saved before the one-speed fix stores "Low" / "Medium" / "High" per pin -
// names this silicon has never had (round-3 P0b). Opening it must not carry them into S,
// where the GPIO table would show them and the generator would have to translate them
// forever. Rewrite them to a speed the part actually offers and say so, the same way an
// out-of-range parameter is reported rather than silently applied.
function normaliseGpioSpeeds() {
  const speeds = gpioSpeeds();
  if (!speeds.length) return [];
  const out = [];
  for (const [pin, g] of Object.entries(S.gpio)) {
    if (!g || g.speed === undefined || g.speed === '') continue;
    const fixed = gpioSpeedFor(g.speed);
    if (fixed === g.speed) continue;
    out.push(`${pin}: output speed "${g.speed}" is not one this part has; using "${fixed}".`);
    g.speed = fixed;
  }
  return out;
}

/**
 * DMA requests from a .wchproj. Everything goes through the same setters the UI uses,
 * so a saved file can never put state into S that the engine would reject live: a
 * request the part no longer has, a channel it is not wired to, a parameter value out
 * of range. Each of those is dropped and reported, never applied - the project still
 * opens, minus the line that stopped being true.
 */
function applyDma(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const row of list) {
    if (!row || row.request === undefined) continue;
    const name = String(row.request);
    try {
      // The channel is only passed on when the part really offers a choice; otherwise
      // the hardware map decides and a stale one in the file is simply ignored.
      const legal = dmaLegalChannels(name);
      addDmaRequest(name, legal.length > 1 && row.channel !== undefined ? row.channel : undefined);
    } catch (e) { out.push(`dma ${name}: ${e.message}`); continue; }
    if (row.channel !== undefined && dmaLegalChannels(name).length > 1) {
      try { setDmaRequest(name, { channel: row.channel }); } catch (e) { out.push(`dma ${name}: ${e.message}`); }
    }
    for (const [k, v] of Object.entries(row.params || {})) {
      try { setDmaParam(name, k, v); } catch (e) { out.push(`dma ${name}: ${e.message}`); }
    }
  }
  return out;
}

/**
 * Generator options. An option this build does not have is dropped and reported -
 * a project saved by a build that could split files per peripheral must still open
 * on one that cannot, rather than quietly pretending the option is in force.
 */
function applyGenerator(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    try { setGeneratorOption(k, v); }
    catch (e) { out.push(`generator: ${e.message}`); }
  }
  return out;
}

/** The same, for interrupt vectors and the priority grouping. */
function applyNvic(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  if (obj.group !== undefined && nvicGroups().length) {
    try { setNvicGroup(obj.group); } catch (e) { out.push(`nvic: ${e.message}`); }
  }
  for (const [name, st] of Object.entries(obj.vectors || {})) {
    if (!st || typeof st !== 'object') continue;
    const patch = {};
    for (const k of ['enabled', 'preempt', 'sub']) if (st[k] !== undefined) patch[k] = st[k];
    if (!Object.keys(patch).length) continue;
    try { setNvicVector(name, patch); }
    catch (e) {
      out.push(`nvic ${name}: ${e.message}`);
      // a priority that no longer fits is not a reason to lose the enable
      if (patch.enabled !== undefined) {
        try { setNvicVector(name, { enabled: patch.enabled }); } catch (e2) { /* already reported */ }
      }
    }
  }
  return out;
}

// Restore a project. Throws with a human sentence if the MCU file is not loaded.
export function projectApply(src) {
  const obj = migrateProject(typeof src === 'string' ? yamlLoad(src) : src);
  const mcuSrc = MCU_FILES[obj.mcu];
  if (!mcuSrc) throw new Error(`This project is for "${obj.mcu}", which is not loaded. Use "Open MCU file…" to load its YAML first, then open the project again.`);

  loadMcu(mcuSrc);
  PROJECT.name = obj.name || 'Untitled';
  PROJECT.variant = obj.variant || null;
  if (obj.package in M.packages) S.pkg = obj.package;
  applyPackageRemaps();

  const dropped = [];
  for (const [pid, st] of Object.entries(obj.peripherals || {})) {
    if (!S.periph[pid]) continue;
    const P = M.peripherals[pid];
    for (const s of P.settings || []) {
      const v = (st.settings || {})[s.name];
      if (v === undefined) continue;
      if (s.type === 'checkboxes') S.periph[pid].settings[s.name] = new Set(Array.isArray(v) ? v : []);
      else if (s.choices.some(c => c.name === v)) S.periph[pid].settings[s.name] = v;
    }
    if (Number.isInteger(st.remap) && P.remaps && st.remap < P.remaps.length) S.periph[pid].remap = st.remap;
    dropped.push(...applyParams(pid, st.params));
  }
  S.manual = obj.gpio_manual || {};
  S.gpio = obj.gpio_settings || {};
  dropped.push(...normaliseGpioSpeeds());
  dropped.push(...applyDma(obj.dma));
  dropped.push(...applyNvic(obj.nvic));
  dropped.push(...applyGenerator(obj.generator));
  if (obj.clock) S.clock = Object.assign(S.clock || {}, obj.clock);
  clearHistory();            // loadMcu already cleared it; be explicit
  PROJECT.dirty = false;
  // A project saved against an older MCU file may name parameters that no longer
  // exist or values now out of range. Those are dropped, never applied, and listed
  // here so the UI can say so instead of opening a file that silently lost settings.
  PROJECT.warnings = dropped;
  return PROJECT;
}
