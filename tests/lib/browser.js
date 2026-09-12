// Real-browser driver for QA (AGENT-4).  Zero dependencies.
//
// Round 2 makes real-browser verification mandatory, and the round-1 note that
// "Playwright will not install on this box" is still true — npm cannot write into
// this Google Drive folder.  It does not have to: Chrome and Edge are both on this
// machine, they speak the DevTools Protocol over a plain WebSocket, and Node >= 22
// has a WebSocket client built in.  So this file launches the real browser, drives
// it and takes real screenshots with nothing installed.
//
// It is the difference that matters: jsdom has no layout engine, so it cannot see
// clipped text, overlapping labels, contrast, or anything that depends on a box
// having a size.  The round-2 P0 clock bug was invisible to jsdom for exactly that
// reason — offsetParent is always null there, so the clock tree never lays out.
//
//   import { withPage, browserAvailable } from './lib/browser.js';
//   await withPage(async page => {
//     await page.click('[data-view="clock"]');
//     const sys = await page.eval(`return document.getElementById('ck-sys').value`);
//   });
//
// Tests must skip, not fail, when no browser is present (CI containers): call
// browserAvailable() first.  tests/lib/harness.js has no skip verb, so the
// convention is an ok() assertion that says why it passed vacuously.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const DIST = path.join(ROOT, 'dist', 'index.html');
export const EVIDENCE = path.join(ROOT, 'tests', 'evidence', 'round2');

// Chrome first: Edge is the same engine, but Chrome is likelier to be a clean profile.
const CANDIDATES = [
  process.env.WCHCUBE_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function browserPath() {
  for (const b of CANDIDATES) { try { if (fs.existsSync(b)) return b; } catch { /* keep looking */ } }
  return null;
}

export function browserAvailable() { return browserPath() !== null; }

/** A file path the browser will accept as a URL (spaces and backslashes included). */
export function fileUrl(p) {
  const abs = path.resolve(p).split(String.fromCharCode(92)).join('/');
  return 'file:///' + abs.split(' ').join('%20');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
//  One browser process, shared by every test in the run, closed on exit.
//  Launching Chrome costs ~700 ms; a suite of 30 checks should pay it once.
// ---------------------------------------------------------------------------
let shared = null;

export async function sharedBrowser(opts = {}) {
  if (shared) return shared;
  shared = await launch(opts);
  const bye = () => { try { shared && shared.kill(); } catch { /* exiting anyway */ } };
  process.once('exit', bye);
  process.once('SIGINT', () => { bye(); process.exit(130); });
  return shared;
}

export async function launch({ headless = true, timeoutMs = 20000 } = {}) {
  const exe = browserPath();
  if (!exe) throw new Error('no Chrome or Edge on this machine (set WCHCUBE_BROWSER to one)');

  const port = 9222 + Math.floor(Math.random() * 900);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-cdp-'));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--mute-audio',
    '--allow-file-access-from-files',   // dist is one file, but keep file:// honest
    '--hide-scrollbars',
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new', '--disable-gpu');
  // On a CI runner only. ubuntu-latest (24.04) restricts unprivileged user namespaces, and
  // Chrome's sandbox needs them: without this flag it aborts at launch, the CDP port never
  // answers, and every real-browser test FAILS rather than skips - because a browser WAS
  // found. That is what the `test` job did on every push until 2026-09-12. Never on a
  // developer machine: the sandbox is the point there.
  if (process.env.CI) args.unshift('--no-sandbox');
  const proc = spawn(exe, args, { stdio: 'ignore' });
  proc.on('error', () => { /* reported by the fetch loop below */ });
  // A live child process and an open socket both keep Node's event loop alive, so
  // without this the runner sits there forever after the last green test instead of
  // exiting. unref() the child; the WebSocket is closed by closeBrowser()/kill().
  proc.unref();

  let version = null;
  const deadline = Date.now() + timeoutMs;
  while (!version && Date.now() < deadline) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); }
    catch { await sleep(100); }
  }
  if (!version) { try { proc.kill(); } catch {} throw new Error(`${path.basename(exe)} never opened a debugging port on ${port}`); }

  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('could not attach to the browser'));
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(`${m.error.message} (${m.error.code})`)) : res(m.result);
    } else if (m.method) {
      for (const f of listeners) f(m);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const msg = { id: ++nextId, method, params };
    if (sessionId) msg.sessionId = sessionId;
    pending.set(msg.id, { res, rej });
    ws.send(JSON.stringify(msg));
  });

  return {
    exe, port,
    async newPage(pageOpts = {}) { return makePage(send, listeners, pageOpts); },
    kill() { try { ws.close(); } catch {} try { proc.kill(); } catch {} shared = shared === this ? null : shared; },
  };
}

async function makePage(send, listeners, { width = 1280, height = 720, zoom = 1 } = {}) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cmd = (method, params) => send(method, params, sessionId);

  await cmd('Page.enable');
  await cmd('Runtime.enable');
  await cmd('Log.enable');

  // Everything the app writes to the console, so a test can assert silence.
  const logs = [];
  const onEvent = m => {
    if (m.sessionId !== sessionId) return;
    const p = m.params || {};
    if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(p.entry.level))
      logs.push(`[${p.entry.level}] ${p.entry.text}`);
    else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(p.type))
      logs.push(`[${p.type}] ${(p.args || []).map(a => a.value ?? a.description ?? a.type).join(' ')}`);
    else if (m.method === 'Runtime.exceptionThrown')
      logs.push(`[uncaught] ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`);
  };
  listeners.add(onEvent);

  const page = {
    logs,
    /** Problems seen so far — same spelling as the jsdom driver's problems(). */
    problems() { return logs.slice(); },
    clearProblems() { logs.length = 0; },

    /**
     * Browser zoom, the honest way: at 125 % the page gets 1/1.25 as many CSS
     * pixels and paints them 1.25x bigger, which is exactly what clips text.
     */
    async viewport(w = width, h = height, z = zoom) {
      await cmd('Emulation.setDeviceMetricsOverride', {
        width: Math.round(w / z), height: Math.round(h / z),
        deviceScaleFactor: z, mobile: false,
      });
      return page;
    },

    async goto(target = DIST, { settleMs = 400 } = {}) {
      const url = /^[a-z]+:/i.test(target) ? target : fileUrl(target);
      const loaded = new Promise(res => {
        const f = m => {
          if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') { listeners.delete(f); res(); }
        };
        listeners.add(f);
      });
      await cmd('Page.navigate', { url });
      await loaded;
      await sleep(settleMs);          // the app parses its YAML and paints after load
      return page;
    },

    /** Run a function body in the page and bring the value back. */
    async eval(body) {
      const r = await cmd('Runtime.evaluate', {
        expression: `(() => {${body}})()`,
        returnByValue: true, awaitPromise: true,
      });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error('in-page error: ' + (d.exception?.description || d.text));
      }
      return r.result.value;
    },

    /** Click through the DOM (the app binds plain click handlers everywhere). */
    async click(selector, { settleMs = 250 } = {}) {
      const found = await page.eval(`
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.click();
        return true;`);
      if (!found) throw new Error(`nothing matches ${selector}`);
      await sleep(settleMs);
      return page;
    },

    /** Set a <select> or <input> and fire the change the app listens for. */
    async setValue(selector, value, { settleMs = 250 } = {}) {
      const ok = await page.eval(`
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'missing';
        el.value = ${JSON.stringify(String(value))};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.value;`);
      if (ok === 'missing') throw new Error(`nothing matches ${selector}`);
      await sleep(settleMs);
      return ok;
    },

    /** Is this element the thing a mouse would actually hit at its centre? */
    async hitTest(selector) {
      return page.eval(`
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { missing: true };
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return { zeroSized: true };
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const cs = getComputedStyle(el);
        return {
          reachable: top === el || el.contains(top),
          covering: top && top !== el && !el.contains(top) ? (top.id || top.tagName + '.' + top.className) : null,
          inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
          disabled: !!el.disabled, pointerEvents: cs.pointerEvents, visibility: cs.visibility, opacity: cs.opacity,
          rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        };`);
    },

    async waitFor(body, { timeoutMs = 4000, everyMs = 100 } = {}) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        if (await page.eval(`return !!(${body})`)) return page;
        if (Date.now() > until) throw new Error(`waitFor timed out: ${body}`);
        await sleep(everyMs);
      }
    },

    /** PNG to disk. Relative names land in tests/evidence/round2/. */
    async screenshot(name, { fullPage = false } = {}) {
      const file = path.isAbsolute(name) ? name : path.join(EVIDENCE, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const r = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    },

    async close() {
      listeners.delete(onEvent);
      try { await send('Target.closeTarget', { targetId }); } catch { /* browser may be gone */ }
    },
  };

  await page.viewport(width, height, zoom);
  return page;
}

/**
 * Open dist/index.html in a real browser, hand the page to fn, always close it.
 * Returns whatever fn returns.  Pass { goto: false } to navigate yourself.
 */
export async function withPage(fn, opts = {}) {
  const b = await sharedBrowser();
  const page = await b.newPage(opts);
  try {
    if (opts.goto !== false) await page.goto(opts.url || DIST);
    return await fn(page);
  } finally {
    await page.close();
  }
}

/** Close the shared browser (the runner exits anyway; this is for tidiness). */
export async function closeBrowser() { if (shared) { shared.kill(); shared = null; } }
