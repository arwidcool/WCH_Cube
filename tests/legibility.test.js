// =============================================================================
//  tests/legibility.test.js — "can you actually read it", as a test.
//
//  Round 2's §6b found eight legibility defects by measuring a real browser:
//  bounding boxes, scrollWidth vs clientWidth, and WCAG contrast against the
//  real composited background, at two sizes, two zooms and two themes. This file
//  turns that audit into something that runs every time, so the findings cannot
//  come back quietly.
//
//  It has to be a REAL browser. jsdom has no layout engine: every box is 0×0,
//  offsetParent is always null, and nothing here would measure anything. That is
//  why the round-2 clock bug survived a green jsdom suite. When no browser is
//  present these checks SKIP with a printed reason, which the runner counts.
//
//  Findings it is the regression test for:
//    L1  the brand block clipping its third line, at every size
//    L2  the clock tree running past the viewport at 1280
//    L3  the clock notes paragraph overflowing at 125 %
//    L4  the GPIO pull select truncating its value ("No pu")
//    L5  the pin-search placeholder clipping ("find pin or sigr")
//    L6  the package selector cutting the temp grade mid-value
//    L7  SVG signal labels at 1.23:1 contrast — the human's original report
//    L8  the part-name labels in the die centre overlapping
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { suite, test, assert, skip } from './lib/harness.js';
import { withPage, browserAvailable } from './lib/browser.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

suite('legibility');

const why = 'no Chrome or Edge on this machine, and jsdom cannot measure text — '
  + 'set WCHCUBE_BROWSER to a Chromium binary to run the legibility checks';

/**
 * Is C1 — "the 8 measured text-legibility findings" — still open in TASKS.md?
 *
 * While it is, findings are PRINTED and do not fail the run. AGENT-3 owns C1 and
 * is working it; a red shared gate would stop the other three agents rather than
 * tell that one anything they do not already know. The moment C1 is ticked `[x]`,
 * every remaining finding becomes a hard failure — so this test closes itself,
 * and "C1 is done" and "the page is legible" cannot disagree for long.
 *
 * If TASKS.md cannot be read at all, fail. Not being able to tell is not a pass.
 */
function c1Open() {
  const tasks = fs.readFileSync(path.join(ROOT, 'TASKS.md'), 'utf8');
  const line = tasks.split(/\r?\n/).find(l => /\bC1\b/.test(l) && /legibility/i.test(l));
  if (!line) return false;                    // no line to be open: hold the full standard
  return /^\s*-\s*\[[ ~]\]/.test(line);
}

/** Report `found`: loudly either way, fatally only once C1 is closed. */
function report(found, what) {
  if (!found.length) return;
  if (c1Open()) {
    process.stdout.write(`        ${found.length} legibility finding(s), TASKS.md C1 still open (AGENT-3):\n`);
    for (const f of found) process.stdout.write(`          - ${f}\n`);
    return;
  }
  assert.empty(found, `${what} — and TASKS.md C1 is marked done, so these are regressions`);
}

/** The sizes, zooms and themes the round-2 audit used. Same grid, every run. */
const GRID = [
  { w: 1280, h: 720, z: 1 },
  { w: 1280, h: 720, z: 1.25 },
  { w: 1920, h: 1080, z: 1 },
  { w: 1920, h: 1080, z: 1.25 },
];

const label = c => `${c.w}x${c.h} @${c.z * 100}%${c.theme ? ' ' + c.theme : ''}`;

// ---------------------------------------------------------------- in-page code
//
// These run inside the browser. Kept as strings because that is what page.eval
// takes, and kept SMALL for the same reason: a bug in here is a bug in the
// measurement, which is worse than no measurement at all. The contrast helper
// has its own self-test at the bottom of this file for exactly that reason.

/** Text clipped by an ancestor that hides its overflow. */
const CLIPPED = `
  const bad = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('svg')) continue;                 // SVG text is measured separately
    if (el.matches('.sr, .sr *')) continue;          // screen-reader labels are 1x1 ON PURPOSE
    if (el === document.body || el === document.documentElement) continue;  // page-level
                                                     // overflow is the other check's job, and
                                                     // body's textContent is the inlined YAML,
                                                     // which makes for a baffling message
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (!(el.textContent || '').trim()) continue;
    const name = el.id ? '#' + el.id : el.tagName.toLowerCase()
      + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : '');
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 45);
    // Only 'hidden'/'clip' cut text off. 'auto'/'scroll' give the user a way to see it.
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1) {
      bad.push(name + ': ' + el.scrollWidth + 'px of text in ' + el.clientWidth + 'px — "' + text + '"');
    }
    if ((cs.overflowY === 'hidden' || cs.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 1) {
      bad.push(name + ': ' + el.scrollHeight + 'px tall in ' + el.clientHeight + 'px — "' + text + '"');
    }
  }
  return bad;`;

/** Anything painted past the right edge of the viewport. */
const OVERFLOWING = `
  const vw = document.documentElement.clientWidth, bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.right > vw + 1) {
      const name = el.id ? '#' + el.id : el.tagName.toLowerCase()
        + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : '');
      bad.push(name + ': right edge at ' + Math.round(r.right) + 'px, viewport is ' + vw + 'px');
    }
  }
  return bad;`;

/** A <select> too narrow for the option it is showing. */
const TRUNCATED_SELECTS = `
  const bad = [];
  for (const s of document.querySelectorAll('select')) {
    const r = s.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const opt = s.options[s.selectedIndex];
    if (!opt || !opt.text.trim()) continue;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;white-space:pre;font:' + getComputedStyle(s).font;
    probe.textContent = opt.text;
    document.body.appendChild(probe);
    const need = probe.getBoundingClientRect().width;
    probe.remove();
    // ~18px is the dropdown arrow plus padding; below that the text is cut.
    if (need > r.width - 18) {
      bad.push((s.id ? '#' + s.id : 'select.' + s.className) + ': "' + opt.text
        + '" needs ' + Math.round(need) + 'px, control is ' + Math.round(r.width) + 'px');
    }
  }
  return bad;`;

/**
 * SVG text: inside the canvas, not overlapping, and readable against what is
 * actually behind it.
 *
 * The background is the nearest PAINTED SHAPE under the text's centre — a rect,
 * circle, path or polygon — composited onto its own background. Not the <svg>
 * element: `getComputedStyle(svg).fill` returns `rgb(0, 0, 0)` because `fill` is
 * an inherited property with a black initial value, and taking that for a
 * background makes every ratio nonsense. That mistake is why the first version
 * of this check reported zero problems on a page that had them.
 */
const SVG_TEXT = `
  const svg = document.querySelector('.chipwrap svg') || document.querySelector('svg');
  if (!svg) return { error: 'no chip SVG on the page' };

  const parse = s => {
    const m = /rgba?\\(([^)]+)\\)/.exec(String(s || ''));
    if (!m) return null;
    const p = m[1].split(',').map(v => parseFloat(v));
    if (p.length < 3 || p.some(v => !isFinite(v))) return null;
    return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));
  const lum = c => {
    const [r, g, b] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

  const PAINTED = new Set(['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline']);
  function htmlBg(el) {
    let cur = el, stack = [];
    while (cur) {
      const p = parse(getComputedStyle(cur).backgroundColor);
      if (p && p.a > 0) { stack.push(p); if (p.a === 1) break; }
      cur = cur.parentElement;
    }
    let base = [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  }
  function behind(t, x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === t || t.contains(el)) continue;
      const tag = el.tagName.toLowerCase();
      if (PAINTED.has(tag)) {                         // a real SVG shape
        const p = parse(getComputedStyle(el).fill);
        if (p && p.a > 0) return over(p, htmlBg(el.ownerSVGElement || el));
      }
      if (tag === 'svg' || tag === 'g' || tag === 'text') continue;   // NOT backgrounds
      const q = parse(getComputedStyle(el).backgroundColor);
      if (q && q.a > 0) return over(q, htmlBg(el));
    }
    return htmlBg(svg);
  }

  const canvas = (svg.closest('.canvas') || svg.parentElement).getBoundingClientRect();
  const boxes = [], outside = [], low = [], unmeasured = [];
  for (const t of svg.querySelectorAll('text')) {
    const s = (t.textContent || '').trim();
    if (!s) continue;
    const cs = getComputedStyle(t);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = t.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    boxes.push({ s, x: r.left, y: r.top, w: r.width, h: r.height });

    if (r.left < canvas.left - 1 || r.right > canvas.right + 1
        || r.top < canvas.top - 1 || r.bottom > canvas.bottom + 1) {
      outside.push('"' + s + '" at ' + Math.round(r.left) + ',' + Math.round(r.top)
        + ' is outside the chip canvas');
    }

    const fill = parse(cs.fill) || parse(cs.color);
    if (!fill) { unmeasured.push('"' + s + '": fill is "' + cs.fill + '", which is not an rgb() colour'); continue; }
    const bg = behind(t, r.left + r.width / 2, r.top + r.height / 2);
    const fg = over(fill, bg);
    const cr = ratio(fg, bg);
    if (!isFinite(cr)) { unmeasured.push('"' + s + '": contrast came out ' + cr); continue; }
    // WCAG AA for text below 18.66px bold / 24px: 4.5:1.
    if (cr < 4.5) low.push('"' + s + '" is ' + cr.toFixed(2) + ':1 against what is behind it (AA wants 4.5:1)');
  }

  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0.5 && oy > 0.5) {
        overlaps.push('"' + a.s + '" and "' + b.s + '" overlap by ' + ox.toFixed(1) + 'x' + oy.toFixed(1) + 'px');
      }
    }
  }
  return { count: boxes.length, outside, low, overlaps, unmeasured };`;

// ---------------------------------------------------------------- the checks
test('no text anywhere in the chrome is cut off by its own box', async () => {
  if (!browserAvailable()) skip(why);
  const bad = [];
  for (const c of GRID) {
    const found = await withPage(async page => {
      await page.viewport(c.w, c.h, c.z);
      return page.eval(CLIPPED);
    }, { width: c.w, height: c.h, zoom: c.z });
    for (const f of found) bad.push(`${label(c)}  ${f}`);
  }
  report(bad, 'elements whose text does not fit the box that hides its overflow (L1, L3, L5, L6)');
});

test('nothing is painted past the right edge of the viewport, including the clock tree', async () => {
  if (!browserAvailable()) skip(why);
  const bad = [];
  for (const c of GRID) {
    for (const view of ['pinout', 'clock']) {
      const found = await withPage(async page => {
        await page.viewport(c.w, c.h, c.z);
        if (view === 'clock') await page.click('[data-view="clock"]');
        return page.eval(OVERFLOWING);
      }, { width: c.w, height: c.h, zoom: c.z });
      for (const f of found) bad.push(`${label(c)} ${view}  ${f}`);
    }
  }
  report(bad, 'elements running off the right of the viewport (L2)');
});

test('no select is too narrow for the value it is showing', async () => {
  if (!browserAvailable()) skip(why);
  const bad = [];
  for (const c of GRID) {
    const found = await withPage(async page => {
      await page.viewport(c.w, c.h, c.z);
      return page.eval(TRUNCATED_SELECTS);
    }, { width: c.w, height: c.h, zoom: c.z });
    for (const f of found) bad.push(`${label(c)}  ${f}`);
  }
  report(bad, 'selects truncating their own value (L4, L6)');
});

test('every chip label is inside the canvas, legible, and not on top of another', async () => {
  if (!browserAvailable()) skip(why);
  const problems = [];
  for (const theme of ['light', 'dark']) {
    for (const c of [{ w: 1280, h: 720, z: 1 }, { w: 1920, h: 1080, z: 1 }]) {
      const r = await withPage(async page => {
        await page.viewport(c.w, c.h, c.z);
        if (theme === 'dark') {
          await page.eval(`document.documentElement.setAttribute('data-theme', 'dark'); return 1;`);
        }
        return page.eval(SVG_TEXT);
      }, { width: c.w, height: c.h, zoom: c.z });

      const at = label({ ...c, theme });
      if (r.error) { problems.push(`${at}  ${r.error}`); continue; }
      // A measurement that measured nothing is a failure, not a pass.
      if (!r.count) { problems.push(`${at}  the chip SVG has no <text> at all — nothing was measured`); continue; }
      for (const f of r.unmeasured) problems.push(`${at}  UNMEASURED ${f}`);
      for (const f of r.outside) problems.push(`${at}  ${f}`);
      for (const f of r.low) problems.push(`${at}  ${f}`);
      for (const f of r.overlaps) problems.push(`${at}  ${f}`);
    }
  }
  // An UNMEASURED label is never excused: it means the check went blind, which is
  // a different thing from the page being wrong, and it fails whatever C1 says.
  assert.empty(problems.filter(p => p.includes('UNMEASURED')),
    'chip labels the contrast check could not measure — it is blind, not passing');
  report(problems, 'chip labels that are clipped, unreadable or overlapping (L7, L8)');
});

test('the contrast measurement can actually fail', async () => {
  if (!browserAvailable()) skip(why);
  // The check above passed the first time it was written, on a page that had
  // low-contrast labels — because it was reading the <svg> element's inherited
  // `fill` as the background and getting NaN. A contrast check that cannot go
  // red is worse than none, so this plants one and insists it is caught.
  const r = await withPage(async page => {
    await page.eval(`
      const svg = document.querySelector('.chipwrap svg') || document.querySelector('svg');
      const box = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      box.setAttribute('x', 4); box.setAttribute('y', 4);
      box.setAttribute('width', 90); box.setAttribute('height', 20);
      box.setAttribute('fill', '#8a8a8a');
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', 8); t.setAttribute('y', 19);
      t.setAttribute('fill', '#9a9a9a');            // ~1.1:1 on that grey
      t.textContent = 'PLANTED_UNREADABLE';
      svg.appendChild(box); svg.appendChild(t);
      return 1;`);
    return page.eval(SVG_TEXT);
  }, { width: 1280, height: 720 });

  assert.ok(!r.error, `the planted check could not run: ${r.error}`);
  assert.empty(r.unmeasured, 'the planted text could not be measured at all, so the check is blind');
  const caught = (r.low || []).some(s => s.includes('PLANTED_UNREADABLE'));
  assert.ok(caught, 'a deliberately unreadable label (#9a9a9a on #8a8a8a, about 1.1:1) was NOT flagged — '
    + `the contrast check is not measuring anything. It reported: ${JSON.stringify(r.low)}`);
});

test('the clipping and overflow measurements can actually fail', async () => {
  if (!browserAvailable()) skip(why);
  // Same reasoning as the contrast self-test above, and the same history: the
  // contrast check passed on a page that had low-contrast labels because it was
  // measuring the wrong thing. A layout check that cannot go red is not a pass,
  // it is an absence of information wearing a green tick.
  const r = await withPage(async page => {
    await page.eval(`
      const clip = document.createElement('div');
      clip.id = 'PLANTED_CLIP';
      clip.style.cssText = 'width:40px;height:16px;overflow:hidden;white-space:nowrap;font:12px sans-serif';
      clip.textContent = 'this sentence is far too long for forty pixels';
      document.body.appendChild(clip);

      const wide = document.createElement('div');
      wide.id = 'PLANTED_WIDE';
      wide.style.cssText = 'position:absolute;top:0;left:' + (document.documentElement.clientWidth + 40) + 'px;width:120px;height:20px';
      wide.textContent = 'off the right edge';
      document.body.appendChild(wide);
      return 1;`);
    return { clipped: await page.eval(CLIPPED), over: await page.eval(OVERFLOWING) };
  }, { width: 1280, height: 720 });

  assert.ok(r.clipped.some(s => s.includes('PLANTED_CLIP')),
    'a div with 45 characters in 40px of hidden overflow was NOT reported as clipped — '
    + `the clipping check is measuring nothing. It reported: ${JSON.stringify(r.clipped)}`);
  assert.ok(r.over.some(s => s.includes('PLANTED_WIDE')),
    'an element placed past the right edge of the viewport was NOT reported — '
    + `the overflow check is measuring nothing. It reported: ${JSON.stringify(r.over)}`);
});
