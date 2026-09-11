// =============================================================================
//  export.js — text reports. Pure string building; no DOM, no file saving.
//  First real output of the Generate button (Phase 3). C code generation will
//  join these once the pin table is trusted.
// =============================================================================
import { M, S, pinType } from './model.js';
import { E, compute } from './engine.js';
import { clockCalc, firstPre } from './clock.js';

const num = v => (Math.round(v * 1000) / 1000).toString();

// One row per physical pin of the current package, in pin-number order.
export function pinRows() {
  const e = E || compute();
  const rows = [];
  for (const [n, names] of Object.entries(M._phys[S.pkg])) {
    const name = names[0];
    const info = e.pins[name];
    const g = S.gpio[name] || {};
    const type = pinType(name);
    rows.push({
      num: n === '0' ? '' : n,
      sortNum: n === '0' ? 1e6 : +n,
      name: names.join('/'),
      type,
      shorted: names.length > 1,
      signal: info ? info.label : (type === 'io' ? '' : type.toUpperCase()),
      mode: info ? (g.mode || (info.claims.some(c => c.who !== 'GPIO') ? 'Alternate Function Push Pull' : 'Input')) : '',
      pull: info ? (g.pull || 'No pull') : '',
      speed: info ? (g.speed || 'Low') : '',
      label: g.label || '',
      conflict: !!(info && info.state === 'conflict'),
    });
  }
  return rows.sort((a, b) => a.sortNum - b.sortNum);
}

const COLS = ['Pin', 'Name', 'Signal', 'Mode', 'Pull', 'Speed', 'User label', 'Note'];
const note = r => [r.conflict ? 'CONFLICT' : '', r.shorted ? 'shorted pins' : '', r.type !== 'io' ? r.type : ''].filter(Boolean).join('; ');

export function pinTableMarkdown() {
  const rows = pinRows();
  const head = `# ${M.mcu.name} — pinout (${S.pkg})\n\n`;
  const body = [
    `| ${COLS.join(' | ')} |`,
    `|${COLS.map(() => '---').join('|')}|`,
    ...rows.map(r => `| ${[r.num, r.name, r.signal, r.mode, r.pull, r.speed, r.label, note(r)].map(v => String(v).replace(/\|/g, '\\|')).join(' | ')} |`),
  ].join('\n');
  const conflicts = (E || compute()).conflictList;
  const tail = conflicts.length
    ? `\n\n**${conflicts.length} pin conflict${conflicts.length > 1 ? 's' : ''}:**\n` + conflicts.map(c => `- ${c.text}`).join('\n') + '\n'
    : '\n\nNo pin conflicts.\n';
  return head + body + tail;
}

export function pinTableCsv() {
  const esc = v => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [COLS.join(','), ...pinRows().map(r => [r.num, r.name, r.signal, r.mode, r.pull, r.speed, r.label, note(r)].map(esc).join(','))].join('\n') + '\n';
}

export function clockSummaryMarkdown() {
  if (!M.clock) return `# ${M.mcu.name} — clocks\n\nThis MCU file has no clock section.\n`;
  const c = M.clock, k = S.clock, r = clockCalc();
  const fp = firstPre(c);
  const lines = [`# ${M.mcu.name} — clock configuration`, '', '| Node | Setting | Frequency |', '|---|---|---|'];
  if (c.sources.HSI) lines.push(`| HSI | fixed | ${num(c.sources.HSI.mhz)} MHz |`);
  if (c.sources.HSE) lines.push(`| HSE | crystal | ${num(k.hse)} MHz |`);
  if (c.sources.LSI) lines.push(`| LSI | fixed | ${num(c.sources.LSI.khz)} kHz |`);
  if (c.pll) lines.push(`| PLL | ${c.pll.inputs[k.pllIn].name} × ${k.pllMul} | ${num(r.PLLCLK)} MHz |`);
  lines.push(`| SYSCLK | source ${k.sys} | ${num(r.SYSCLK)} MHz |`);
  if (fp) lines.push(`| HCLK | ${fp} /${k.pre[fp]} | ${num(r.HCLK)} MHz |`);
  for (const [n, v] of Object.entries(c.prescalers || {})) {
    if (n === fp) continue;
    lines.push(`| ${n} | /${k.pre[n]}${v.source ? ` from ${v.source}` : ''} | ${num(r[n])} MHz |`);
  }
  for (const d of c.derived || []) lines.push(`| ${d.name} | HCLK /${d.div} | ${num(r[d.name])} MHz |`);
  lines.push('');
  lines.push(r.over.length ? `**Out of specification: ${r.over.join(', ')}**` : 'All clocks within specification.');
  lines.push('');
  return lines.join('\n');
}

// Everything the Generate button can produce right now, as {filename: text}.
export function generateAll() {
  const base = `${M.mcu.name}_${S.pkg}`;
  return {
    [`${base}_pinout.md`]: pinTableMarkdown(),
    [`${base}_pinout.csv`]: pinTableCsv(),
    [`${base}_clocks.md`]: clockSummaryMarkdown(),
  };
}

