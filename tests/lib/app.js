// Boot dist/index.html headlessly in jsdom and hand back a driver for it.
//
// The app is one classic <script>: function declarations land on window, but top-level
// let bindings (M, S, E, geom, U...) do NOT.  window.eval() runs in global scope and can
// see them, so `a.ev('S.pkg')` is how tests read engine state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dep, resolveDep } from './deps.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const DIST = path.join(ROOT, 'dist', 'index.html');

// jsdom has no layout engine: clientWidth/clientHeight are 0, which makes fitChip()
// compute zoom 0.  Pretend the canvas has a real size so the render path is exercised
// with realistic numbers.
export const VIEWPORT = { width: 1280, height: 720 };

const CDN_YAML = /<script[^>]+cdnjs[^>]+js-yaml[^>]*>\s*<\/script>/i;

/** Sleep without async, so sync readers can retry. */
function nap(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best effort */ }
}

export function readDist() {
  if (!fs.existsSync(DIST)) throw new Error('dist/index.html missing - run "python build.py" first');
  // Four agents share this tree: a build may be writing dist/index.html right now, so a
  // read can land on a half-written file. Retry until it looks like a whole document.
  let html = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    html = fs.readFileSync(DIST, 'utf8');
    if (html.includes('</html>')) break;
    nap(60);
  }
  if (!html.includes('</html>')) throw new Error('dist/index.html is incomplete - a build is probably still running');
  // Offline: swap the CDN js-yaml tag for the vendored copy (or node_modules') if it is still there.
  if (CDN_YAML.test(html)) {
    const vendored = path.join(ROOT, 'app', 'vendor', 'js-yaml.js');
    const lib = fs.existsSync(vendored)
      ? fs.readFileSync(vendored, 'utf8')
      : fs.readFileSync(resolveDep('js-yaml/dist/js-yaml.js'), 'utf8');
    html = html.replace(CDN_YAML, '<script>/* test: vendored js-yaml */\n' + lib + '\n</script>');
  }
  return html;
}

/** True once AGENT-2's offline wiring has landed (no CDN tag in the built file). */
export function distIsOffline() {
  return !CDN_YAML.test(fs.readFileSync(DIST, 'utf8'));
}

export function boot(options) {
  const opts = options || {};
  const viewport = opts.viewport || VIEWPORT;
  const { JSDOM, VirtualConsole } = dep('jsdom');
  const errors = [];   // every console.error / warn / uncaught exception / jsdom error

  const vc = new VirtualConsole();
  for (const level of ['error', 'warn']) {
    vc.on(level, function () {
      errors.push({ level, text: Array.from(arguments).map(String).join(' ') });
    });
  }
  vc.on('jsdomError', e => {
    // "Not implemented" noise from unimplemented layout APIs is not an app bug; everything else is.
    if (/Not implemented/i.test(e.message)) return;
    errors.push({ level: 'jsdomError', text: e.message + (e.detail ? '\n' + (e.detail.stack || e.detail) : '') });
  });

  const dom = new JSDOM(opts.html || readDist(), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: vc,
    beforeParse(win) {
      // --- APIs jsdom does not implement but the app uses ---
      win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      win.URL.createObjectURL = () => 'blob:test';
      win.URL.revokeObjectURL = () => {};
      win.alert = msg => errors.push({ level: 'alert', text: String(msg) });
      win.confirm = () => true;
      win.scrollTo = () => {};
      win.HTMLElement.prototype.scrollIntoView = function () {};
      Object.defineProperty(win.navigator, 'clipboard', {
        value: { writeText: () => Promise.resolve() }, configurable: true,
      });
      // --- fake layout so fitChip()/zoom maths get real numbers ---
      Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => viewport.width });
      Object.defineProperty(win.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => viewport.height });
      win.Element.prototype.getBoundingClientRect = function () {
        return {
          x: 0, y: 0, top: 0, left: 0, right: viewport.width, bottom: viewport.height,
          width: viewport.width, height: viewport.height, toJSON() { return this; },
        };
      };
      // Globals a test wants in place BEFORE any page script runs (e.g. a fake window.__TAURI__,
      // which the injected desktop bridge checks for at parse time).
      for (const [k, v] of Object.entries(opts.globals || {})) win[k] = v;
      win.addEventListener('error', e => errors.push({ level: 'uncaught', text: (e.error && e.error.stack) || e.message }));
      win.addEventListener('unhandledrejection', e => errors.push({ level: 'rejection', text: String((e.reason && e.reason.stack) || e.reason) }));
    },
  });

  const win = dom.window, doc = win.document;
  const ev = expr => win.eval(expr);
  const q = name => doc.querySelector('#svg .pin[data-pin="' + String(name).replace(/["\\]/g, '\\$&') + '"]');

  const a = {
    dom, window: win, document: doc, ev, errors, viewport,
    close() { try { win.close(); } catch (e) {} },

    // ---- state (let-bound in the app, reachable only through eval) ----
    get S() { return ev('S'); },
    get M() { return ev('M'); },
    get E() { return ev('E'); },
    get PROJECT() { return ev('PROJECT'); },
    get mcuNames() { return Object.keys(ev('MCU_FILES')); },
    get packages() { return Object.keys(this.M.packages); },

    /** Problems seen so far, as printable strings. */
    problems() { return errors.map(e => '[' + e.level + '] ' + e.text); },
    clearProblems() { errors.length = 0; },

    // ---- driving the app ----
    loadMcu(name) {
      const files = ev('MCU_FILES');
      if (!files[name]) throw new Error('no such MCU: ' + name);
      // openMcu() = loadMcu() + UI sync (rebuilds the package <select>). Older builds only had loadMcu.
      if (typeof win.openMcu === 'function') win.openMcu(files[name]);
      else { win.loadMcu(files[name]); win.renderAll(true); }
      return a;
    },
    /** Switch package through the real <select>, the way a user does. */
    setPackage(pkg) {
      const sel = doc.getElementById('pkgsel');
      const has = Array.from(sel.options).some(o => o.value === pkg);
      if (!has) throw new Error('package <select> has no option "' + pkg + '" (options: '
        + Array.from(sel.options).map(o => o.value).join(', ') + ')');
      sel.value = pkg;
      sel.dispatchEvent(new win.Event('change', { bubbles: true }));
      if (a.S.pkg !== pkg) throw new Error('package did not switch to ' + pkg + ' (still ' + a.S.pkg + ')');
      return a;
    },
    pinEls() { return Array.from(doc.querySelectorAll('#svg .pin')); },
    pinNames() { return a.pinEls().map(el => el.dataset.pin); },

    /** Real mousedown+mouseup on a pin, exactly like a user click. Opens the picker. */
    clickPin(name) {
      const el = q(name);
      if (!el) throw new Error('pin ' + name + ' is not drawn on ' + a.S.pkg);
      const target = el.querySelector('rect') || el;
      const o = { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 };
      target.dispatchEvent(new win.MouseEvent('mousedown', o));
      target.dispatchEvent(new win.MouseEvent('mouseup', o));
      return a;
    },
    rightClickPin(name) {
      const el = q(name);
      if (!el) throw new Error('pin ' + name + ' is not drawn on ' + a.S.pkg);
      const target = el.querySelector('rect') || el;
      target.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 100, clientY: 100 }));
      return a;
    },
    picker() { return doc.getElementById('picker'); },
    pickerOptions() {
      const p = a.picker();
      return Array.from(p ? p.querySelectorAll('.opt') : []).map(el => ({
        el, text: el.textContent.trim(),
        data: JSON.parse(el.dataset.opt),
        cur: el.classList.contains('cur'),
        na: el.classList.contains('na'),
      }));
    },
    /** Choose a picker entry: by index, by predicate, or by an object from pickerOptions(). */
    pick(which) {
      const opts = a.pickerOptions();
      let o;
      if (typeof which === 'number') o = opts[which];
      else if (which && which.el) o = which;
      else o = opts.find(which);
      if (!o) throw new Error('no matching picker option among: ' + opts.map(x => x.text).join(' | '));
      o.el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      return a;
    },
    key(k, init) {
      const o = Object.assign({ key: k, bubbles: true, cancelable: true }, init || {});
      win.dispatchEvent(new win.KeyboardEvent('keydown', o));
      return a;
    },

    /** Assign without the UI: the engine call the picker would make. */
    assign(pin, opt) { win.assignSignal(pin, opt); win.renderAll(); return a; },
    reset(pin) { win.resetPin(pin); win.renderAll(); return a; },
    conflicts() { return a.E.conflicts; },
    pinState(name) { return (a.E.pins[name] || {}).state || 'unused'; },
  };

  return a;
}

/** Boot once, hand to fn, always close (jsdom windows leak timers otherwise). */
export async function withApp(fn, opts) {
  const a = boot(opts);
  try { return await fn(a); } finally { a.close(); }
}

