// =============================================================================
//  export.js — text reports. Pure string building; no DOM, no file saving.
//  First real output of the Generate button (Phase 3). C code generation will
//  join these once the pin table is trusted.
// =============================================================================
import { M, S, pinType, gpioSpeedFor } from './model.js';
import { validateParam } from './params.js';
import { record } from './history.js';
import { E, compute } from './engine.js';
import { clockCalc, firstPre } from './clock.js';
// `user` is codegen's: main.c carries the same USER CODE blocks under the same
// option, and two copies of that helper would be two things to keep in step.
import { cFiles, gpioPlan, cfg, user } from './codegen.js';
// project.js imports generatorOptions from here, so this is a cycle. It is safe
// because neither side reads the other at module-evaluation time - PROJECT is only
// touched inside functions - and build.py concatenates both into one scope anyway.
import { PROJECT } from './project.js';
import { zipFiles } from './zip.js';

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
      speed: info ? (gpioSpeedFor(g.speed) || '') : '',
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

// ---- generator options -------------------------------------------------------
//  What the Project Manager tab offers, and nothing more. Round-2's rule applies to
//  this list as hard as it does to a peripheral control: **an option the engine
//  cannot honour is not offered**, so the UI renders exactly what comes back from
//  here rather than a hardcoded set of checkboxes. Adding an option to this list is
//  a promise that generateAll() obeys it.
//
const GENERATOR_OPTIONS = [
  {
    key: 'split_peripherals',
    name: 'A file pair per peripheral, instead of one pair',
    type: 'bool',
    default: false,
    help: 'Off: everything is in wchcube_init.c/.h. On: each configured peripheral gets its '
      + 'own wchcube_<peripheral>.c/.h holding WCHCube_<PERIPHERAL>_Init(), and wchcube_init.c '
      + 'keeps the clocks, the pins, DMA, the interrupts and the entry point. The per-peripheral '
      + 'function exists either way - the option only decides which file it lands in.',
  },
  {
    key: 'reports',
    name: 'Also generate the pin table and clock summary',
    type: 'bool',
    default: true,
    help: 'Writes <part>_<package>_pinout.md, _pinout.csv and _clocks.md beside the C. '
      + 'They document the configuration; nothing compiles them.',
  },
  {
    key: 'user_code',
    name: 'Keep my code between the USER CODE markers',
    type: 'bool',
    default: true,
    help: 'Regeneration copies the body of every /* USER CODE BEGIN x */ … /* USER CODE END x */ '
      + 'block out of the file being replaced. A block whose marker no longer exists is never '
      + 'dropped silently - it is moved to the end of the file under USER CODE ORPHANED.',
  },
];

/** The options this build can honour, for the UI to render. Never a hardcoded list. */
export const generatorOptions = () => GENERATOR_OPTIONS.map(o => ({ ...o }));

const optionDef = key => GENERATOR_OPTIONS.find(o => o.key === key);

/** The value in force for one option. */
export function generatorOption(key) {
  const d = optionDef(key);
  if (!d) return undefined;
  const v = ((S && S.project && S.project.options) || {})[key];
  return v === undefined ? d.default : v;
}

/** Set one generator option. Validated, and one undo step, like every other writer. */
export function setGeneratorOption(key, value) {
  const d = optionDef(key);
  if (!d) {
    throw new Error(`No generator option "${key}" (has: ${GENERATOR_OPTIONS.map(o => o.key).join(', ')})`);
  }
  const v = validateParam(d, value, `Generator option "${d.name}"`);
  record(`Generator option: ${d.name}`);
  ((S.project ||= {}).options ||= {})[key] = v;
  return v;
}

// ---- user code sections ------------------------------------------------------
//  CubeMX's contract, and the only reason anybody trusts a code generator with a
//  file they have edited: what is between the markers is yours and regeneration
//  does not touch it.
//
//  A tag that disappears from the template is the dangerous case - the user's code
//  would vanish with it and they would not find out until they looked. Rather than
//  drop it, it is appended under USER CODE ORPHANED, commented out, with the tag it
//  came from. Losing work silently is not a trade-off this generator gets to make.

const USER_BEGIN = tag => `/* USER CODE BEGIN ${tag} */`;
const USER_END = tag => `/* USER CODE END ${tag} */`;

/** An empty, labelled section for the generated template to carry. */
export function userSection(tag, indent = '') {
  return [`${indent}${USER_BEGIN(tag)}`, `${indent}${USER_END(tag)}`];
}

/**
 * Every `/* USER CODE BEGIN x *​/ … /* USER CODE END x *​/` body in a file, by tag.
 * Unclosed and duplicate markers are reported rather than guessed at: half-parsing
 * somebody's source and writing the result back is how an editor eats a file.
 */
export function userSections(text) {
  const sections = {};
  const issues = [];
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  let tag = null, body = [], startLine = 0;
  const beginRe = /\/\*\s*USER CODE BEGIN\s+(\S+)\s*\*\//;
  const endRe = /\/\*\s*USER CODE END\s+(\S+)\s*\*\//;
  lines.forEach((line, i) => {
    const b = beginRe.exec(line);
    const e = endRe.exec(line);
    if (b) {
      if (tag !== null) { issues.push(`USER CODE BEGIN ${b[1]} at line ${i + 1} while ${tag} is still open`); return; }
      tag = b[1]; body = []; startLine = i + 1;
      return;
    }
    if (e) {
      if (tag === null) { issues.push(`USER CODE END ${e[1]} at line ${i + 1} with nothing open`); return; }
      if (e[1] !== tag) { issues.push(`USER CODE END ${e[1]} at line ${i + 1} closes ${tag}`); }
      if (sections[tag] !== undefined) issues.push(`USER CODE ${tag} appears more than once; the last one wins`);
      sections[tag] = body.join('\n');
      tag = null;
      return;
    }
    if (tag !== null) body.push(line);
  });
  if (tag !== null) issues.push(`USER CODE BEGIN ${tag} at line ${startLine} is never closed`);
  return { sections, issues };
}

/**
 * Put the bodies from `previous` back into `next`, matched by tag. Returns the merged
 * text plus what happened, so a caller can tell the user rather than deciding for them.
 * A tag `next` does not have is NOT dropped - see the note above.
 */
export function mergeUserCode(previous, next) {
  const { sections, issues } = userSections(previous);
  const kept = [], orphaned = [];
  const tags = Object.keys(sections);
  if (!tags.length) return { text: next, kept, orphaned, issues };

  const lines = String(next).split(/\r?\n/);
  const out = [];
  const beginRe = /^(\s*)\/\*\s*USER CODE BEGIN\s+(\S+)\s*\*\//;
  const endRe = /\/\*\s*USER CODE END\s+(\S+)\s*\*\//;
  let skipping = null;
  for (const line of lines) {
    const b = beginRe.exec(line);
    if (b && sections[b[2]] !== undefined) {
      out.push(line);
      const body = sections[b[2]];
      if (body !== '') out.push(...body.split('\n'));
      kept.push(b[2]);
      skipping = b[2];
      continue;
    }
    if (skipping !== null) {
      const e = endRe.exec(line);
      if (e && e[1] === skipping) { out.push(line); skipping = null; }
      continue;                                   // the freshly generated body is replaced
    }
    out.push(line);
  }
  for (const tag of tags) {
    if (kept.includes(tag)) continue;
    if (sections[tag].trim() === '') continue;    // an empty block nobody wrote in
    orphaned.push(tag);
  }
  if (orphaned.length) {
    out.push('');
    out.push('/* ' + '='.repeat(74));
    out.push(' * USER CODE ORPHANED');
    out.push(' *');
    out.push(' * These blocks were in the previous version of this file and the tags they were');
    out.push(' * in no longer exist. They are kept here, commented out, because deleting code');
    out.push(' * somebody wrote is not something a generator gets to do quietly. Move what you');
    out.push(' * need into a live USER CODE section and delete the rest.');
    out.push(' * ' + '='.repeat(74) + ' */');
    out.push('#if 0');
    for (const tag of orphaned) {
      out.push(`/* was: USER CODE ${tag} */`);
      out.push(...sections[tag].split('\n'));
    }
    out.push('#endif');
    out.push('');
  }
  return { text: out.join('\n'), kept, orphaned, issues };
}

/**
 * Everything the Generate button produces, as `[{ name, language, text }]`.
 *
 * A LIST rather than the `{name: text}` map it used to be, so the Project Manager can
 * list files and preview one without knowing what codegen produces (AGENT-3, board
 * 14:30Z). `language` is a hint for the preview and nothing more. The order is fixed -
 * the C first, because that is what people came for.
 */
export function generateAll() {
  const base = `${M.mcu.name}_${S.pkg}`;
  const out = [];
  for (const [name, text] of Object.entries(cFiles())) {
    out.push({ name, language: 'c', text });
  }
  if (generatorOption('reports')) {
    out.push({ name: `${base}_pinout.md`, language: 'markdown', text: pinTableMarkdown() });
    out.push({ name: `${base}_pinout.csv`, language: 'csv', text: pinTableCsv() });
    out.push({ name: `${base}_clocks.md`, language: 'markdown', text: clockSummaryMarkdown() });
  }
  return out;
}

// ---- a whole PlatformIO project ----------------------------------------------
//  `generateAll()` hands the user a file pair. They still have to go and find a
//  project to put it in. `projectFiles()` hands them a folder that builds and
//  flashes:
//
//      <ProjectName>/
//      ├── platformio.ini
//      ├── README.md
//      ├── .gitignore
//      ├── src/main.c
//      └── lib/wchcube_generated/{include,src}/…
//
//  It mirrors `data/firmware/`, which already works, minus the parts that only
//  make sense in this repository: no lib/board, no lib/wch_hal, no lib/util. The
//  generated main.c calls the generated init and the SDK, and nothing else - a
//  generated project that shipped its own HAL would be a second HAL to maintain.
//
//  Every value below comes from the MCU file or the SDK headers. Nothing about a
//  board, an LED or a pin is invented; see `mainC()` for what that costs and why
//  it is worth it.

const PIO_COMPONENT_DIR = 'lib/wchcube_generated';

/** The variant (part number) a project is for, and what PlatformIO calls its board. */
export function pioTarget() {
  const variants = (M.mcu && M.mcu.variants) || {};
  const able = Object.entries(variants).filter(([, v]) => v && v.pio_board);
  let name = PROJECT.variant && variants[PROJECT.variant] ? PROJECT.variant : null;
  if (!name && !PROJECT.variant) {
    // No part number chosen, but the PACKAGE is already a choice the user made, and a
    // package usually identifies exactly one orderable part. Taking it when it is
    // unambiguous is reading the configuration, not inventing hardware. When two part
    // numbers share a package they differ in something that matters - F4P6 is 16 KB of
    // flash against F8P6's 62 KB - so then it really is the user's choice and we ask.
    const here = able.filter(([, v]) => !v.package || v.package === S.pkg);
    if (here.length === 1) name = here[0][0];
    else if (here.length > 1) {
      return {
        variant: null, board: null, env: null,
        missing: `${M.mcu.name} has ${here.length} part numbers in ${S.pkg}`
          + ` and they are not interchangeable — choose one: ${here.map(([k]) => k).join(', ')}`,
        generatable: able.map(([k]) => k),
      };
    }
  }
  if (!name) {
    return {
      variant: null, board: null, env: null,
      missing: PROJECT.variant
        ? `"${PROJECT.variant}" is not a part number of ${M.mcu.name}`
        : `no part number of ${M.mcu.name} in ${S.pkg} has a PlatformIO board`,
      generatable: able.map(([k]) => k),
    };
  }
  const v = variants[name];
  if (!v.pio_board) {
    // Deliberate, and it must stay deliberate: CH32V006F4U6 has 16 KB of flash
    // against F8U6's 62 KB, so substituting the nearest board would lie about the
    // memory and the link would succeed right up until it did not fit.
    return {
      variant: name, board: null, env: null,
      missing: `the PlatformIO ch32v platform ships no board for ${name}`
        + (v.notes ? ` — ${v.notes}` : ''),
      generatable: able.map(([k]) => k),
    };
  }
  // A part number IS a package: CH32V006F8P7 is the TSSOP20 one. Generating pins for
  // one package and a platformio.ini naming another would be a project whose pinout
  // and whose board file describe different chips, and it would build.
  if (v.package && v.package !== S.pkg) {
    const forThisPkg = able.filter(([, x]) => x.package === S.pkg).map(([k]) => k);
    return {
      variant: name, board: null, env: null,
      missing: `${name} is the ${v.package} part but this configuration is for ${S.pkg}`
        + (forThisPkg.length
          ? `. For ${S.pkg}, use ${forThisPkg.join(' or ')}`
          : `, and no part number with a PlatformIO board uses ${S.pkg}`),
      generatable: able.map(([k]) => k),
    };
  }
  return {
    variant: name,
    board: v.pio_board,
    env: v.pio_env || v.pio_board,
    package: v.package || S.pkg,
    missing: null,
    generatable: able.map(([k]) => k),
  };
}

/** A name safe as a folder and as a PlatformIO env. */
const safeName = s => String(s || 'wchcube_project').trim().replace(/[^A-Za-z0-9._-]+/g, '_') || 'wchcube_project';

/**
 * The pins the USER declared as plain GPIO outputs - the only ones main.c may touch.
 *
 * Deliberately `S.manual[pin] === 'GPIO_Output'` and not "any pin whose mode macro is
 * push-pull": a USART TX line is push-pull too, and toggling it from the loop would
 * fight the peripheral that owns it. "The user pointed at this pin and said GPIO
 * output" is the only claim strong enough to justify driving it.
 */
export function outputPins() {
  return gpioPlan()
    .filter(p => (S.manual || {})[p.pin] === 'GPIO_Output')
    .map(p => ({ pin: p.pin, port: p.port, bit: p.bit, label: p.label, mode: p.mode }));
}

function iniFile(t) {
  const r = M.clock ? clockCalc() : null;
  const L = [
    '; ' + '='.repeat(74),
    `;  ${PROJECT.name} — generated by WCHCube. Safe to edit: regeneration writes`,
    ';  lib/wchcube_generated/ and nothing else.',
    ';',
    `;  Part      : ${t.variant}  (${M.mcu.name}, ${t.package})`,
    `;  Board file: ${t.board} — the platform's own JSON is where the flash size,`,
    ';              RAM size, march/mabi and the -D flags come from. Not this file.',
  ];
  if (r) L.push(`;  Clocks    : SYSCLK ${r.SYSCLK} MHz, HCLK ${r.HCLK} MHz (source ${S.clock.sys})`);
  L.push(
    '; ' + '='.repeat(74),
    '',
    '[platformio]',
    `default_envs = ${t.env}`,
    '',
    `[env:${t.env}]`,
    'platform  = ch32v',
    'framework = noneos-sdk',
    `board     = ${t.board}`,
    '',
    '; The LDF does not evaluate __has_include, so lib/wchcube_generated would never be',
    '; discovered from an optional include. Naming it puts its include/ on the path.',
    'lib_ldf_mode = chain+',
    'lib_deps =',
    '    wchcube_generated',
    '',
    '; printf() over the WCH-Link debug interface. Chosen because it claims NO pin:',
    '; routing printf to a USART would silently occupy whatever pins that USART is on',
    '; and fight the configuration in lib/wchcube_generated.',
    'build_flags =',
    '    -D SDI_PRINT=1',
    '',
    'upload_protocol = wch-link',
    'debug_tool      = wch-link',
    'monitor_speed   = 115200',
    '',
  );
  return L.join('\n');
}

function mainC(t) {
  const r = M.clock ? clockCalc() : null;
  const outs = outputPins();
  const blink = outs[0] || null;
  const L = [];
  L.push('/* ' + '-'.repeat(74));
  L.push(` *  main.c — ${PROJECT.name}`);
  L.push(' *');
  L.push(' *  Generated once by WCHCube as a starting point. Unlike');
  L.push(' *  lib/wchcube_generated/, this file is YOURS: regeneration keeps whatever is');
  L.push(' *  between the USER CODE markers and leaves the rest alone.');
  L.push(' *');
  L.push(' *  It calls the generated initialisation and the vendor SDK, and nothing else.');
  L.push(' *  It has no HAL of its own on purpose - a generated project that shipped one');
  L.push(' *  would be a second HAL for you to maintain.');
  L.push(' * ' + '-'.repeat(74) + ' */');
  L.push(`#include "${cfg().header || 'debug.h'}"`);
  // The SDK does not spell these the same way on every family, so BOTH come from
  // the MCU file rather than from a literal here:
  //   codegen.clock_update_fn  SystemCoreClockUpdate on most parts, but
  //                            SystemAndCoreClockUpdate on a dual-core one, where
  //                            calling the other name fails at LINK.
  //   codegen.sdi_printf_fn    absent on a part whose Debug folder has no SDI
  //                            channel at all - it prints over a USART instead -
  //                            and an absent key means the call is not emitted.
  // Defaults keep every existing part's output byte-identical.
  const clockUpdate = cfg().clock_update_fn || 'SystemCoreClockUpdate';
  const sdiPrintf = cfg().sdi_printf_fn === undefined ? 'SDI_Printf_Enable' : cfg().sdi_printf_fn;
  L.push(`#include "debug.h"      /* Delay_Init, Delay_Ms, ${sdiPrintf ? sdiPrintf + ', ' : ''}printf */`);
  L.push('#include "wchcube_init.h"');
  L.push('');
  L.push(...user('Includes'));
  L.push('');
  L.push(...user('PV'));
  L.push('');
  L.push('int main(void)');
  L.push('{');
  L.push(`    ${clockUpdate}();`);
  L.push('    Delay_Init();');
  if (sdiPrintf) {
    L.push(`    ${sdiPrintf}();   /* printf goes to the WCH-Link SDI channel; no pin is used */`);
  } else {
    L.push('    /* The SDK for this part has no SDI printf channel - its debug.h declares only');
    L.push('       USART_Printf_Init(baud), which would claim a pin. Call it yourself if you');
    L.push('       want printf, and pick the USART in the configurator so the pin is reserved. */');
  }
  L.push('');
  L.push('    /* The board file sets SYSCLK before main() through SystemInit(); the generated');
  L.push('       WCHCube_RCC_Init() then applies the tree this project asked for and wins. So a');
  L.push(`       ${r ? r.SYSCLK : '?'} MHz project may boot at the board's rate and change here - which is why`);
  L.push(`       ${clockUpdate}() is called again below, before anything reads the clock. */`);
  L.push('    WCHCube_Init();');
  L.push(`    ${clockUpdate}();`);
  L.push('');
  L.push(`    printf("\\r\\n${PROJECT.name} — ${t.variant} (${M.mcu.name}, ${t.package})\\r\\n");`);
  if (r) {
    L.push(`    printf("configured SYSCLK : ${r.SYSCLK} MHz (source ${S.clock.sys})\\r\\n");`);
  }
  L.push('    printf("SystemCoreClock   : %lu Hz\\r\\n", (unsigned long)SystemCoreClock);');
  L.push('    /* If those two disagree, the configuration did not take - find out now rather');
  L.push('       than when a baud rate or a delay is silently wrong. */');
  if (blink) {
    L.push(`    printf("toggling          : ${blink.pin}${blink.label ? ` \\"${blink.label}\\"` : ''} (${blink.mode})\\r\\n");`);
  } else {
    L.push('    printf("toggling          : nothing — no output GPIO is configured in this project\\r\\n");');
  }
  L.push('');
  L.push(...user('Setup', '    '));
  L.push('');
  L.push('    for (;;) {');
  if (blink) {
    L.push(`        /* ${blink.pin}${blink.label ? ` — "${blink.label}"` : ''} — ${blink.mode} in this project.`);
    L.push('           This is YOUR pin, from the configuration; nothing here picked it. */');
    L.push(`        GPIO_WriteBit(GPIO${blink.port}, GPIO_Pin_${blink.bit},`);
    L.push(`                      GPIO_ReadOutputDataBit(GPIO${blink.port}, GPIO_Pin_${blink.bit}) ? Bit_RESET : Bit_SET);`);
  } else {
    L.push('        /* No output GPIO is configured, so there is nothing to toggle. Assign one');
    L.push('           in WCHCube as an output, regenerate, and a blink appears here. Picking a');
    L.push('           pin for you would be inventing hardware this project cannot see. */');
  }
  L.push('        Delay_Ms(500);');
  L.push(...user('Loop', '        '));
  L.push('    }');
  L.push('}');
  L.push('');
  return L.join('\n');
}

function readmeMd(t) {
  const r = M.clock ? clockCalc() : null;
  const outs = outputPins();
  const rows = pinRows().filter(x => x.signal || x.label);
  const L = [];
  L.push(`# ${PROJECT.name}`);
  L.push('');
  L.push(`A PlatformIO project for **${t.variant}** (${M.mcu.name}, ${t.package}), generated by WCHCube.`);
  L.push('');
  L.push('## Build and flash');
  L.push('');
  L.push('```bash');
  L.push('pio run                 # build');
  L.push('pio run -t upload       # flash over WCH-Link');
  L.push('pio device monitor      # read the SDI output (115200)');
  L.push('```');
  L.push('');
  L.push('`printf` goes to the WCH-Link SDI channel, which claims **no pin** — so the startup');
  L.push('banner works on a bare chip with nothing else wired.');
  L.push('');
  L.push('## What is generated, and what is yours');
  L.push('');
  L.push('| Path | Owner |');
  L.push('|---|---|');
  L.push('| `lib/wchcube_generated/` | **WCHCube.** Regeneration overwrites it. Do not edit by hand — if the code is wrong, the configuration is. |');
  L.push('| `src/main.c` | **You**, after the first generation. Code between `/* USER CODE BEGIN x */` and `/* USER CODE END x */` survives regeneration. |');
  L.push('| `platformio.ini` | **You.** Written once. |');
  L.push('');
  L.push('## The clock, and why it is set twice');
  L.push('');
  L.push('The board file gives `SystemInit()` a SYSCLK before `main()` runs, then');
  L.push('`WCHCube_RCC_Init()` applies the tree this project asked for and wins. `main.c` calls');
  L.push(`\`${cfg().clock_update_fn || 'SystemCoreClockUpdate'}()\` afterwards so \`Delay_Ms()\` and anything else reading`);
  L.push(`\`SystemCoreClock\` stay honest${r ? `. This project asks for ${r.SYSCLK} MHz from ${S.clock.sys}` : ''}.`);
  L.push('The banner prints both, so a configuration that did not take is visible on the first run.');
  L.push('');
  L.push('## This configuration');
  L.push('');
  if (r) {
    L.push(`- SYSCLK **${r.SYSCLK} MHz** from ${S.clock.sys}, HCLK ${r.HCLK} MHz`);
  }
  L.push(`- ${rows.length} pin${rows.length === 1 ? '' : 's'} assigned`);
  if (outs.length) {
    L.push(`- output GPIO${outs.length === 1 ? '' : 's'}: ${outs.map(o => `\`${o.pin}\`${o.label ? ` "${o.label}"` : ''}`).join(', ')}`
      + ` — \`main.c\` toggles ${outs.length === 1 ? 'it' : `the first of them (\`${outs[0].pin}\`)`}`);
  } else {
    L.push('- **no output GPIO is configured**, so `main.c` toggles nothing. Assign a pin as an');
    L.push('  output in WCHCube and regenerate, and the blink appears by itself. WCHCube will not');
    L.push('  pick a pin for you: on a bare chip there is no LED to pick.');
  }
  L.push('');
  if (rows.length) {
    L.push('| Pin | Signal | Label |');
    L.push('|---|---|---|');
    for (const x of rows) L.push(`| ${x.name} | ${x.signal || ''} | ${x.label || ''} |`);
    L.push('');
  }
  L.push('## Regenerating');
  L.push('');
  L.push('```bash');
  L.push(`node tools/wchcube_cli.js --project ${safeName(PROJECT.name)}.wchproj --pio .`);
  L.push('```');
  L.push('');
  L.push('That rewrites `lib/wchcube_generated/` only, carrying your USER CODE sections across.');
  L.push('');
  return L.join('\n');
}

/**
 * The whole project, as `[{ path, name, language, text }]`. `path` is relative to the
 * project folder and is what a writer, a zipper or a Tauri command uses; `name` is the
 * basename, for a file list in the UI.
 *
 * Throws when the selected part number has no PlatformIO board - see pioTarget().
 */
export function projectFiles() {
  const t = pioTarget();
  if (t.missing) {
    throw new Error(`Cannot generate a PlatformIO project: ${t.missing}. `
      + (t.generatable.length
        ? `Part numbers that can: ${t.generatable.join(', ')}.`
        : `No part number of ${M.mcu.name} has a pio_board in its MCU file.`));
  }
  const out = [
    { path: 'platformio.ini', language: 'ini', text: iniFile(t) },
    { path: 'README.md', language: 'markdown', text: readmeMd(t) },
    { path: '.gitignore', language: 'text', text: '.pio/\n' },
    { path: 'src/main.c', language: 'c', text: mainC(t) },
  ];
  for (const [name, text] of Object.entries(cFiles())) {
    const sub = name.endsWith('.h') ? 'include' : 'src';
    out.push({ path: `${PIO_COMPONENT_DIR}/${sub}/${name}`, language: 'c', text });
  }
  if (generatorOption('reports')) {
    const base = `${M.mcu.name}_${S.pkg}`;
    out.push({ path: `docs/${base}_pinout.md`, language: 'markdown', text: pinTableMarkdown() });
    out.push({ path: `docs/${base}_clocks.md`, language: 'markdown', text: clockSummaryMarkdown() });
  }
  return out.map(f => ({ ...f, name: f.path.slice(f.path.lastIndexOf('/') + 1) }));
}

/** The folder name a project should be written into. */
export const projectFolderName = () => safeName(PROJECT.name);

/**
 * The same project as a ZIP, for the browser - which has no filesystem and can only
 * hand the user a download. Every entry is under one top-level folder so unpacking
 * gives a project directory rather than scattering files into Downloads.
 *
 * Returns `{ name, bytes }`; the caller makes a Blob of it. Deterministic, because
 * `zipFiles` fixes its timestamps: the same configuration zips to the same bytes.
 */
export function projectZip() {
  const folder = projectFolderName();
  return {
    name: `${folder}.zip`,
    bytes: zipFiles(projectFiles().map(f => ({ path: `${folder}/${f.path}`, text: f.text }))),
  };
}
