// tests/keyboard_ui.test.js — arrow-key focus, Enter and Delete, in a REAL browser.
//
// The real-browser sibling `tests/evidence/round6/2026-09-13-gates-without-a-plant.md`
// said was needed before this could be planted: `app/tests`'s `features.test.js` has
// jsdom siblings of these three keys, and the objection on record was that a plant there
// "would test jsdom's key-event plumbing, not the app". That objection does not apply
// here — these dispatch a real `KeyboardEvent` at `window` inside an actual Chrome/Edge
// tab over the DevTools Protocol (`tests/lib/browser.js`), the exact way
// `tests/newproject.test.js`/`tests/clock_ui.test.js` already drive real UI. The app's
// own `keydown` listener (`window.addEventListener('keydown', ...)`) cannot tell a
// dispatched event from an operator's keypress; only the INPUT SOURCE was ever jsdom's,
// and this file removes it.
//
// Two real checks, then the planted break for each — mutate a COPY of dist/index.html
// (the tree is never touched; `withMutantDist` refuses a moved anchor), drive the SAME
// interaction, and watch the SAME behaviour the positive test asserts actually break.
import { test, assert, suite } from './lib/harness.js';
import { withPage, browserAvailable } from './lib/browser.js';
import { withMutantDist } from './lib/mutant.js';

suite('keyboard navigation (real browser)');

const NO_BROWSER = 'no Chrome or Edge on this machine — real-browser checks skipped';
const key = k => `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true })); return true;`;

test('arrow keys move the focus from pin to pin', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    const before = await page.eval('return U.focus');
    assert.equal(before, null, 'nothing should be focused before a key is pressed');

    await page.eval(key('ArrowDown'));
    const first = await page.eval('return U.focus');
    assert.ok(first, 'the first ArrowDown did not focus a pin');
    assert.ok(await page.eval("return !!document.querySelector('#svg .pin.focused')"),
      'the focused pin is not marked .focused in the drawing');

    const seen = new Set([first]);
    for (const k of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft']) {
      await page.eval(key(k));
      const now = await page.eval('return U.focus');
      assert.ok(now, `${k} lost the focus`);
      seen.add(now);
    }
    assert.ok(seen.size > 1, 'the focus never actually moved');
    assert.deep(page.problems(), [], 'keyboard navigation logged console problems');
  });
});

test('Enter opens the picker on the focused pin and Delete clears it', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  await withPage(async page => {
    const pin = await page.eval("return Object.keys(M.pins).find(p => pinType(p) === 'io')");
    assert.ok(pin, 'no I/O pin on the default package');

    await page.eval(`assignSignal(${JSON.stringify(pin)}, { gpio: 'GPIO_Output' }); renderAll(); return true;`);
    assert.equal(await page.eval(`return (E.pins[canon(${JSON.stringify(pin)})] || {}).state`), 'set',
      'setup: assignSignal() did not set the pin');

    await page.eval(`U.focus = ${JSON.stringify(pin)}; return true;`);
    await page.eval(key('Enter'));
    assert.ok(await page.eval("return !!document.querySelector('#picker')"),
      'Enter did not open the picker on the focused pin');
    // Close it the way Escape/an outside click would, so Delete below is not swallowed by it.
    await page.eval('closePicker(); return true;');

    await page.eval(key('Delete'));
    // An unclaimed pin has NO entry in E.pins at all - pinState() (tests/lib/app.js) falls
    // back to 'unused' for exactly that reason, so this reads the state the same way.
    assert.equal(await page.eval(`return (E.pins[canon(${JSON.stringify(pin)})] || {}).state || 'unused'`), 'unused',
      'Delete did not clear the focused pin');
    assert.deep(page.problems(), [], 'Enter/Delete logged console problems');
  });
});

test('planted break: emptying ARROWS stops arrow keys from moving the focus', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  const m = withMutantDist(
    "const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };",
    "const ARROWS = {};");
  assert.notOk(m.error, m.error || '');
  await withPage(async page => {
    await page.eval(key('ArrowDown'));
    const focus = await page.eval('return U.focus');
    assert.equal(focus, null,
      `ArrowDown moved the focus to ${focus} with ARROWS emptied — the plant did not take`);
    console.log('      planted refusal (keyboard): ArrowDown moves no focus once ARROWS is emptied');
  }, { url: m.file });
});

test('planted break: neutering the Delete branch leaves the focused pin set', async () => {
  if (!browserAvailable()) return assert.ok(true, NO_BROWSER);
  const m = withMutantDist(
    "if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); resetPin(U.focus); renderAll(); toast(`${U.focus} reset`); return; }",
    "if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); renderAll(); toast(`${U.focus} reset`); return; }");
  assert.notOk(m.error, m.error || '');
  await withPage(async page => {
    const pin = await page.eval("return Object.keys(M.pins).find(p => pinType(p) === 'io')");
    await page.eval(`assignSignal(${JSON.stringify(pin)}, { gpio: 'GPIO_Output' }); U.focus = ${JSON.stringify(pin)}; renderAll(); return true;`);
    const before = await page.eval(`return (E.pins[canon(${JSON.stringify(pin)})] || {}).state`);
    assert.equal(before, 'set', 'setup: the pin should be set before pressing Delete');

    await page.eval(key('Delete'));
    const after = await page.eval(`return (E.pins[canon(${JSON.stringify(pin)})] || {}).state`);
    assert.equal(after, 'set',
      `Delete still cleared ${pin} (now "${after}") with resetPin() neutered — the plant did not take`);
    console.log(`      planted refusal (keyboard): Delete leaves ${pin} set once resetPin() is neutered`);
  }, { url: m.file });
});
