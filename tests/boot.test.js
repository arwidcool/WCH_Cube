// The boot test AGENT-3 asked for (BOARD 01:08Z): open dist/index.html and prove the app
// came up, rather than inferring it from a silent console.
//
// One correction to the request: `window.M` is undefined and always will be. The bundle is
// ONE classic script, and a top-level `let`/`const` there lives in the global lexical
// environment, not on `window` - only function declarations become window properties. So
// `window.M` is not a boot signal; the model is reached by evaluating `M` in global scope,
// which is exactly what a devtools console does, and what a.ev('M') does here.
import { suite, test, assert } from './lib/harness.js';
import { boot } from './lib/app.js';

suite('boot');

test('the app has a parsed MCU, a state and an engine result after loading', () => {
  const a = boot();
  try {
    const M = a.ev('M');
    assert.ok(M, 'no MCU is loaded after boot');
    assert.ok(M.mcu && M.mcu.name, 'the loaded MCU has no name');
    assert.ok(M._pinSignals, 'the derived pin-signal map is missing - deriveMcu did not run');
    assert.ok(M._phys && M._phys[a.ev('S.pkg')], 'the physical pin map for the selected package is missing');

    const S = a.ev('S');
    assert.ok(S, 'no state after boot');
    assert.ok(S.pkg in M.packages, `the selected package ${S.pkg} is not one of this MCU's`);
    assert.ok(S.periph && Object.keys(S.periph).length, 'no peripheral state was initialised');

    const E = a.ev('E');
    assert.ok(E, 'compute() never ran - there is no engine result');
    assert.ok(E.pins && E.status, 'the engine result is missing pins or status');
  } finally { a.close(); }
});

test('the page is painted: chrome, a chip with pins, and a peripheral tree', () => {
  const a = boot();
  try {
    assert.ok(a.document.querySelector('.app'), 'the app shell is not in the document');
    assert.ok(a.pinEls().length > 0, 'no pins were drawn');
    assert.ok(a.document.querySelectorAll('#cats .item').length > 0, 'the peripheral tree is empty');
    assert.ok(a.document.getElementById('svg').childNodes.length > 0, 'the chip SVG is empty');
    assert.equal(a.document.title.includes(a.ev('M.mcu.name')), true, 'the window title does not name the part');
  } finally { a.close(); }
});

test('booting is silent - no console output of any kind', () => {
  const a = boot();
  try {
    assert.empty(a.problems(), 'the app wrote to the console while starting up');
  } finally { a.close(); }
});

test('window.M is deliberately not a thing, so nobody writes a test against it', () => {
  const a = boot();
  try {
    assert.equal(a.window.M, undefined,
      'window.M now exists. If the engine started exporting a debug handle that is fine - ' +
      'update this test and tell AGENT-3, who asked for window.M as the boot signal.');
    assert.ok(a.ev('M'), 'the model must still be reachable by evaluating M in global scope');
  } finally { a.close(); }
});
