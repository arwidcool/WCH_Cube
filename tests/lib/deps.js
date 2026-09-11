// Resolve test-only npm deps (jsdom, js-yaml).
//
// Normally they live in <repo>/node_modules (`npm ci`). On this project's Google Drive
// mount npm cannot write there (EBADF), so we also look in a local cache directory.
// Set WCHCUBE_DEPS to override. See README "Running the tests".
const fs = require('fs'), os = require('os'), path = require('path'), Module = require('module');

const ROOTS = [
  process.env.WCHCUBE_DEPS,
  path.join(__dirname, '..', '..', 'node_modules'),
  path.join(process.env.LOCALAPPDATA || '', 'wchcube-deps', 'node_modules'),
  path.join(os.homedir(), '.wchcube-deps', 'node_modules'),
].filter(Boolean);

for (const r of ROOTS) {
  try { if (fs.statSync(r).isDirectory() && !module.paths.includes(r)) module.paths.push(r); } catch {}
}

function dep(name) {
  try { return require(name); } catch (e) {
    const where = ROOTS.map(r => '  ' + r).join('\n');
    throw new Error(
      `Test dependency "${name}" not found. Install it with:\n` +
      `  npm install\n` +
      `or, if npm cannot write to this folder (Google Drive / network share):\n` +
      `  npm install --prefix "%LOCALAPPDATA%\wchcube-deps" jsdom@25 js-yaml@4\n` +
      `Searched:\n${where}\n(original: ${e.message})`);
  }
}

module.exports = { dep, yaml: () => dep('js-yaml'), jsdom: () => dep('jsdom'), ROOTS };
