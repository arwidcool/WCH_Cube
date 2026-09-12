// =============================================================================
//  app/tests/layout.test.js — the panels' own grids, measured in a real browser.
//
//  WHY THIS EXISTS, and it is a gate hole rather than a precaution. `#mode` is a
//  two-column grid (`max-content 1fr`) that fills its cells IN ORDER: a full-width block
//  left without `grid-column:1/-1` does not merely sit in the wrong place, it SHIFTS
//  EVERY PAIR AFTER IT BY ONE CELL, so each label lands in the control column and each
//  control in the label column. Measured on CH32H417 at 1600 px, panel 563 px, with the
//  peripheral intro unspanned: `grid-template-columns` computed to `746.234px 69.1px`
//  for USART1 and to `1e+06px 99.45px` for PWR - the second because column 1 is
//  `max-content` and a paragraph of prose has no intrinsic width limit, so the column
//  took a MILLION pixels and pushed every label off the panel.
//
//  `tests/legibility.test.js` did not catch it, and the reason is in its own comment: it
//  only reports clipping when `overflowX` is `hidden` or `clip`, on the grounds that
//  `auto`/`scroll` "give the user a way to see it". `#mode` is `overflow:auto`, so a
//  panel five times too wide is excused - and its other check ("nothing painted past the
//  right edge of the viewport") passes too, because the panel scrolls rather than
//  overflowing the page. Both were run green with the bug present. That excuse is sound
//  for a table a little wider than its box and wrong for a layout that is structurally
//  mis-sized, so this file asks the question both of those miss: does a scroll
//  container's CONTENT fit it, and did a full-width block actually take both columns?
//
//  It is in app/tests/ because the panel is the app's, and it is a browser test because
//  jsdom has no layout engine - every box is 0x0 and nothing would measure anything. It
//  SKIPS with a printed reason when no browser is present, like the legibility suite.
// =============================================================================
import { test, assert, mcuNames } from './_harness.js';
import { withPage, browserAvailable } from '../../tests/lib/browser.js';
import { skip } from '../../tests/lib/harness.js';

const WHY = 'no Chrome or Edge on this machine (set WCHCUBE_BROWSER to one)';
const PARTS = () => mcuNames().filter(n => !/DUMMY/i.test(n));

/**
 * Walk EVERY peripheral of the loaded part and report, for each, any element that
 * scrolls in one axis with content that does not fit it, plus any child of `#mode` that
 * is in neither of its two columns.
 *
 * Clicking a tree item is synchronous (`S.sel = pid; renderAll()`), so this is one
 * round-trip per part rather than one per peripheral - 78 peripherals over the wire would
 * have made the suite unusable, and an `await` inside the page is not available because
 * `page.eval` wraps the body in a non-async arrow.
 */
const SCAN = `
  const hits = [];
  const pids = Object.keys(M.peripherals).concat(['GPIO', 'NVIC']);
  for (const pid of pids) {
    const it = document.querySelector('.item[data-p="' + pid + '"]');
    if (!it) continue;
    it.click();

    // 1. a GRID whose own columns do not fit it. This is the structural failure, and it
    //    is deliberately not the general "nothing may scroll sideways" rule: a data table
    //    with six columns inside a narrower panel is SUPPOSED to scroll, and flagging it
    //    would mean adding an exception for every table in the app. What cannot be
    //    legitimate is a grid whose declared columns exceed the box it draws them in -
    //    that is the layout being wrong, not the content being wide.
    for (const el of document.querySelectorAll('*')) {
      if (el.closest('svg')) continue;
      const cs = getComputedStyle(el);
      if (cs.display !== 'grid' && cs.display !== 'inline-grid') continue;
      if (cs.visibility === 'hidden') continue;
      const padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
      const contentW = el.clientWidth - padL - padR;
      if (contentW < 40) continue;
      const cols = cs.gridTemplateColumns.split(' ').map(parseFloat).filter(Number.isFinite);
      if (!cols.length) continue;
      const gapX = parseFloat(cs.columnGap) || 0;
      const want = cols.reduce((a, b) => a + b, 0) + gapX * (cols.length - 1);
      if (want <= contentW + 2) continue;
      const name = el.id ? '#' + el.id : el.tagName.toLowerCase()
        + (typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\\s+/)[0] : '');
      hits.push({ pid: pid, kind: 'grid', who: name, over: Math.round(want - contentW),
        detail: 'columns want ' + Math.round(want) + 'px in a ' + Math.round(contentW)
          + 'px content box [' + cols.map(Math.round).join(', ') + ']' });
    }

    // 2. where each child of the mode panel landed
    const mode = document.getElementById('mode');
    const cs2 = getComputedStyle(mode);
    if (cs2.display === 'grid' && mode.children.length) {
      const box = mode.getBoundingClientRect();
      const padL = parseFloat(cs2.paddingLeft) || 0;
      const padR = parseFloat(cs2.paddingRight) || 0;
      const gapX = parseFloat(cs2.columnGap) || 0;
      const inner = mode.clientWidth - padL - padR;      // the CONTENT box, not clientWidth
      const cols = cs2.gridTemplateColumns.split(' ').map(parseFloat);
      const col2 = (cols[0] || 0) + gapX;
      if (Number.isFinite(cols[0]) && cols[0] > inner) {
        hits.push({ pid: pid, kind: 'column', who: '#mode', over: 0,
          detail: 'column 1 is ' + Math.round(cols[0]) + 'px inside a ' + Math.round(inner) + 'px content box' });
      }
      for (const el of mode.children) {
        const own = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const x = Math.round(r.left - box.left - padL);
        const tag = el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\\s+/)[0] : '');
        if (own.gridColumnEnd === '-1') {                  // claims both columns
          if (r.width < inner - 2) {
            hits.push({ pid: pid, kind: 'span', who: tag, over: 0,
              detail: 'declares grid-column 1/-1 but is ' + Math.round(r.width) + 'px of ' + Math.round(inner) + 'px' });
          }
          continue;
        }
        const in1 = Math.abs(x) <= 2;
        const in2 = Number.isFinite(col2) && Math.abs(x - col2) <= 2;
        if (!in1 && !in2) {
          hits.push({ pid: pid, kind: 'cell', who: tag, over: 0,
            detail: 'at x=' + x + ', in neither column (col1 at 0, col2 at ' + Math.round(col2) + ')' });
        }
      }
    }
  }
  return hits;`;

/** One part, all its peripherals, plus any console noise seen while doing it. */
function scan(part) {
  return withPage(async page => {
    await page.viewport(1600, 900, 1);
    await page.eval(`
      const s = document.getElementById('mcusel');
      if (s) { s.value = ${JSON.stringify(part)}; s.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;`);
    await new Promise(r => setTimeout(r, 500));
    const hits = await page.eval(SCAN);
    return { hits, problems: page.problems() };
  }, { width: 1600, height: 900 });
}

test('no grid panel on any part declares columns wider than its own content box', async () => {
  if (!browserAvailable()) skip(WHY);
  const bad = [];
  for (const part of PARTS()) {
    const { hits, problems } = await scan(part);
    for (const h of hits.filter(x => x.kind === 'grid' || x.kind === 'column')) {
      bad.push(`${part} ${h.pid}: ${h.who} ${h.detail}`);
    }
    for (const p of problems) bad.push(`${part}: console ${p}`);
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} grid(s) wider than the box they draw in`);
});

test('every child of the mode panel is in a column that exists, and a full-width block fills it', async () => {
  if (!browserAvailable()) skip(WHY);
  const bad = [];
  for (const part of PARTS()) {
    const { hits, problems } = await scan(part);
    for (const h of hits.filter(x => x.kind === 'span' || x.kind === 'cell')) {
      bad.push(`${part} ${h.pid}: ${h.who} ${h.detail}`);
    }
    for (const p of problems) bad.push(`${part}: console ${p}`);
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} misplaced cell(s) in the mode panel`);
});
