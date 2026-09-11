#!/usr/bin/env node
// =============================================================================
//  tools/capture_docs_images.js — regenerate the screenshots in docs/images/.
//
//  Documentation images go stale silently. This regenerates them from the
//  BUILT app, so what a reader sees in the docs is what the app actually draws
//  — no hand-taken screenshots that were true once.
//
//      node tools/capture_docs_images.js           # write docs/images/*.png
//      node tools/capture_docs_images.js --list    # what it would capture
//
//  It uses `tests/lib/browser.js`, which drives the real Chrome or Edge on this
//  machine over the DevTools Protocol with zero npm dependencies — the same
//  driver the QA suites use, so a screenshot here is the same evidence a test
//  would produce. Skips loudly with a printed reason when no browser is present
//  (a CI container), because a silent skip is how "verified" becomes a lie.
//
//  Run `python build.py` first: it captures dist/index.html, not app/.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPage, browserAvailable, browserPath, closeBrowser, DIST } from '../tests/lib/browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'docs', 'images');

/**
 * One entry per image. `setup` runs in the page with the engine's own API, so
 * every screenshot is a real configuration a user could build — never a hand-
 * placed DOM state that the app could not reach.
 */
const SHOTS = [
  {
    file: 'app-pinout.png',
    viewport: [1280, 720],
    what: 'Pinout & Configuration, CH32V006 on TSSOP20, USART1 + SPI1 assigned and one labelled output',
    setup: `
      assignSignal('PD4', { gpio: 'GPIO_Output' });
      setGpioField('PD4', 'label', 'STATUS_LED');
      setSetting('USART1', 'Mode', 'Asynchronous');
      setSetting('SPI1', 'Mode', 'Full-Duplex Master');
      renderAll(true);
      return 1;`,
  },
  {
    file: 'app-clock.png',
    viewport: [1440, 720],
    what: 'Clock Configuration — the tree drawn from the MCU file, every frequency live',
    setup: `
      document.querySelector('[data-view="clock"]').click();
      return 1;`,
    settleMs: 1800,
    after: `if (typeof renderClock === 'function') renderClock(); return 1;`,
  },
  {
    file: 'app-project.png',
    viewport: [1280, 720],
    what: 'Project Manager — the whole project it will write, previewed file by file',
    setup: `
      document.querySelector('[data-view="pm"]').click();
      return 1;`,
    settleMs: 900,
  },
  {
    file: 'app-newproject.png',
    viewport: [1440, 860],
    what: 'New Project — one searchable catalogue of every part number in every MCU file',
    setup: `
      openNewProject();
      return 1;`,
    settleMs: 900,
  },
  {
    file: 'app-conflict.png',
    viewport: [1280, 720],
    what: 'A collision: a GPIO output on a pin USART1 already claimed, caught before export',
    // USART1 Asynchronous claims PD5 (TX) and PD6 (RX) out of the remap table. Then
    // the user points a manual GPIO output at PD5, which is the ordinary way a
    // conflict happens. `expect` below is what stops this image from silently
    // becoming a picture of a NON-conflict — which is exactly what the first
    // version of this tool captured, with the words "A collision" under it.
    setup: `
      setSetting('USART1', 'Mode', 'Asynchronous');
      assignSignal('PD5', { gpio: 'GPIO_Output' });
      renderAll(true);
      return 1;`,
    expect: 'return E.conflictList.length > 0',
    settleMs: 700,
  },
];

const list = process.argv.includes('--list');

if (!browserAvailable()) {
  console.error('capture_docs_images: no Chrome or Edge found on this machine.');
  console.error('  Looked for:');
  console.error('    C:/Program Files/Google/Chrome/Application/chrome.exe');
  console.error('    C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
  console.error('  Set WCHCUBE_BROWSER=<path to chrome.exe> to point at one.');
  console.error('  Nothing was written; the existing docs/images/ are untouched.');
  process.exit(0);   // a skip, not a failure: this is a docs tool, not a gate
}

if (!fs.existsSync(DIST)) {
  console.error(`capture_docs_images: ${path.relative(ROOT, DIST)} is missing — run "python build.py" first.`);
  process.exit(1);
}

if (list) {
  for (const s of SHOTS) console.log(`${s.file.padEnd(24)} ${s.viewport[0]}x${s.viewport[1]}  ${s.what}`);
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
console.log(`capture_docs_images: browser ${browserPath()}`);
console.log(`capture_docs_images: writing to ${path.relative(ROOT, OUT)}/`);

let failed = 0;
for (const shot of SHOTS) {
  const [w, h] = shot.viewport;
  try {
    await withPage(async page => {
      // A FRESH page per shot, and the viewport is set before the first paint:
      // the clock tree measures its container once, when the tab activates, so a
      // viewport change after load leaves it laid out for the old width.
      await page.goto(DIST, { settleMs: 700 });
      await page.viewport(w, h, 1);
      await page.eval(shot.setup);
      await new Promise(r => setTimeout(r, shot.settleMs || 400));
      if (shot.after) await page.eval(shot.after);
      if (shot.after) await new Promise(r => setTimeout(r, 600));

      // A screenshot that does not show what its caption claims is worse than no
      // screenshot: it is a lie with a picture behind it. So a shot that names a
      // condition has to satisfy it before the file is written.
      if (shot.expect && !(await page.eval(shot.expect))) {
        throw new Error(`the page does not satisfy "${shot.expect}" — refusing to write a mislabelled image`);
      }

      const problems = page.problems();
      if (problems.length) {
        console.error(`  ! ${shot.file}: the app wrote to the console:`);
        for (const p of problems.slice(0, 4)) console.error(`      ${p}`);
      }
      await page.screenshot(path.join(OUT, shot.file));
      const kb = (fs.statSync(path.join(OUT, shot.file)).size / 1024).toFixed(0);
      console.log(`  ${shot.file.padEnd(24)} ${w}x${h}  ${kb} KB  ${shot.what}`);
    }, { goto: false });
  } catch (e) {
    failed++;
    console.error(`  x ${shot.file}: ${e.message}`);
  }
}

await closeBrowser();
console.log(failed ? `capture_docs_images: ${failed} failed` : 'capture_docs_images: done');
process.exit(failed ? 1 : 0);
