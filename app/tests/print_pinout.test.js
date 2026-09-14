// The print view — §7 P2's last item, and the one held under a strict condition all
// cycle: take it ONLY if it genuinely reuses `pinoutSvg()`'s own renderer. This file's
// whole job is proving that condition held, not merely that a Print button exists.
//
// A THIRD renderer that has to agree with the live canvas (`renderChip()`/`exportSvg()`)
// and the headless `pinoutSvg()` (`app/engine/export.js`) would be one more instance of
// the exact pattern this cycle spent finding divergences in: `paramTable()`/
// `paramTableFrom()` (one never read `sdk_note`), `rccSection()`/`clockSummaryMarkdown()`
// (one printed `[object Object]`). `printPinout()` (app/template.html) does not render
// anything itself — it drops `pinoutSvg()`'s own text, already sitting in the Project
// Manager's file list, into `#print-pinout` unmodified.
import { test, assert, fresh } from './_harness.js';
import { boot } from '../../tests/lib/app.js';

test('Print is offered for the pinout SVG alone, and its output IS pinoutSvg()\'s own — not a re-render', () => {
  const a = boot();
  try {
    a.ev(`openMcu(MCU_FILES['CH32H417']); setPackage('QFN128')`);
    a.ev(`document.querySelector('[data-view="pm"]').click(); renderAll(true)`);
    const files = a.ev('projectFiles().map(f => f.path)');
    const svgPath = files.find(p => /_pinout\.svg$/.test(p));
    const cPath = files.find(p => p.endsWith('main.c'));
    assert.ok(svgPath && cPath, 'setup: both files exist in the project');

    // Every OTHER generated file - text, not an image - offers no Print at all.
    a.ev(`PM.pick = ${JSON.stringify(cPath)}; renderProjectManager()`);
    assert.equal(a.ev(`!!document.getElementById('pm-print')`), false,
      'main.c is not an image - Print would have nothing honest to show');

    a.ev(`PM.pick = ${JSON.stringify(svgPath)}; renderProjectManager()`);
    assert.equal(a.ev(`!!document.getElementById('pm-print')`), true, 'the pinout SVG offers Print');

    // Hidden on the ordinary screen render - it only appears under @media print.
    assert.equal(a.ev(`getComputedStyle(document.getElementById('print-pinout')).display`), 'none');

    a.ev(`document.getElementById('pm-print').click()`);
    const injectedSvg = a.ev(`document.querySelector('#print-pinout svg').outerHTML`);
    // pinoutSvg()'s raw text, parsed through the SAME DOM the button itself uses, so the
    // comparison is immune to how the HTML parser reformats a stray XML prolog - this
    // proves the injected markup is the identical element pinoutSvg() built, not two
    // strings that happen to look alike.
    const referenceSvg = a.ev(`(() => { const d = document.createElement('div'); ` +
      `d.innerHTML = pinoutSvg(); return d.querySelector('svg').outerHTML; })()`);
    assert.equal(injectedSvg, referenceSvg, "Print shows EXACTLY pinoutSvg()'s own output, not a second renderer");
    assert.match(a.ev(`document.getElementById('print-pinout').querySelector('h1').textContent`),
      /CH32H417/, 'the printed sheet says which part and package it is');
    assert.deepEqual(a.problems(), []);
  } finally { a.close(); }
});

test('calling window.print() never throws into the page, even where it is a stub that does nothing', () => {
  const a = boot();
  try {
    a.ev(`openMcu(MCU_FILES['CH32H417']); setPackage('QFN128')`);
    const svgPath = a.ev(`projectFiles().find(f => /_pinout\\.svg$/.test(f.path)).path`);
    a.ev(`document.querySelector('[data-view="pm"]').click(); renderAll(true); ` +
      `PM.pick = ${JSON.stringify(svgPath)}; renderProjectManager()`);
    // jsdom DOES define window.print (recent versions) but it is not a real printer -
    // calling it logs the "Not implemented" jsdomError tests/lib/app.js already filters
    // as noise, never throws into the page. printPinout()'s own guard
    // (`typeof window.print === 'function'`) is exercised for real here, not skipped.
    assert.equal(typeof a.ev('window.print'), 'function', 'setup: this jsdom version stubs print()');
    a.ev(`document.getElementById('pm-print').click()`);
    assert.deepEqual(a.problems(), [], 'no uncaught exception reaches the page from calling print()');
    assert.ok(a.ev(`document.getElementById('print-pinout').innerHTML.length`) > 0,
      'the content is filled in either way - print() is the very last step, not a precondition for it');
  } finally { a.close(); }
});
