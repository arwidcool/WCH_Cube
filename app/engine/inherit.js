// =============================================================================
//  inherit.js — `mcu.inherits:` resolution. A derived part (CH32V005 = CH32V006
//  without TouchKey and TIM3) names its parent and lists what it drops, instead
//  of copying 700 lines that then rot apart.
//
//  Rules (agreed with AGENT-1 on the board, 2026-09-11):
//    mcu.inherits: CH32V006          parent's mcu.name; chains allowed, loops rejected
//    mcu.remove: [peripherals.TKEY]  dotted paths into the PARENT, applied BEFORE the
//            merge; a path that matches nothing in the parent is an error
//    maps    merge key by key, the child wins
//    lists   replace wholesale — NEVER concatenate: a remaps[] index IS the
//            AFIO_PCFR1 field value, so appending would silently mis-map pins
//    scalars replace
//    mcu.variants replaces rather than merges — a derived part never shares
//            part numbers with its parent
//  Resolution runs before validation, so a child may omit packages/pins/
//  peripherals entirely; nothing downstream ever sees `inherits`.
//
//  `remove` is applied to the PARENT, not to the merged document (round-3 C4).
//  Removing after the merge deleted the child's own redefinition of the same
//  path: CH32V005 removed `dma.request_defaults.TIM3_CH3` and redefined
//  `dma.requests`, and shipped for a whole round with no DMA request map at all,
//  which silently killed channel-clash detection on that part. Applied to the
//  parent, "remove" means what it says — drop what I inherit — and a child that
//  removes and redefines keeps its own version.
// =============================================================================

import { deepClone } from './util.js';

const isMap = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(base, over) {
  if (!isMap(base) || !isMap(over)) return deepClone(over);
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(over)])) {
    if (!(k in over)) out[k] = deepClone(base[k]);
    else if (!(k in base)) out[k] = deepClone(over[k]);
    else out[k] = deepMerge(base[k], over[k]);
  }
  return out;
}

export function removePath(obj, path) {
  const parts = String(path).split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) {
    if (!isMap(o) && !Array.isArray(o)) return false;
    o = o[p];
  }
  const last = parts[parts.length - 1];
  if ((isMap(o) || Array.isArray(o)) && last in o) { delete o[last]; return true; }
  return false;
}

// `lookup(name)` returns the parent's YAML text, or undefined if it is not loaded.
// `parse` turns that text into an object.
export function resolveInherits(y, lookup, parse, seen = []) {
  const parent = y && y.mcu && y.mcu.inherits;
  if (!parent) return y;

  const me = (y.mcu && y.mcu.name) || '(unnamed)';
  if (seen.includes(parent)) throw new Error(`inherits: loop — ${[...seen, me, parent].join(' -> ')}`);
  const src = lookup(parent);
  if (!src) throw new Error(`"${me}" inherits from "${parent}", which is not loaded. Load ${parent}'s YAML first, then this file.`);

  const base = resolveInherits(parse(src), lookup, parse, [...seen, me]);

  // BEFORE the merge, so a path the child removes AND redefines keeps the child's
  // version. Matching is against the parent alone: removing something the parent
  // does not have is a stale removal, and stale removals are how a parent rename
  // goes unnoticed.
  for (const path of y.mcu.remove || []) {
    if (!removePath(base, path)) throw new Error(`"${me}": mcu.remove path "${path}" matched nothing in ${parent}`);
  }

  const merged = deepMerge(base, y);
  if (y.mcu.variants) merged.mcu.variants = deepClone(y.mcu.variants);   // never inherit part numbers
  merged.mcu.inherited_from = parent;      // metadata; inert everywhere else
  return merged;
}
