// QA test harness (tests/).  AGENT-2's engine units use app/tests/_harness.js instead;
// tests/run.js collects from both registries, so the two can coexist.
export const REG = [];
let current = null;

/** Optional sub-grouping inside a file. */
export function suite(name) { current = name; }

export function test(name, fn) { REG.push({ suite: current, name, fn }); }

export class AssertionError extends Error {}

/**
 * Thrown by skip(): "this check did not run, and here is why."
 *
 * A skip is NOT a pass. The runner counts skips separately, prints the reason
 * on the line, and repeats the total in the summary — because a compile check
 * that quietly did nothing is exactly how "the generated C compiles" was
 * asserted for a whole round without anyone compiling it.
 */
export class SkipError extends Error {
  constructor(reason) { super(reason); this.name = 'SkipError'; }
}

/** Abandon the current test with a printed reason. Never call it on a failure. */
export function skip(reason) { throw new SkipError(reason); }

function fail(msg) { throw new AssertionError(msg); }

const fmt = v => {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v instanceof Set) return 'Set(' + [...v].join(', ') + ')';
  try { return JSON.stringify(v); } catch { return String(v); }
};

export const assert = {
  ok(v, msg) { if (!v) fail(msg || `expected truthy, got ${fmt(v)}`); },
  notOk(v, msg) { if (v) fail(msg || `expected falsy, got ${fmt(v)}`); },
  equal(a, b, msg) {
    if (a !== b) fail((msg ? msg + '\n' : '') + `    expected ${fmt(b)}\n    actual   ${fmt(a)}`);
  },
  notEqual(a, b, msg) { if (a === b) fail(msg || `expected something other than ${fmt(b)}`); },
  deep(a, b, msg) {
    const x = JSON.stringify(a), y = JSON.stringify(b);
    if (x !== y) fail((msg ? msg + '\n' : '') + `    expected ${y}\n    actual   ${x}`);
  },
  includes(hay, needle, msg) {
    if (!hay || !hay.includes(needle)) fail(msg || `expected ${fmt(hay)} to include ${fmt(needle)}`);
  },
  match(str, re, msg) { if (!re.test(str)) fail(msg || `expected ${fmt(str)} to match ${re}`); },
  throws(fn, msg) { try { fn(); } catch { return; } fail(msg || 'expected function to throw'); },
  close(a, b, tol, msg) {
    if (!(Math.abs(a - b) <= tol)) fail(msg || `expected ${a} to be within ${tol} of ${b}`);
  },
  /**
   * Fail once listing every problem found, instead of stopping at the first.
   * Data/consistency checks are far more useful this way.
   */
  empty(list, msg) {
    if (!list || !list.length) return;
    const shown = list.slice(0, 40).map(s => '      - ' + s).join('\n');
    fail(`${msg} (${list.length})\n${shown}` + (list.length > 40 ? `\n      ... and ${list.length - 40} more` : ''));
  },
};
