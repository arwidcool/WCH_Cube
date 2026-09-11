// =============================================================================
//  project.js — one project = one MCU + one package + every setting, saved as
//  readable YAML (`.wchproj`). Pure: serialise/apply touch only M, S and PROJECT.
//  The browser download and the file dialogs live in the app shell.
// =============================================================================
import {
  M, S, MCU_FILES, loadMcu, applyPackageRemaps, yamlDump, yamlLoad,
} from './model.js';
import { clearHistory } from './history.js';

export const PROJECT = { name: 'Untitled', variant: null, dirty: false };

export function setProject(p) { Object.assign(PROJECT, p); }

export function projectObject() {
  const periph = {};
  for (const [pid, st] of Object.entries(S.periph)) {
    const settings = {};
    for (const [k, v] of Object.entries(st.settings)) settings[k] = v instanceof Set ? [...v] : v;
    periph[pid] = { settings, remap: st.remap };
  }
  return {
    wchproj: 1,
    name: PROJECT.name,
    saved: new Date().toISOString(),
    mcu: M.mcu.name,
    variant: PROJECT.variant,
    package: S.pkg,
    peripherals: periph,
    gpio_manual: S.manual,
    gpio_settings: S.gpio,
    clock: S.clock,
  };
}

export function projectSerialize() {
  return yamlDump(projectObject(), { noRefs: true, lineWidth: 120 });
}

// Restore a project. Throws with a human sentence if the MCU file is not loaded.
export function projectApply(src) {
  const obj = typeof src === 'string' ? yamlLoad(src) : src;
  if (!obj || obj.wchproj !== 1) throw new Error('Not a WCHCube project file');
  const mcuSrc = MCU_FILES[obj.mcu];
  if (!mcuSrc) throw new Error(`This project is for "${obj.mcu}", which is not loaded. Use "Open MCU file…" to load its YAML first, then open the project again.`);

  loadMcu(mcuSrc);
  PROJECT.name = obj.name || 'Untitled';
  PROJECT.variant = obj.variant || null;
  if (obj.package in M.packages) S.pkg = obj.package;
  applyPackageRemaps();

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
  }
  S.manual = obj.gpio_manual || {};
  S.gpio = obj.gpio_settings || {};
  if (obj.clock) S.clock = Object.assign(S.clock || {}, obj.clock);
  clearHistory();            // loadMcu already cleared it; be explicit
  PROJECT.dirty = false;
  return PROJECT;
}
