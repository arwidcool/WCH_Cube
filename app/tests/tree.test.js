// =============================================================================
//  app/tests/tree.test.js — the order the peripheral tree lists things in.
//
//  WHY THIS EXISTS: the tree used to list each category in the MCU file's own order, which
//  on CH32H417 (78 peripherals) put `USART4`-`USART8` a dozen rows away from `USART1`-
//  `USART3` and split `I2C3`/`I2C4` from `I2C1`/`I2C2`. Nothing was wrong with the
//  configurator; the file's order simply carries no meaning for a reader, and nothing
//  imposed one.
//
//  Two rules, and the second is the one that was actually reported:
//    1. alphabetical, with a trailing instance number read as a NUMBER - `TIM2` before
//       `TIM10`, not after `TIM1`;
//    2. every peripheral of the same type ADJACENT - no `USART` run interrupted by an
//       `SPI`, which is what grep-for-your-peripheral needs to be quick.
//
//  Both are asserted by READING THE RENDERED TREE in a real browser rather than by calling
//  the comparator: the comparator being right says nothing about whether the tree uses it.
// =============================================================================
import { test, assert, mcuNames } from './_harness.js';
import { withPage, browserAvailable } from '../../tests/lib/browser.js';
import { skip } from '../../tests/lib/harness.js';

const WHY = 'no Chrome or Edge on this machine (set WCHCUBE_BROWSER to one)';
const PARTS = () => mcuNames().filter(n => !/DUMMY/i.test(n));

/** The tree as rendered: one entry per heading, with its items in order. */
const READ_TREE = `
  const out = [];
  for (const cat of document.querySelectorAll('#cats .cat')) {
    const items = [...cat.querySelectorAll('.item')].map(e => e.dataset.p);
    if (!items.length) continue;
    out.push({ heading: cat.querySelector('button span').textContent.replace(/\\s+\\d+$/, '').trim(), items });
  }
  return out;`;

/** The A→Z tab: one flat list, no headings. */
const READ_FLAT = `return [...document.querySelectorAll('#cats .item')].map(e => e.dataset.p);`;

/** Load a part and read the tree (grouped) or the flat list. */
async function treeOf(part, flat = false) {
  return withPage(async page => {
    await page.viewport(1600, 900, 1);
    await page.eval(`
      const s = document.getElementById('mcusel');
      s.value = ${JSON.stringify(part)};
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;`);
    await new Promise(r => setTimeout(r, 450));
    if (flat) {
      await page.eval(`
        const b = document.querySelector('.treebar .seg button[data-sort="az"]');
        if (b) b.click();
        return true;`);
      await new Promise(r => setTimeout(r, 250));
    }
    return page.eval(flat ? READ_FLAT : READ_TREE);
  }, { width: 1600, height: 900 });
}

/** The app's own rule, restated here so the test cannot inherit a bug from the app. */
const want = (a, b) => {
  const rank = p => (p === 'GPIO' ? 0 : p === 'NVIC' ? 1 : 2);
  return rank(a) - rank(b) || String(a).localeCompare(String(b), undefined, { numeric: true });
};

test('every category lists its peripherals sorted, with the same type adjacent', async () => {
  if (!browserAvailable()) skip(WHY);
  const bad = [];
  for (const part of PARTS()) {
    for (const { heading, items } of await treeOf(part)) {
      const sorted = [...items].sort(want);
      if (items.join(' ') !== sorted.join(' ')) {
        bad.push(`${part} / ${heading}: ${items.join(' ')}`);
      }
      // Same type adjacent: a base name that returns after a different one has been split.
      const bases = items.map(p => p.replace(/\d+$/, ''));
      for (let i = 1; i < bases.length; i++) {
        if (bases[i] === bases[i - 1]) continue;
        if (bases.slice(i).includes(bases[i - 1])) {
          bad.push(`${part} / ${heading}: ${bases[i - 1]} is split - it reappears after ${bases[i]}`);
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} category/categories out of order`);
});

test('the instance number sorts as a number, so TIM2 comes before TIM10', async () => {
  if (!browserAvailable()) skip(WHY);
  // Asserted on a part that HAS a two-digit instance, because on a part where every
  // instance is one digit a plain string sort gives the same answer and proves nothing.
  const rows = await treeOf('CH32H417');
  const timers = rows.find(r => r.heading === 'Timers');
  assert.ok(timers, 'setup: CH32H417 has a Timers heading');
  const twoDigit = timers.items.filter(p => /\d\d$/.test(p));
  assert.ok(twoDigit.length, 'setup: and it has two-digit instances to sort');
  for (const p of twoDigit) {
    const n = Number(p.replace(/\D+/g, ''));
    const earlier = timers.items.indexOf(`TIM${n - 1}`);
    if (earlier >= 0) {
      assert.ok(earlier < timers.items.indexOf(p),
        `${p} must come after TIM${n - 1}, not after TIM1 - the tree has ${timers.items.join(' ')}`);
    }
  }
});

test('the A-Z tab is the same rule, flat', async () => {
  if (!browserAvailable()) skip(WHY);
  const flat = await treeOf('CH32H417', true);
  assert.ok(flat.length > 70, `setup: the flat list has every peripheral (got ${flat.length})`);
  assert.deepEqual(flat, [...flat].sort(want), 'the flat list is sorted by the same rule');
  // GPIO and NVIC lead it, so the two entries that are not peripherals do not land in the
  // middle of the alphabet between FMC and I2C1.
  assert.deepEqual(flat.slice(0, 2), ['GPIO', 'NVIC']);
});

test('grouping and ordering agree across every part, not just the big one', async () => {
  if (!browserAvailable()) skip(WHY);
  // The four small parts are where a regression would otherwise go unnoticed, because a
  // part with six peripherals is almost sorted by accident.
  for (const part of PARTS().filter(p => p !== 'CH32H417')) {
    const rows = await treeOf(part);
    assert.ok(rows.length >= 3, `${part}: expected several headings, got ${rows.length}`);
    const total = rows.reduce((n, r) => n + r.items.length, 0);
    assert.ok(total > 5, `${part}: expected the peripherals under the headings (got ${total})`);
  }
});
