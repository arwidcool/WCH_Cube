// Resolve test-only npm deps (jsdom, js-yaml).
//
// Normally they live in <repo>/node_modules (`npm ci`, as CI does). On this project's
// Google Drive mount npm cannot write there (EBADF), so we also look in a local cache
// directory. Set WCHCUBE_DEPS to override. See README, "Running the tests".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

// Each entry is a directory that CONTAINS a node_modules folder.
const BASES = [
  process.env.WCHCUBE_DEPS,
  ROOT,
  path.join(process.env.LOCALAPPDATA || '', 'wchcube-deps'),
  path.join(os.homedir(), '.wchcube-deps'),
]
  .filter(Boolean)
  .map(p => (path.basename(p) === 'node_modules' ? path.dirname(p) : p));

export const SEARCHED = BASES.map(b => path.join(b, 'node_modules'));

const cache = new Map();

function requirerFor(base) {
  // Anchor a CommonJS require at <base>/_resolve.js so require('jsdom') finds <base>/node_modules/jsdom.
  return createRequire(path.join(base, '_resolve.js'));
}

function notFound(name, original) {
  return new Error(
    `Test dependency "${name}" not found.\n` +
    `  Install it with:            npm install\n` +
    `  If npm cannot write here (Google Drive / network share):\n` +
    `      npm install --prefix "%LOCALAPPDATA%\\wchcube-deps" jsdom@25 js-yaml@4\n` +
    `  Searched:\n${SEARCHED.map(s => '      ' + s).join('\n')}\n` +
    `  (original error: ${original})`
  );
}

/** require() a test dependency from the first place it exists. */
export function dep(name) {
  if (cache.has(name)) return cache.get(name);
  let last = 'not attempted';
  for (const base of BASES) {
    if (!fs.existsSync(path.join(base, 'node_modules', name.split('/')[0]))) continue;
    try {
      const mod = requirerFor(base)(name);
      cache.set(name, mod);
      return mod;
    } catch (e) { last = e.message; }
  }
  throw notFound(name, last);
}

/** Absolute path of a file inside a test dependency (e.g. 'js-yaml/dist/js-yaml.js'). */
export function resolveDep(spec) {
  let last = 'not attempted';
  for (const base of BASES) {
    try { return requirerFor(base).resolve(spec); } catch (e) { last = e.message; }
  }
  throw notFound(spec, last);
}

export const yaml = () => dep('js-yaml');
