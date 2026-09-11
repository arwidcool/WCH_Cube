// =============================================================================
//  codegen.js — C initialisation code in WCH EVT SDK style.
//
//  What is generated from the model alone (always correct):
//    the GPIO_InitTypeDef blocks — ports, pin masks, modes, speeds — because
//    every one of those comes from the pin assignments and the GPIO table.
//
//  What needs register encodings from the MCU file (`codegen:` block):
//    the AFIO remap word, the peripheral clock enables and the RCC clock setup.
//    Bit positions are per family and are NOT guessed here: without them those
//    sections are emitted as an explicit TODO that names exactly what is needed,
//    rather than plausible-looking code that would configure the wrong bits.
//
//  Schema (see the board request to AGENT-1):
//    codegen:
//      header: ch32v00x.h
//      gpio_clock: { fn: RCC_PB2PeriphClockCmd, port: RCC_PB2Periph_GPIO$PORT,
//                    afio: RCC_PB2Periph_AFIO }
//      speeds: { Low: GPIO_Speed_2MHz, Medium: GPIO_Speed_10MHz, High: GPIO_Speed_50MHz }
//      remap:  { register: "AFIO->PCFR1",
//                fields: { USART1: [{ lsb: 6, bits: 4 }],
//                          TIM2:   [{ lsb: 14, bits: 2 }, { lsb: 16, bits: 1, from: 2 }] } }
//      rcc:    { register: "RCC->CFGR0",
//                sw:     { lsb: 0,  bits: 2, values: { HSI: 0, HSE: 1, PLLCLK: 2 } },
//                pllsrc: { lsb: 16, bits: 1, values: { HSI: 0, HSE: 1 } },
//                prescalers: { HB: { lsb: 4, bits: 4, values: { 1: 0, 2: 1 } } } }
//    A field may be split across slices: `from` is the bit of the remap index a
//    slice starts at (TIM2_RM[2] lives at bit 16, away from TIM2_RM[1:0]).
// =============================================================================
import { M, S, pinType, requiredSignals } from './model.js';
import { E, compute } from './engine.js';
import { clockCalc, firstPre } from './clock.js';
import { PROJECT } from './project.js';

const PIN_RE = /^P([A-Z])(\d+)$/;
const hex = (v, digits = 8) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(digits, '0') + 'U';
const bin = (v, bits) => (v >>> 0).toString(2).padStart(bits, '0');

// Standard StdPeriph names, the same in the WCH EVT SDK and in the CH32H417
// example under EVT/EXAM/GPIO. Overridable per family through `codegen:`.
const DEFAULT_SPEEDS = { Low: 'GPIO_Speed_2MHz', Medium: 'GPIO_Speed_10MHz', High: 'GPIO_Speed_50MHz' };

const MODE_MACRO = {
  'Output Push Pull': 'GPIO_Mode_Out_PP',
  'Output Open Drain': 'GPIO_Mode_Out_OD',
  'Alternate Function Push Pull': 'GPIO_Mode_AF_PP',
  'Alternate Function Open Drain': 'GPIO_Mode_AF_OD',
  Analog: 'GPIO_Mode_AIN',
};
const INPUT_MACRO = { 'No pull': 'GPIO_Mode_IN_FLOATING', 'Pull-up': 'GPIO_Mode_IPU', 'Pull-down': 'GPIO_Mode_IPD' };

const cfg = () => M.codegen || {};
const bareSignal = claim => claim.signal.slice(claim.who.length + 1);

// Signals that are NOT set up with GPIO_Init: the debug interface and the reset
// pin are controlled by option bytes and the debug hardware, and driving the
// reset pin as a push-pull output would be actively harmful. Overridable per
// family through codegen.skip_signals; SYS is the default because every WCH part
// puts SWIO/SWCLK/RST there.
const DEFAULT_SKIP = { SYS: true };
function skipped(claim) {
  const rule = (cfg().skip_signals || DEFAULT_SKIP)[claim.who];
  return rule === true || (Array.isArray(rule) && rule.includes(bareSignal(claim)));
}

// An analog function needs GPIO_Mode_AIN, not AF_PP. codegen.analog_signals is
// the authoritative list; without it, fall back to "an Analog-category
// peripheral on an analog-capable pin" and say in the code that it was inferred.
// The fallback cannot tell ADC1_IN4 from ADC1_RETR0 — they share PD3, and only
// one of them is analog — which is why the data should say so.
function analogClaim(claim, pin) {
  const table = (cfg().analog_signals || {})[claim.who];
  if (table) return { analog: table.includes(bareSignal(claim)), inferred: false };
  const P = M.peripherals[claim.who];
  const guess = !!(P && P.category === 'Analog' && (M.pins[pin] || {}).analog);
  return { analog: guess, inferred: guess };
}

// ---- what to configure -------------------------------------------------------
// One entry per physical GPIO the configuration uses, named by the pin the
// signal actually sits on (on a shorted pair that is not always the canonical one).
export function gpioPlan() {
  const e = E || compute();
  const out = [];
  for (const [canonPin, info] of Object.entries(e.pins)) {
    const usable = info.claims.filter(c => !skipped(c));
    if (!usable.length) continue;                        // e.g. a pin that only carries SWIO
    for (const claim of usable) {
      const pin = claim.via || canonPin;
      const m = PIN_RE.exec(pin);
      if (!m || pinType(pin) !== 'io') continue;
      if (out.some(x => x.pin === pin)) continue;         // one register setup per pin
      const g = S.gpio[pin] || S.gpio[canonPin] || {};
      const isAf = usable.some(c => c.who !== 'GPIO');
      const manual = claim.who === 'GPIO' ? claim.signal : null;
      const an = usable.map(c => analogClaim(c, claim.via || canonPin)).find(x => x.analog);
      let mode = g.mode;
      let inferred = false;
      if (!mode) {
        if (an) { mode = 'Analog'; inferred = an.inferred; }
        else if (isAf) mode = 'Alternate Function Push Pull';
        else if (manual === 'GPIO_Output') mode = 'Output Push Pull';
        else if (manual === 'GPIO_Analog') mode = 'Analog';
        else mode = 'Input';
      }
      const pull = g.pull || 'No pull';
      const macro = mode === 'Input' ? INPUT_MACRO[pull] || INPUT_MACRO['No pull'] : MODE_MACRO[mode] || 'GPIO_Mode_IN_FLOATING';
      out.push({
        pin, port: m[1], bit: +m[2],
        signal: usable.map(c => c.signal).join(' / '),
        label: (g.label || '').trim(),
        mode, pull, speed: g.speed || 'Low', macro, inferred,
        conflict: info.state === 'conflict',
      });
    }
  }
  return out.sort((a, b) => (a.port === b.port ? a.bit - b.bit : a.port.localeCompare(b.port)));
}

// Pins the configuration uses but GPIO_Init must not touch, with the reason.
export function skippedPins() {
  const e = E || compute();
  const out = [];
  for (const [canonPin, info] of Object.entries(e.pins)) {
    for (const claim of info.claims) {
      if (!skipped(claim)) continue;
      out.push({ pin: claim.via || canonPin, signal: claim.signal });
    }
  }
  return out.sort((a, b) => a.pin.localeCompare(b.pin));
}

// ---- AFIO remap word ---------------------------------------------------------
// Returns { register, value, mask, parts } or null when the file has no map.
export function remapWord() {
  const c = cfg().remap;
  if (!c || !c.fields) return null;
  let value = 0, mask = 0;
  const parts = [];
  for (const [pid, slices] of Object.entries(c.fields)) {
    if (!S.periph[pid]) continue;
    const index = S.periph[pid].remap || 0;
    const remaps = (M.peripherals[pid] || {}).remaps || [];
    let width = 0;
    for (const s of slices) {
      const from = s.from || 0;
      const field = (index >> from) & ((1 << s.bits) - 1);
      value |= field << s.lsb;
      mask |= ((1 << s.bits) - 1) << s.lsb;
      width = Math.max(width, from + s.bits);
    }
    parts.push({
      periph: pid, index, width,
      name: (remaps[index] || {}).name || String(index),
      used: requiredSignals(pid).size > 0,
    });
  }
  return { register: c.register || 'AFIO->PCFR1', value: value >>> 0, mask: mask >>> 0, parts };
}

// ---- RCC ---------------------------------------------------------------------
export function rccWord() {
  const c = cfg().rcc;
  if (!c || !M.clock) return null;
  const k = S.clock;
  let value = 0, mask = 0;
  const parts = [];
  const put = (spec, raw, what) => {
    if (!spec) return;
    const field = spec.values ? spec.values[raw] : raw;
    if (field === undefined) { parts.push({ what, note: `no encoding for ${raw}` }); return; }
    value |= (field & ((1 << spec.bits) - 1)) << spec.lsb;
    mask |= ((1 << spec.bits) - 1) << spec.lsb;
    parts.push({ what, raw, field, bits: spec.bits, lsb: spec.lsb });
  };
  put(c.sw, k.sys, 'SYSCLK source');
  if (c.pllsrc && M.clock.pll) put(c.pllsrc, M.clock.pll.inputs[k.pllIn].source, 'PLL input');
  for (const [name, spec] of Object.entries(c.prescalers || {})) put(spec, k.pre[name], `${name} prescaler`);
  return { register: c.register || 'RCC->CFGR0', value: value >>> 0, mask: mask >>> 0, parts };
}

// ---- the files ---------------------------------------------------------------
const banner = title => `/* ${'='.repeat(74)}\n * ${title}\n * ${'='.repeat(74)} */`;

function headerComment() {
  const r = M.clock ? clockCalc() : null;
  const lines = [
    '/*',
    ` * ${M.mcu.name} initialisation — generated by WCHCube. Do not edit by hand:`,
    ' * change the configuration and generate again.',
    ' *',
    ` * Project : ${PROJECT.name}${PROJECT.variant ? ` (${PROJECT.variant})` : ''}`,
    ` * Part    : ${M.mcu.name}  ${S.pkg}`,
    ` * Core    : ${M.mcu.core || 'unknown'}`,
  ];
  if (r) lines.push(` * Clocks  : SYSCLK ${r.SYSCLK} MHz, HCLK ${r.HCLK} MHz (source ${S.clock.sys})`);
  lines.push(' *');
  lines.push(' * Register names follow the WCH EVT SDK (StdPeriph) headers.');
  lines.push(' */');
  return lines.join('\n');
}

export function cHeader() {
  const guard = `WCHCUBE_INIT_H`;
  return [
    headerComment(),
    '',
    `#ifndef ${guard}`,
    `#define ${guard}`,
    '',
    `#include "${cfg().header || 'debug.h'}"`,
    '',
    'void WCHCube_RCC_Init(void);   /* clock tree: SYSCLK source, PLL, prescalers */',
    'void WCHCube_GPIO_Init(void);  /* port clocks, AFIO remap, every configured pin */',
    'void WCHCube_Init(void);       /* both, in the right order */',
    '',
    `#endif /* ${guard} */`,
    '',
  ].join('\n');
}

// The pins the debug interface and the reset pin sit on, as a comment block.
function skipNote(left) {
  return [
    '    /* Not configured here, by design: ' + left.map(s => `${s.pin} (${s.signal})`).join(', '),
    '       the debug interface and the reset pin are controlled by the option bytes. */',
    '',
  ];
}

function gpioSection() {
  const plan = gpioPlan();
  const left = skippedPins();
  const L = [];
  L.push(banner('GPIO'));
  L.push('void WCHCube_GPIO_Init(void)');
  L.push('{');
  if (!plan.length) {
    if (left.length) L.push(...skipNote(left).slice(0, 2));
    else L.push('    /* No pins configured. */');
    L.push('}');
    return L.join('\n');
  }
  L.push('    GPIO_InitTypeDef GPIO_InitStructure = {0};');
  L.push('');

  const ports = [...new Set(plan.map(p => p.port))].sort();
  const gc = cfg().gpio_clock;
  if (gc && gc.fn && gc.port) {
    const macros = ports.map(p => gc.port.replace('$PORT', p));
    const remap = remapWord();
    if (remap && gc.afio) macros.push(gc.afio);
    L.push(`    ${gc.fn}(${macros.join(' | ')}, ENABLE);`);
  } else {
    L.push('    /* TODO: enable the port clocks for ' + ports.map(p => 'GPIO' + p).join(', ') +
      (remapWord() ? ' and AFIO' : '') + '.');
    L.push('       The MCU file has no codegen.gpio_clock block, and this generator does');
    L.push('       not guess register names. */');
  }
  L.push('');

  for (const port of ports) {
    const mine = plan.filter(p => p.port === port);
    // one GPIO_Init call per distinct mode+speed on the port, the way CubeMX groups them
    const groups = new Map();
    for (const p of mine) {
      const key = `${p.macro}|${p.speed}`;
      (groups.get(key) || groups.set(key, []).get(key)).push(p);
    }
    for (const [key, pins] of groups) {
      const [macro, speed] = key.split('|');
      for (const p of pins) {
        const notes = [p.conflict ? '*** CONFLICT ***' : '', p.inferred ? 'analog mode inferred — add codegen.analog_signals to be certain' : ''].filter(Boolean);
        L.push(`    /* P${p.port}${p.bit}${p.label ? ` "${p.label}"` : ''} — ${p.signal}${notes.length ? '   ' + notes.join('; ') : ''} */`);
      }
      L.push(`    GPIO_InitStructure.GPIO_Pin = ${pins.map(p => `GPIO_Pin_${p.bit}`).join(' | ')};`);
      L.push(`    GPIO_InitStructure.GPIO_Mode = ${macro};`);
      L.push(`    GPIO_InitStructure.GPIO_Speed = ${(cfg().speeds || DEFAULT_SPEEDS)[speed] || DEFAULT_SPEEDS.Low};`);
      L.push(`    GPIO_Init(GPIO${port}, &GPIO_InitStructure);`);
      L.push('');
    }
  }

  if (left.length) L.push(...skipNote(left));

  const remap = remapWord();
  if (remap) {
    const active = remap.parts.filter(p => p.used);
    L.push('    /* Alternate function remap (AFIO) */');
    for (const p of remap.parts) {
      L.push(`    /*   ${p.periph}_RM = ${bin(p.index, p.width)} — ${p.name}${p.used ? '' : ' (peripheral off)'} */`);
    }
    L.push(`    ${remap.register} = (${remap.register} & ~${hex(remap.mask)}) | ${hex(remap.value)};`);
    if (!active.length) L.push('    /*   nothing enabled uses a remap; the write is the reset value. */');
  } else {
    const used = Object.keys(M.peripherals).filter(pid => (M.peripherals[pid].remaps || []).length > 1 && requiredSignals(pid).size);
    if (used.length) {
      L.push('    /* TODO: alternate function remap. The MCU file has no codegen.remap.fields,');
      L.push('       so the AFIO register word cannot be computed. Selected remaps are:');
      for (const pid of used) {
        const i = S.periph[pid].remap;
        L.push(`         ${pid}: index ${i} — ${M.peripherals[pid].remaps[i].name}`);
      }
      L.push('       Add codegen.remap.fields to the MCU YAML and generate again. */');
    }
  }
  L.push('}');
  return L.join('\n');
}

function rccSection() {
  const L = [];
  L.push(banner('Clock tree'));
  L.push('void WCHCube_RCC_Init(void)');
  L.push('{');
  if (!M.clock) {
    L.push('    /* This MCU file has no clock section. */');
    L.push('}');
    return L.join('\n');
  }
  const r = clockCalc(), k = S.clock, fp = firstPre(M.clock);
  L.push(`    /* SYSCLK ${r.SYSCLK} MHz from ${k.sys}${k.sys === 'PLLCLK' ? ` (${M.clock.pll.inputs[k.pllIn].name} x ${k.pllMul})` : ''} */`);
  L.push(`    /* ${fp} /${k.pre[fp]} -> HCLK ${r.HCLK} MHz */`);
  for (const [name, v] of Object.entries(M.clock.prescalers || {})) {
    if (name === fp) continue;
    L.push(`    /* ${name} /${k.pre[name]} -> ${r[name]} MHz${v.min_mhz || v.max_mhz ? ` (${v.min_mhz || 0}-${v.max_mhz || '?'} MHz)` : ''} */`);
  }
  if (r.over.length) L.push(`    /* WARNING: out of specification: ${r.over.join(', ')} */`);
  L.push('');
  const rcc = rccWord();
  if (rcc) {
    for (const p of rcc.parts) {
      L.push(p.note ? `    /* ${p.what}: ${p.note} */`
        : `    /* ${p.what} = ${bin(p.field, p.bits)} (bit${p.bits > 1 ? `s ${p.lsb + p.bits - 1}:${p.lsb}` : ` ${p.lsb}`}) */`);
    }
    L.push(`    ${rcc.register} = (${rcc.register} & ~${hex(rcc.mask)}) | ${hex(rcc.value)};`);
    L.push('');
    L.push('    /* NOTE: this writes the mux and prescaler fields only. Starting HSE or the');
    L.push('       PLL and waiting for them to lock is the SDK SystemInit()\'s job. */');
  } else {
    L.push('    /* TODO: the MCU file has no codegen.rcc block, so the register word cannot');
    L.push('       be computed. The settings above are what the configuration asks for. */');
  }
  L.push('}');
  return L.join('\n');
}

export function cSource() {
  const e = E || compute();
  const L = [headerComment(), '', '#include "wchcube_init.h"', ''];
  if (e.conflictList.length) {
    L.push(`#error "WCHCube: ${e.conflictList.length} unresolved pin conflict(s) — ${e.conflictList.map(c => c.text).join('; ')}"`);
    L.push('');
  }
  L.push(rccSection(), '', gpioSection(), '');
  L.push(banner('Entry point'));
  L.push('void WCHCube_Init(void)');
  L.push('{');
  L.push('    WCHCube_RCC_Init();');
  L.push('    WCHCube_GPIO_Init();');
  L.push('}');
  L.push('');
  return L.join('\n');
}

export function cFiles() {
  return { 'wchcube_init.h': cHeader(), 'wchcube_init.c': cSource() };
}
