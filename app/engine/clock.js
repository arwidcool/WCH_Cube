// =============================================================================
//  clock.js — clock tree maths. No DOM, no rendering: renderClock() (UI) draws
//  whatever clockCalc() returns, so a new MCU's tree needs no UI change.
//
//  Two things a part may have more than one of, and both are data:
//    * PLLs.  `clock.pll` is the SYS PLL and keeps that spelling; `clock.plls`
//      is a map of the others, each with an `output:` name that a tap, another
//      PLL or `sysclk.sources` can cite.
//    * a tap's source.  `source:` is one name, or a LIST — and a list is a mux
//      the user picks from, held in `S.clock.preSrc[<tap>]`.
//  Neither names a part. `data/FORMAT.md` has the block; the rule that governs
//  both is that a computed number which is WRONG is worse than a missing one,
//  so every frequency here comes from the file or is not printed at all.
// =============================================================================
import { M, S } from './model.js';
import { paramValue } from './params.js';

// ---------------------------------------------------------------------------
//  PLLs
// ---------------------------------------------------------------------------

/**
 * Every PLL the file declares, the SYS PLL first.
 *
 * `clock.pll` stays the SYS PLL's spelling because five parts have exactly one
 * PLL and a `plls:` map would have rewritten all five for nothing. A file that
 * writes the SYS PLL as `plls.PLL` instead is read identically, so neither
 * spelling is the special case and nothing downstream has to ask which was used.
 *
 * Each entry: `{ id, def, sys, label, output }`. `output` is the name other taps
 * cite — `PLLCLK` for the SYS PLL, `<id>_CLK` for a named one that does not say.
 */
export function pllList(c) {
  if (!c) return [];
  const named = c.plls || {};
  const sysDef = c.pll || named.PLL || null;
  const entry = (id, def, sys) => ({
    id, def, sys,
    label: def.label || (sys ? 'PLL' : id),
    output: def.output || (sys ? 'PLLCLK' : id + '_CLK'),
  });
  const out = [];
  if (sysDef) out.push(entry('PLL', sysDef, true));
  for (const [id, def] of Object.entries(named)) {
    if (id === 'PLL' || !def) continue;
    out.push(entry(id, def, false));
  }
  return out;
}

// The node id the UI and `feeding` use for a PLL. The SYS PLL is `PLL` — it was
// that before `plls:` existed and an older bundle's key must keep meaning the
// same thing — and every other one is `pll:<id>`, which cannot collide with an
// oscillator, a prescaler (`pre:`) or a derived tap (`drv:`).
export const pllNode = p => (p.sys ? 'PLL' : 'pll:' + p.id);

/**
 * One PLL's live state. The SYS PLL keeps the flat `pllIn` / `pllMul` keys every
 * project file and the RCC codegen already write; a named PLL lives in
 * `S.clock.plls[<id>]` as `{ in, mul, div }`.
 */
export function pllState(p, k) {
  if (!k) return { in: 0 };
  const held = (k.plls || {})[p.id] || {};
  if (!p.sys) return held;
  return { in: k.pllIn || 0, mul: k.pllMul, div: held.div };
}

function pllDefaultState(p) {
  const st = { in: 0 };
  const muls = p.def.multipliers || [], divs = p.def.dividers || [];
  if (muls.length) st.mul = muls[0];
  if (divs.length) st.div = divs[0];
  return st;
}

// ---------------------------------------------------------------------------
//  Taps (prescalers)
// ---------------------------------------------------------------------------

/**
 * One entry of a tap's `source:` LIST, normalised. A plain string is a bare clock
 * signal with no built-in divider (`div: 1`); an object `{ name, source, div }` — the
 * SAME shape a PLL's own `inputs:` entries already use — names a MUX LEG that divides
 * its source before the signal ever reaches this tap. CH32H417's LTDC choice 01,
 * "SERDES_PLL clock divided by 2" (`CH32H417RM.md:4085-4089`), is not a bare source:
 * the mux itself carries a divider on that one leg, so the entry has to be able to
 * say so. `name` is what the UI shows and what `S.clock.preSrc` stores — for a plain
 * string it is the source name itself, so nothing here changes for the six muxes that
 * do not need this.
 */
const normSrcEntry = e => (typeof e === 'string' ? { name: e, source: e, div: 1 }
  : { name: e.name, source: e.source, div: e.div || 1 });

/** The sources a tap offers when its `source:` is a LIST, as display/stored names,
 * else null. Every existing caller that used this as "the list of source names" is
 * unaffected: a plain-string entry's name IS the source name. */
export const tapSources = v => (v && Array.isArray(v.source)
  ? v.source.filter(Boolean).map(e => normSrcEntry(e).name) : null);

/** The full `{ name, source, div }` entries of a tap's source LIST, else null. */
export const tapSourceEntries = v => (v && Array.isArray(v.source)
  ? v.source.filter(Boolean).map(normSrcEntry) : null);

/**
 * The entry a tap is taking RIGHT NOW, resolved to `{ name, source, div }`. A chosen
 * NAME the file no longer offers falls back to the first entry — the same rule the
 * GPIO speed follows, and for the same reason: state that names something the part
 * does not have must never reach a frequency or the generated C.
 */
export function tapSourceEntry(v, name, k) {
  const list = tapSourceEntries(v);
  if (!list) return v.source ? { name: v.source, source: v.source, div: 1 } : null;
  const chosen = ((k || {}).preSrc || {})[name];
  return list.find(e => e.name === chosen) || list[0];
}

/**
 * The underlying clock SIGNAL a tap is taking right now — never the mux leg's own
 * divider, only what feeds it. This is what the tree graph and every frequency-base
 * lookup already used before a leg could carry a divider, so every caller of this
 * function is unchanged; `tapMuxDiv()` below is the new half.
 */
export function tapSource(v, name, k) {
  const e = tapSourceEntry(v, name, k);
  return e ? e.source : null;
}

/** The divider the CURRENTLY chosen mux leg itself carries, independent of the tap's
 * own `options:`/`k.pre`. 1 for a bare source or a plain-string entry, so a tap that
 * does not need this computes exactly as it did before this existed. */
export function tapMuxDiv(v, name, k) {
  const e = tapSourceEntry(v, name, k);
  return (e && e.div) || 1;
}

// Initial clock state for an MCU's `clock:` block (null when the file has none).
//
// `preSrc` and `plls` are written only when the part HAS a mux or a second PLL,
// so a project saved for one of the five single-PLL parts round-trips byte for
// byte against a build that predates this schema.
export function defaultClock(c) {
  if (!c) return null;
  const pre = {}, preSrc = {};
  for (const [name, v] of Object.entries(c.prescalers || {})) {
    const opts = v.options || [];
    pre[name] = opts.some(o => String(o) === String(v.default)) ? v.default : opts[0];
    const list = tapSources(v);
    if (list) preSrc[name] = list.includes(v.default_source) ? v.default_source : list[0];
  }
  const plls = {};
  for (const p of pllList(c)) if (!p.sys) plls[p.id] = pllDefaultState(p);
  const sysPll = pllList(c).find(p => p.sys);
  const k = {
    hse: c.sources.HSE ? c.sources.HSE.mhz : 8,
    pllIn: 0,
    pllMul: sysPll && (sysPll.def.multipliers || []).length ? sysPll.def.multipliers[0] : 1,
    sys: c.sysclk.sources[0],
    pre,
  };
  if (Object.keys(preSrc).length) k.preSrc = preSrc;
  if (Object.keys(plls).length) k.plls = plls;
  return k;
}

// The root prescaler (the one with no `source:`) — AHB on F1-style parts, HB on V00x.
export const firstPre = c => Object.keys(c.prescalers || {}).find(n => !(c.prescalers[n].source));

/**
 * Which node ids carry a clock right now. Ids match what the UI draws:
 * HSI/HSE/LSI/LSE, PLL, `pll:<name>`, SYSCLK, `pre:<name>`, `drv:<name>`. "Not
 * feeding" is a DISPLAY fact (dashed and dimmed) — it never means the user may
 * not pick it.
 */
function feedingSet(c, k) {
  const on = new Set(['SYSCLK']);
  const fp = firstPre(c);
  const plls = pllList(c);
  const byOutput = {};
  for (const p of plls) byOutput[p.output] = p;

  // 1. the PLLs something asks for. A PLL a tap hangs off keeps running even when
  //    SYSCLK comes from somewhere else (USB on the dummy part, USBFS on H417).
  const want = new Set();
  if (byOutput[k.sys]) want.add(byOutput[k.sys].id); else on.add(k.sys);
  for (const [name, v] of Object.entries(c.prescalers || {})) {
    const s = tapSource(v, name, k);
    if (s && byOutput[s]) want.add(byOutput[s].id);
  }
  // …and whatever feeds THEM, which may be another PLL (H417's USBHS_PLL can take
  // the SYS PLL's output divided down). Bounded by the number of PLLs, so a file
  // that wires two of them in a circle stops instead of spinning.
  for (let pass = 0; pass <= plls.length; pass++) {
    for (const p of plls) {
      if (!want.has(p.id)) continue;
      const inp = (p.def.inputs || [])[pllState(p, k).in || 0];
      if (!inp) continue;
      if (byOutput[inp.source]) want.add(byOutput[inp.source].id); else on.add(inp.source);
    }
  }
  for (const p of plls) if (want.has(p.id)) on.add(pllNode(p));

  // 2. the taps, in dependency order rather than file order: a mux may point at a
  //    prescaler declared later in the file, and "unresolved" must not read as "off".
  if (fp) on.add('pre:' + fp);
  const baseNode = (name, v) => {
    const s = tapSource(v, name, k);
    if (!s || s === fp) return fp ? 'pre:' + fp : 'SYSCLK';
    if (byOutput[s]) return pllNode(byOutput[s]);
    if (s === 'SYSCLK') return 'SYSCLK';
    if (s !== name && (c.prescalers || {})[s]) return 'pre:' + s;
    if ((c.sources || {})[s]) return s;
    return fp ? 'pre:' + fp : 'SYSCLK';
  };
  const left = Object.entries(c.prescalers || {}).filter(([n]) => n !== fp);
  for (let pass = 0; pass <= left.length; pass++) {
    for (const [name, v] of left) if (on.has(baseNode(name, v))) on.add('pre:' + name);
  }
  for (const d of c.derived || []) if (!fp || on.has('pre:' + fp)) on.add('drv:' + d.name);
  return on;
}

/**
 * Every choice the DATA allows, for every mux and prescaler — never filtered by
 * the current state. The UI binds its <select>s straight to this, so a source is
 * missing from the list only when the MCU file says the part cannot do it.
 */
export function clockSelectable(m = M) {
  const c = m.clock;
  if (!c) return { sys: [], pllIn: [], pllMul: [], pre: {}, preSrc: {}, plls: {} };
  const inputsOf = def => (def.inputs || []).map((i, index) =>
    ({ index, name: i.name, source: i.source, div: i.div || 1 }));
  const list = pllList(c), sysPll = list.find(p => p.sys);
  const plls = {};
  for (const p of list) {
    plls[p.id] = {
      id: p.id, label: p.label, output: p.output, sys: p.sys,
      inputs: inputsOf(p.def),
      multipliers: [...(p.def.multipliers || [])],
      dividers: [...(p.def.dividers || [])],
      fixed: p.def.output_mhz !== undefined,
    };
  }
  const pre = Object.entries(c.prescalers || {});
  return {
    sys: [...c.sysclk.sources],
    pllIn: sysPll ? inputsOf(sysPll.def) : [],
    pllMul: sysPll ? [...(sysPll.def.multipliers || [])] : [],
    // `options:` is not required on a tap whose ONLY divider lives in its mux legs
    // (LTDC's choice 01, "SERDES_PLL clock divided by 2" — RM 4085-4089 — needs no
    // separate divider select at all). `[...v.options]` on an absent `options:` used
    // to throw; a tap that never needed this stays byte-for-byte, since every one
    // already declares `options:`.
    pre: Object.fromEntries(pre.map(([n, v]) => [n, [...(v.options || [])]])),
    preSrc: Object.fromEntries(pre.filter(([, v]) => tapSources(v)).map(([n, v]) => [n, tapSources(v)])),
    // The FULL entries behind `preSrc`'s plain names, `{ name, source, div }` each —
    // the UI's tree needs `.source` to draw the right edge for a leg whose display
    // name ("SERDES_PLL /2") is not itself a node the tree otherwise knows.
    preSrcEntries: Object.fromEntries(pre.filter(([, v]) => tapSources(v)).map(([n, v]) => [n, tapSourceEntries(v)])),
    plls,
  };
}

// Does HSE reach SYSCLK, directly or through the PLL chain? The RCC coupling
// hangs off this: CubeMX switches the crystal on the moment the mux points at it.
// The chain is WALKED rather than the one `clock.pll` hop it used to be, because a
// part may put a second PLL between the crystal and SYSCLK.
export function hseFeedsSysclk(m = M, s = S) {
  const c = m.clock, k = s.clock;
  if (!c || !k) return false;
  if (k.sys === 'HSE') return true;
  const list = pllList(c), byOutput = {};
  for (const p of list) byOutput[p.output] = p;
  let p = byOutput[k.sys];
  for (let guard = 0; p && guard <= list.length; guard++) {
    const inp = (p.def.inputs || [])[pllState(p, k).in || 0];
    if (!inp) return false;
    if (inp.source === 'HSE') return true;
    p = byOutput[inp.source];
  }
  return false;
}

/**
 * Every frequency in MHz. Back-compatible keys (SYSCLK, HCLK, PLLCLK, pllIn,
 * every prescaler output, every derived tap, `over`) plus the round-2 shape the
 * clock UI binds to: `sources`, `pll`, `plls`, `sysclk`, `hclk`, `feeding`,
 * `under`, `selectable`.
 *
 * NOTE for MCU files: prescaler names, derived-tap names and PLL OUTPUT names all
 * share this object with the keys above, so none of them may be called `sources`,
 * `pll`, `plls`, `feeding`, `over`, `under`, `selectable`, `sysclk` or `hclk`.
 */
export function clockCalc(m = M, s = S) {
  const c = m.clock, k = s.clock, out = { over: [], under: [] };
  // Every oscillator the file declares, not the four CH32V006 happens to have: a
  // part may name its input clock anything (H417 feeds USBHS_PLL from ETHCLK_20M),
  // and a source with no entry here is a source no tap could ever resolve.
  const src = {};
  for (const [name, d] of Object.entries(c.sources || {})) {
    src[name] = d.khz !== undefined ? d.khz / 1000 : (name === 'HSE' ? k.hse : d.mhz);
  }

  // ---- the PLLs, resolved in dependency order --------------------------------
  // A PLL may take another PLL's output, so file order is not evaluation order.
  const plls = pllList(c);
  out.plls = {};
  const record = (p, inMhz, mhz, st, inp) => {
    out[p.output] = mhz;
    out.plls[p.id] = {
      id: p.id, label: p.label, output: p.output, sys: p.sys,
      in: inMhz, out: mhz,
      mul: p.def.output_mhz !== undefined ? null : (st.mul !== undefined ? Number(st.mul) : 1),
      div: st.div !== undefined ? Number(st.div) : 1,
      index: st.in || 0, source: inp ? inp.source : null, name: inp ? inp.name : null,
      fixed: p.def.output_mhz !== undefined,
    };
  };
  const pendingPll = [...plls];
  for (let pass = 0; pass <= plls.length && pendingPll.length; pass++) {
    for (let i = pendingPll.length - 1; i >= 0; i--) {
      const q = pendingPll[i], st = pllState(q, k);
      const inp = (q.def.inputs || [])[st.in || 0] || null;
      const from = inp ? (src[inp.source] !== undefined ? src[inp.source] : out[inp.source]) : 0;
      if (from === undefined) continue;            // its input is a PLL not resolved yet
      const inMhz = inp ? from / (inp.div || 1) : 0;
      const mhz = q.def.output_mhz !== undefined ? Number(q.def.output_mhz)
        : inMhz * (st.mul !== undefined ? Number(st.mul) : 1) / (st.div !== undefined ? Number(st.div) : 1);
      record(q, inMhz, mhz, st, inp);
      pendingPll.splice(i, 1);
    }
  }
  // A PLL whose input never resolves (a file that wires two of them in a circle)
  // prints nothing rather than a number nobody can trace.
  for (const q of pendingPll) record(q, 0, 0, pllState(q, k), null);

  const sysPll = out.plls.PLL;
  out.pllIn = sysPll ? sysPll.in : 0;
  out.PLLCLK = sysPll ? sysPll.out : 0;
  for (const q of plls) {
    const rp = out.plls[q.id], d = q.def;
    if (d.max_mhz && rp.out > d.max_mhz) out.over.push(q.id);
    if (d.min_mhz && rp.out < d.min_mhz) { out.over.push(q.id); out.under.push(q.id); }
    if (d.target_mhz && Math.abs(rp.out - d.target_mhz) > 0.01) {
      out.over.push(q.id);
      if (rp.out < d.target_mhz) out.under.push(q.id);
    }
  }

  out.SYSCLK = src[k.sys] !== undefined ? src[k.sys] : (out[k.sys] !== undefined ? out[k.sys] : 0);
  if (out.SYSCLK > c.sysclk.max_mhz) out.over.push('SYSCLK');

  // ---- the taps, also in dependency order ------------------------------------
  const p = c.prescalers || {}, fp = firstPre(c);
  const divOf = name => {
    const held = k.pre ? k.pre[name] : undefined;
    return held !== undefined ? held : ((p[name].options || [1])[0]);
  };
  out.HCLK = out.SYSCLK / (fp ? divOf(fp) : 1);
  if (fp && p[fp].max_mhz && out.HCLK > p[fp].max_mhz) out.over.push(fp);

  const baseOf = (name, v) => {
    const s = tapSource(v, name, k);
    let base;
    if (!s || s === fp) base = out.HCLK;
    else if (s === 'SYSCLK') base = out.SYSCLK;
    else base = src[s] !== undefined ? src[s] : out[s];  // PLLCLK, a named PLL output, another tap
    if (base === undefined) return undefined;
    // The MUX LEG's own divider, if the chosen entry carries one — applied here,
    // before this tap's own `options:`/`k.pre`, because RM 4085-4089's "SERDES_PLL
    // clock divided by 2" is a property of picking THAT leg, not a separate dial.
    const md = tapMuxDiv(v, name, k);
    return md !== 1 ? base / md : base;
  };
  const taps = Object.entries(p).filter(([n]) => n !== fp);
  const unresolved = [...taps];
  for (let pass = 0; pass <= taps.length && unresolved.length; pass++) {
    for (let i = unresolved.length - 1; i >= 0; i--) {
      const [name, v] = unresolved[i];
      const base = baseOf(name, v);
      if (base === undefined) continue;
      out[name] = base / divOf(name);
      unresolved.splice(i, 1);
    }
  }
  // A tap whose source names nothing this file declares hangs off HCLK, which is
  // what it did before muxes existed; the validator is where that becomes an error.
  for (const [name] of unresolved) out[name] = out.HCLK / divOf(name);

  // The limit checks stay in FILE order so the `over` list reads the way the tree
  // is drawn, whatever order the frequencies had to be computed in.
  for (const [name, v] of taps) {
    if (v.max_mhz && out[name] > v.max_mhz) out.over.push(name);
    if (v.min_mhz && out[name] < v.min_mhz) { out.over.push(name); out.under.push(name); }
    if (v.target_mhz && Math.abs(out[name] - v.target_mhz) > 0.01) {
      out.over.push(name);
      if (out[name] < v.target_mhz) out.under.push(name);
    }
  }
  for (const d of c.derived || []) {
    const base = d.source && d.source !== fp
      ? (src[d.source] !== undefined ? src[d.source] : out[d.source])
      : out.HCLK;
    out[d.name] = (base === undefined ? out.HCLK : base) / d.div;
  }
  if (c.sources.HSE && (k.hse < c.sources.HSE.min_mhz || k.hse > c.sources.HSE.max_mhz)) {
    out.over.push('HSE');
    if (k.hse < c.sources.HSE.min_mhz) out.under.push('HSE');
  }

  // ---- the shape the clock UI binds to -------------------------------------
  // `over` stays the full "out of specification" list (too fast, too slow, off
  // target) so every red box keeps its meaning; `under` is the subset that is
  // too SLOW, for a UI that wants to word the two cases differently.
  const on = feedingSet(c, k);
  out.feeding = { SYSCLK: true };
  for (const id of Object.keys(c.sources)) out.feeding[id] = on.has(id);
  for (const q of plls) out.feeding[pllNode(q)] = on.has(pllNode(q));
  for (const name of Object.keys(p)) out.feeding['pre:' + name] = on.has('pre:' + name);
  for (const d of c.derived || []) out.feeding['drv:' + d.name] = on.has('drv:' + d.name);

  out.sources = {};
  for (const [name, d] of Object.entries(c.sources)) {
    out.sources[name] = {
      mhz: src[name],
      feeding: on.has(name),
      fixed: !!d.fixed,
      editable: !d.fixed && d.khz === undefined,
      min_mhz: d.min_mhz, max_mhz: d.max_mhz,
      over: out.over.includes(name),
    };
  }
  // `pll` is the SYS PLL alone and keeps every key it had; `plls` is the map.
  out.pll = sysPll ? {
    in: sysPll.in, out: sysPll.out, mul: sysPll.mul === null ? 1 : sysPll.mul,
    index: sysPll.index, source: sysPll.source, name: sysPll.name,
    feeding: on.has('PLL'),
  } : null;
  for (const q of plls) out.plls[q.id].feeding = on.has(pllNode(q));
  out.sysclk = out.SYSCLK;
  out.hclk = out.HCLK;
  out.selectable = clockSelectable(m);
  return out;
}

// ---------------------------------------------------------------------------
//  Derived numbers a peripheral's parameters imply. These belong with the clock
//  maths because they all start from "which clock actually feeds this block".
// ---------------------------------------------------------------------------

/** MHz on the bus that feeds `pid`, from the MCU file's clock.buses. */
export function periphClockMhz(pid, m = M, s = S) {
  if (!m.clock) return null;
  const r = clockCalc(m, s);
  const buses = m.clock.buses || {};
  for (const [bus, list] of Object.entries(buses)) {
    if (!Array.isArray(list) || !list.includes(pid)) continue;
    if (r[bus] !== undefined) return r[bus];
    if (bus === firstPre(m.clock)) return r.HCLK;
    return r.HCLK;
  }
  return r.HCLK !== undefined ? r.HCLK : r.SYSCLK;
}

/**
 * What the USART will actually do with the requested baud rate.
 *
 * Oversampling by 16 puts USARTDIV = fCK / (16 * baud) in BRR as a 12-bit mantissa
 * and a 4-bit sixteenth, so the register value is simply round(fCK / baud) and the
 * achievable rate is fCK / that. Returns null when the part has no such parameter.
 */
export function usartBaud(pid, m = M, s = S) {
  const want = paramValue(pid, 'baud');
  if (want === undefined || want === null) return null;
  const mhz = periphClockMhz(pid, m, s);
  if (!mhz) return null;
  const fck = mhz * 1e6;
  const requested = Number(want);
  const brr = Math.round(fck / requested);
  if (!Number.isFinite(brr) || brr < 1) {
    return { requested, clockMhz: mhz, brr: null, actual: null, errorPct: null,
             note: `${requested} Bd is faster than this clock can divide down to` };
  }
  const actual = fck / brr;
  const errorPct = ((actual - requested) / requested) * 100;
  return {
    requested, clockMhz: mhz, brr,
    actual: Math.round(actual * 100) / 100,
    errorPct: Math.round(errorPct * 1000) / 1000,
    mantissa: brr >> 4, fraction: brr & 0xf,
    note: Math.abs(errorPct) > 2.5
      ? `${errorPct.toFixed(2)}% error — most receivers need better than 2.5%`
      : '',
  };
}

/** Update frequency a timer's prescaler and period imply, in Hz. */
export function timerFrequency(pid, m = M, s = S) {
  const psc = paramValue(pid, 'prescaler');
  const arr = paramValue(pid, 'period');
  if (psc === undefined || arr === undefined) return null;
  const mhz = periphClockMhz(pid, m, s);
  if (!mhz) return null;
  const hz = (mhz * 1e6) / ((Number(psc) + 1) * (Number(arr) + 1));
  return { clockMhz: mhz, prescaler: Number(psc), period: Number(arr),
           hz: Math.round(hz * 1000) / 1000, periodUs: Math.round((1e6 / hz) * 1000) / 1000 };
}

/**
 * How long one ADC conversion takes, from the sampling-time parameter and the ADC
 * clock. Total = sampling cycles + the SAR cycles the resolution costs (11 for a
 * 12-bit successive-approximation ADC, which is what this family has).
 *
 * The sampling parameter is an enum whose names read like "11.5 cycles", so the
 * number is parsed out of the name rather than guessed from the index.
 */
export function adcConversionUs(pid, sarCycles = 11, m = M, s = S) {
  const raw = paramValue(pid, 'sample');
  if (raw === undefined || raw === null) return null;
  const cycles = parseFloat(String(raw));
  if (!Number.isFinite(cycles)) return null;
  // a prescaler named after the peripheral family (ADC1 -> ADC) is its clock
  const family = String(pid).replace(/\d+$/, '');
  const r = clockCalc(m, s);
  const mhz = r[family] !== undefined ? r[family] : periphClockMhz(pid, m, s);
  if (!mhz) return null;
  const total = cycles + sarCycles;
  const us = total / mhz;                       // cycles / MHz = microseconds
  return {
    clockMhz: mhz,
    samplingCycles: cycles,
    sarCycles,
    totalCycles: total,
    us: Math.round(us * 1000) / 1000,
    ksps: Math.round((1000 / us) * 100) / 100,
  };
}
