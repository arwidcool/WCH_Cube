// =============================================================================
//  clock.js — clock tree maths. No DOM, no rendering: renderClock() (UI) draws
//  whatever clockCalc() returns, so a new MCU's tree needs no UI change.
// =============================================================================
import { M, S } from './model.js';

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

// Every frequency in MHz, plus `over`: the names that are out of specification.
export function clockCalc(m = M, s = S) {
  const c = m.clock, k = s.clock, out = { over: [] };
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
    if (v.min_mhz && out[name] < v.min_mhz) out.over.push(name);
    if (v.target_mhz && Math.abs(out[name] - v.target_mhz) > 0.01) out.over.push(name);
  }
  for (const d of c.derived || []) out[d.name] = out.HCLK / d.div;
  if (c.sources.HSE && (k.hse < c.sources.HSE.min_mhz || k.hse > c.sources.HSE.max_mhz)) out.over.push('HSE');
  return out;
}
