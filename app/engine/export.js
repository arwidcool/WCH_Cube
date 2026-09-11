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
import { cFiles } from './codegen.js';

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

