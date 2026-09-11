// =============================================================================
//  clock.js — clock tree maths. No DOM, no rendering: renderClock() (UI) draws
//  whatever clockCalc() returns, so a new MCU's tree needs no UI change.
// =============================================================================
import { M, S } from './model.js';
import { paramValue } from './params.js';

// Initial clock state for an MCU's `clock:` block (null when the file has none).
export function defaultClock(c) {
  if (!c) return null;
  const pre = {};
  for (const [k, v] of Object.entries(c.prescalers || {})) pre[k] = v.options[0];
  return {
    hse: c.sources.HSE ? c.sources.HSE.mhz : 8,
    pllIn: 0,
    pllMul: c.pll ? c.pll.multipliers[0] : 1,
    sys: c.sysclk.sources[0],
    pre,
  };
}

// The root prescaler (the one with no `source:`) — AHB on F1-style parts, HB on V00x.
export const firstPre = c => Object.keys(c.prescalers || {}).find(n => !(c.prescalers[n].source));

/**
 * Which node ids carry a clock right now. Ids match what the UI draws:
 * HSI/HSE/LSI/LSE, PLL, SYSCLK, `pre:<name>`, `drv:<name>`. "Not feeding" is a
 * DISPLAY fact (dashed and dimmed) — it never means the user may not pick it.
 */
function feedingSet(c, k) {
  const on = new Set(['SYSCLK']);
  const pllSrc = c.pll ? (c.pll.inputs[k.pllIn] || {}).source : null;
  // a prescaler tapped straight off the PLL (USB on the dummy part) keeps the
  // PLL running even when SYSCLK comes from somewhere else
  if (Object.values(c.prescalers || {}).some(v => v.source === 'PLLCLK')) on.add('PLL');
  if (k.sys === 'PLLCLK') on.add('PLL'); else on.add(k.sys);
  if (on.has('PLL') && pllSrc) on.add(pllSrc);
  const fp = firstPre(c);
  if (fp) on.add('pre:' + fp);
  for (const [name, v] of Object.entries(c.prescalers || {})) {
    if (name === fp) continue;
    const base = v.source === 'PLLCLK' ? 'PLL'
      : (v.source && v.source !== fp && c.prescalers[v.source]) ? 'pre:' + v.source
      : (fp ? 'pre:' + fp : 'SYSCLK');
    if (on.has(base)) on.add('pre:' + name);
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
  if (!c) return { sys: [], pllIn: [], pllMul: [], pre: {} };
  return {
    sys: [...c.sysclk.sources],
    pllIn: (c.pll ? c.pll.inputs : []).map((i, index) =>
      ({ index, name: i.name, source: i.source, div: i.div || 1 })),
    pllMul: c.pll ? [...c.pll.multipliers] : [],
    pre: Object.fromEntries(Object.entries(c.prescalers || {}).map(([n, v]) => [n, [...v.options]])),
  };
}

// Does HSE reach SYSCLK, directly or through the PLL? The RCC coupling hangs off
// this: CubeMX switches the crystal on the moment the mux points at it.
export function hseFeedsSysclk(m = M, s = S) {
  const c = m.clock, k = s.clock;
  if (!c || !k) return false;
  if (k.sys === 'HSE') return true;
  if (k.sys === 'PLLCLK' && c.pll) {
    const inp = c.pll.inputs[k.pllIn];
    return !!inp && inp.source === 'HSE';
  }
  return false;
}

/**
 * Every frequency in MHz. Back-compatible keys (SYSCLK, HCLK, PLLCLK, pllIn,
 * every prescaler output, every derived tap, `over`) plus the round-2 shape the
 * clock UI binds to: `sources`, `pll`, `sysclk`, `hclk`, `feeding`, `under`,
 * `selectable`.
 *
 * NOTE for MCU files: prescaler and derived-tap names share this object with the
 * keys above, so a prescaler may not be called `sources`, `pll`, `feeding`,
 * `over`, `under`, `selectable`, `sysclk` or `hclk`.
 */
export function clockCalc(m = M, s = S) {
  const c = m.clock, k = s.clock, out = { over: [], under: [] };
  const src = {
    HSI: c.sources.HSI ? c.sources.HSI.mhz : 0,
    HSE: k.hse,
    LSI: c.sources.LSI ? c.sources.LSI.khz / 1000 : 0,
    LSE: c.sources.LSE ? c.sources.LSE.khz / 1000 : 0,
  };
  const pin = c.pll ? c.pll.inputs[k.pllIn] : null;
  out.pllIn = pin ? src[pin.source] / pin.div : 0;
  out.PLLCLK = out.pllIn * (k.pllMul || 1);
  out.SYSCLK = k.sys === 'PLLCLK' ? out.PLLCLK : src[k.sys];
  if (out.SYSCLK > c.sysclk.max_mhz) out.over.push('SYSCLK');

  const p = c.prescalers || {}, fp = firstPre(c);
  out.HCLK = out.SYSCLK / (fp ? k.pre[fp] : 1);
  if (fp && p[fp].max_mhz && out.HCLK > p[fp].max_mhz) out.over.push(fp);

  for (const [name, v] of Object.entries(p)) {
    if (name === fp) continue;
    const base = v.source === 'PLLCLK' ? out.PLLCLK
      : (v.source && v.source !== fp && out[v.source] !== undefined) ? out[v.source]
      : out.HCLK;
    out[name] = base / k.pre[name];
    if (v.max_mhz && out[name] > v.max_mhz) out.over.push(name);
    if (v.min_mhz && out[name] < v.min_mhz) { out.over.push(name); out.under.push(name); }
    if (v.target_mhz && Math.abs(out[name] - v.target_mhz) > 0.01) {
      out.over.push(name);
      if (out[name] < v.target_mhz) out.under.push(name);
    }
  }
  for (const d of c.derived || []) out[d.name] = out.HCLK / d.div;
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
  if (c.pll) out.feeding.PLL = on.has('PLL');
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
  const inp = c.pll ? c.pll.inputs[k.pllIn] : null;
  out.pll = c.pll ? {
    in: out.pllIn, out: out.PLLCLK, mul: k.pllMul || 1,
    index: k.pllIn, source: inp ? inp.source : null, name: inp ? inp.name : null,
    feeding: on.has('PLL'),
  } : null;
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
