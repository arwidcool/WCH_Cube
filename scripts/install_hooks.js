#!/usr/bin/env node
// scripts/install_hooks.js — wire scripts/check_dist_fresh.js into .git/hooks/pre-push.
//
// `.git/hooks/` is never committed — it lives outside the tree git tracks, one copy per
// clone — so the guard in scripts/check_dist_fresh.js would otherwise be something you
// have to remember exists rather than something that runs. Run this once per clone
// (`node scripts/install_hooks.js`). Worktrees are suspended this round (agents/README.md
// §"Git model"), so there is exactly one shared clone right now, and running this once on
// it covers every agent's push from this box until worktrees turn on.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function gitDir() {
  const out = execSync('git rev-parse --git-dir', { cwd: ROOT, encoding: 'utf8' }).trim();
  return path.isAbsolute(out) ? out : path.join(ROOT, out);
}

const hooksDir = path.join(gitDir(), 'hooks');
fs.mkdirSync(hooksDir, { recursive: true });
const hookPath = path.join(hooksDir, 'pre-push');

const MARKER = '# installed-by: scripts/install_hooks.js';
const hook = `#!/bin/sh
${MARKER}
# Not committed - .git/hooks/ never is. Re-run \`node scripts/install_hooks.js\` after a
# fresh clone. See scripts/check_dist_fresh.js for what this actually checks and why.
exec node "$(git rev-parse --show-toplevel)/scripts/check_dist_fresh.js"
`;

if (fs.existsSync(hookPath)) {
  const existing = fs.readFileSync(hookPath, 'utf8');
  if (!existing.includes(MARKER)) {
    console.error(`refusing to overwrite an existing pre-push hook that this script did not install: ${hookPath}`);
    console.error('remove or rename it first if you want this one in its place.');
    process.exit(1);
  }
}

fs.writeFileSync(hookPath, hook);
try { fs.chmodSync(hookPath, 0o755); } catch { /* chmod is a no-op on some Windows filesystems - harmless */ }
console.log(`installed: ${hookPath}`);
console.log('every `git push` from this clone now runs scripts/check_dist_fresh.js first.');
