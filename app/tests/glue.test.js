// The thin layer between the engine and the page: keyboard shortcuts and the menu-bar
// buttons must be the SAME undo implementation. They were two copies until cycle 3, and
// only one of them closed the context menu, so the copies had already drifted.
//
// These run against the built page in jsdom, so they need the DOM driver rather than the
// engine-only harness. AGENT-4: move this into tests/ if you would rather own it.
import { test, assert } from './_harness.js';
import { boot } from '../../tests/lib/app.js';

// Make one undoable engine change and return the pin it touched.
function changeSomething(a) {
  const pin = a.pinNames().find(n => a.ev(`pinType(${JSON.stringify(n)})`) === 'io'
    && !a.ev(`!!E.pins[${JSON.stringify(n)}]`));
  assert.ok(pin, 'no free I/O pin on the default package');
  a.assign(pin, { gpio: 'GPIO_Output' });
  assert.equal(a.pinState(pin), 'set', 'setup: the pin should be assigned now');
  return pin;
}

test('Ctrl+Z undoes through the same path as the Undo button', () => {
  const a = boot();
  try {
    const pin = changeSomething(a);
    assert.equal(a.ev('canUndo()'), true, 'the assignment should be undoable');

    a.key('z', { ctrlKey: true });
    assert.equal(a.pinState(pin), 'unused', 'Ctrl+Z should have released the pin');
    assert.equal(a.ev('canRedo()'), true, 'undo should leave something to redo');

    a.key('y', { ctrlKey: true });
    assert.equal(a.pinState(pin), 'set', 'Ctrl+Y should have put it back');

    // Ctrl+Shift+Z is the other redo spelling
    a.key('z', { ctrlKey: true });
    assert.equal(a.pinState(pin), 'unused');
    a.key('z', { ctrlKey: true, shiftKey: true });
    assert.equal(a.pinState(pin), 'set', 'Ctrl+Shift+Z should redo');

    assert.deepEqual(a.problems(), [], 'no console errors');
  } finally { a.close(); }
});

test('the menu-bar buttons undo and redo exactly what the keyboard does', () => {
  const a = boot();
  try {
    const pin = changeSomething(a);
    const undoBtn = a.ev('document.getElementById("m-undo")');
    const redoBtn = a.ev('document.getElementById("m-redo")');
    assert.ok(undoBtn && redoBtn, 'the menu bar should carry undo and redo buttons');
    assert.equal(a.ev('document.getElementById("m-undo").disabled'), false,
      'Undo must be enabled once there is something to undo');

    a.ev('document.getElementById("m-undo").click()');
    assert.equal(a.pinState(pin), 'unused', 'the Undo button should release the pin');

    a.ev('document.getElementById("m-redo").click()');
    assert.equal(a.pinState(pin), 'set', 'the Redo button should put it back');

    assert.deepEqual(a.problems(), [], 'no console errors');
  } finally { a.close(); }
});

test('undo buttons report what they would undo, and disable when there is nothing', () => {
  const a = boot();
  try {
    assert.equal(a.ev('document.getElementById("m-undo").disabled'), true,
      'a fresh project has nothing to undo');
    assert.equal(a.ev('document.getElementById("m-redo").disabled'), true);

    changeSomething(a);
    const title = a.ev('document.getElementById("m-undo").title');
    assert.match(title, /^Undo .+\(Ctrl\+Z\)$/, 'the button should name the step it would undo');
  } finally { a.close(); }
});

test('typing in a field is never hijacked by the undo shortcut', () => {
  const a = boot();
  try {
    const pin = changeSomething(a);
    // focus a text input, as the user-label editor does, then press Ctrl+Z in it
    a.ev(`(() => {
      const i = document.getElementById('pin-search');
      i.focus();
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    })()`);
    assert.equal(a.pinState(pin), 'set',
      'Ctrl+Z inside an input belongs to the input, not to the pin configuration');
  } finally { a.close(); }
});
