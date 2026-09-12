// =============================================================================
//  tests/lib/mutant.js — plant a break WITHOUT touching the shared tree.
//
//  Round 6, deliverable B: every gate is proven able to fail. The proof is a mutation the
//  gate must refuse — and on a tree three agents write at once, the mutation must never be
//  a file on disk in the repository. Two shapes cover every check so far:
//
//    withMutantMcu(eng, part, mutate, fn)   the part's YAML TEXT is mutated and re-registered
//                                            under the same name, so `loadMcu()` inside the
//                                            check picks it up; the original is re-registered
//                                            in a `finally`. Nothing on disk changes.
//    withMutantFile(src, mutate)             a mutated COPY of a file in a temp folder; the
//                                            path is handed to a check that reads a path (or
//                                            to a child process through an env var).
//
//  Both refuse a mutation that changed nothing: an anchor that has moved out from under a
//  planted break turns the break into a no-op that still reads `ok`, which is the exact
//  failure mode this file exists to prevent.
// =============================================================================
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './app.js';

/** Run `fn` with `part`'s registered text mutated by `mutate(text)`, then restore. */
export function withMutantMcu(eng, part, mutate, fn) {
  const file = path.join(ROOT, 'data', 'mcus', `${part}.yaml`);
  const src = fs.readFileSync(file, 'utf8');
  const mut = mutate(src);
  if (mut === src) {
    throw new Error(`withMutantMcu(${part}): the mutation left the text unchanged — its anchor has moved in the YAML, so this break now plants nothing`);
  }
  eng.registerMcuFile(mut);
  try { return fn(); } finally { eng.registerMcuFile(src); }
}

/**
 * A copy of dist/index.html with ONE occurrence of `find` replaced, for the real-browser
 * suites (`withPage(fn, { url })`). Returns `{ file }`, or `{ error }` when the anchor is not
 * exactly once in the page - the app moved, and the break would plant nothing.
 */
export function withMutantDist(find, replace) {
  const DIST = path.join(ROOT, 'dist', 'index.html');
  const src = fs.readFileSync(DIST, 'utf8');
  const n = src.split(find).length - 1;
  if (n !== 1) return { error: `the anchor ${JSON.stringify(find)} appears ${n} times in dist/index.html, expected 1 — the app moved and this planted break no longer plants anything` };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-distbreak-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, src.replace(find, replace));
  return { file };
}

/** Write a mutated copy of `src` into a fresh temp folder and return its path. */
export function withMutantFile(src, mutate) {
  const text = fs.readFileSync(src, 'utf8');
  const mut = mutate(text);
  if (mut === text) {
    throw new Error(`withMutantFile(${path.basename(src)}): the mutation left the text unchanged — its anchor has moved, so this break now plants nothing`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-mutant-'));
  const out = path.join(dir, path.basename(src));
  fs.writeFileSync(out, mut);
  return out;
}
