// Tiny zero-dependency test harness.  Test files call test()/suite(); tests/run.js executes them.
const REG = [];
let current = '(root)';

function suite(name) { current = name; }
function test(name, fn) { REG.push({ suite: current, name, fn }); }

class AssertionError extends Error {}
function fail(msg) { throw new AssertionError(msg); }

const fmt = v => {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v instanceof Set) return 'Set(' + [...v].join(',') + ')';
  try { return JSON.stringify(v); } catch { return String(v); }
};

const assert = {
  ok(v, msg) { if (!v) fail(msg || `expected truthy, got ${fmt(v)}`); },
  notOk(v, msg) { if (v) fail(msg || `expected falsy, got ${fmt(v)}`); },
  equal(a, b, msg) { if (a !== b) fail(msg ? `${msg}\n    expected ${fmt(b)}\n    actual   ${fmt(a)}` : `expected ${fmt(b)}, got ${fmt(a)}`); },
  notEqual(a, b, msg) { if (a === b) fail(msg || `expected something other than ${fmt(b)}`); },
  deep(a, b, msg) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) fail(msg ? `${msg}\n    expected ${y}\n    actual   ${x}` : `expected ${y}, got ${x}`); },
  includes(hay, needle, msg) { if (!hay || !hay.includes(needle)) fail(msg || `expected ${fmt(hay)} to include ${fmt(needle)}`); },
  match(str, re, msg) { if (!re.test(str)) fail(msg || `expected ${fmt(str)} to match ${re}`); },
  throws(fn, msg) { try { fn(); } catch { return; } fail(msg || 'expected function to throw'); },
  // Collect many problems and fail once with all of them — much better than failing on the first.
  empty(list, msg) {
    if (!list || !list.length) return;
    const shown = list.slice(0, 40).map(s => '      - ' + s).join('\n');
    fail(`${msg} (${list.length})\n${shown}${list.length > 40 ? `\n      … and ${list.length - 40} more` : ''}`);
  },
};

module.exports = { suite, test, assert, AssertionError, REG };
