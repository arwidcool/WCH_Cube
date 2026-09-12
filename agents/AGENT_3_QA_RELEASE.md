# AGENT-3 — QA + RELEASE, round 6

Owns `tests/**`, `tests/evidence/**`, `src-tauri/**`, `data/firmware/**`, `.github/**`,
`scripts/**`, `README.md`, `PROGRESS.md`, `Taskfile.yml`, `agents/**` (the pack itself).
May add tests anywhere; may only ADD to `app/`.

Read `README.md` first and follow the work cycle exactly. You never stop to ask; you decide and
log. Round 6's brief is `PROJECT.md`, and it is yours to keep true. **You are the only agent who
ticks a `DONE.md` line, and only on something that runs.** Round 5's Current — the whole record
of the H417 push, the collision finding, the duplicate-key hole — is in
`history/round5/AGENT_3_QA_RELEASE.md`.

## The standing rule, and why it is the round

> **A check nobody has seen go red is not a check.** A gate that passes can be standing in
> front of nothing. Round 5 proved it four times in one day: the ledger at zero the day 63
> collisions were found; three Python gates green over a file js-yaml refused; header checks
> silently `continue`-ing past three of six parts; CI never having run at all.

The planted-break discipline — mutate, watch it go red, restore — is the only answer this
repository has found that works, and this round makes it universal. Your own detector this
round (`duplicateKeys()` in `tests/data.test.js`) caught two bugs in itself through its planted
break before it caught anything in the tree. That is the discipline working, not failing.

## P0 — Deliverable A: CI executes and is read green

`origin` exists. `.github/workflows/ci.yml` has three jobs, `tests/release.test.js` checks
their shape, and **not one has ever run**. Every green result in this repository is local.

1. Push. Read the first run — the whole log, not the badge. Post what the runner image shakes
   out as a FINDING with the job and line; the likely first failure is a package name.
2. Get `test` green, then `firmware` green **with the compile suites executing rather than
   skipping** — the runner has no PlatformIO until the job installs it, and a skip there is a
   silent pass over the one thing the job exists for. Then `desktop`.
3. Read the `Coverage ledger` step's output on the runner. It is the third data gate and
   nothing has seen it run anywhere but this box.
4. Only then: `DECISION | worktrees ON`, per item 12 of round 5's list. Not before.
5. `PROGRESS.md` says "never run in CI" in those words until step 2 holds, and then quotes the
   run URL. `HUMAN_TODO.md` item 1 is rewritten from "add a remote" to "read the first run".

## P1 — Deliverable B: every gate is proven able to fail

A sweep of `tests/**`. For every check, one of: it has a planted-break half that has been seen
red; or it gets one this round; or it is listed, by name, as a check that cannot go red and
why. **The acceptance is 0 in the third category.** Where a suite already has a planted-break
half, add to it, never beside it. In order of what matters:

- the collision ratchet (`h417_packages.test.js`) — plant a collision, expect REGRESSION;
- the reachability check — plant an undeclared bonded pin, expect it named;
- the SPL-header guard (`codegen_compile.test.js`) — remove a part from the map, expect it
  named, not skipped;
- the fixture-freshness check — corrupt a fixture, expect STALE;
- `--strict` per part — every fixture, a planted TODO, exit 2;
- the `IN_EXTRACTION` expiry — tick the TASKS.md line in a copy, expect the cells to fail;
- `verify_sdk_names.py` — plant a macro that does not exist, expect it named.

Each break goes in `tests/evidence/round6/` with the red output verbatim. A red found in
`app/` or `data/` is a board entry for its owner, never a fix by you.

## P2 — the record, the pack, and the desktop

- **`PROGRESS.md` is re-measured every cycle**, never asserted: `python tools/coverage.py
  --quiet`, the suite count, the collision counts, the `params:` remaining, and the CI state.
- **`DONE.md`**: the round-6 section gates the round. Tick only on evidence, name it on the
  line. "Builds, not flashed" stays in exactly those words until a human reports the SDI banner.
- **`WALKTHROUGH.md`** is the round-6 acceptance script; run it end to end before any
  `ROUND 6 DONE` and post what failed.
- **`src-tauri`** has not been relinked since round 4. `cargo build` green is not a window
  opening. `HUMAN_TODO.md` item 7 stays until a human sees it write a project.
- **The pack**: `agents/` is the only working directory. Anything that contradicts the tree is
  fixed in the commit that notices. The grep from round 5 (`Agents Rounds`, `agents/Update`,
  `run_round`, and now `PROMPT_AGENT_n_COVERAGE`/`_H417`) is run each cycle; a hit outside
  `history/`, `BOARD.md` and `tests/evidence/` is a live pointer at something that no longer
  exists.

## When idle

`BACKLOG.md` QA / RELEASE section — `tests/perf.test.js` on the QFN128 fixture, screenshots as
CI artifacts once CI exists, the release workflow on tag. And `tests/evidence/`: a claim on the
board with no artefact behind it is what the folder exists to prevent.

## Authority

Revert anything that breaks `main`. Add tests anywhere. Tick a `DONE.md` line only on evidence.
You own the pack. When the round's exit criterion is met, post `DECISION | ROUND 6 DONE` and tag
`v1.5.0`.

## Current

**Round 6, cycle 1 — the round's rule was true of the round's own first deliverable.**

1. **CI had never been read, and it had run 30 times.** The pack, `PROGRESS.md`, `HUMAN_TODO.md`
   and my own brief all said "never executed". The repo is public, both workflows are active,
   `ci.yml` fires on every push, and **every completed run since the initial commit had failed** —
   `test` and `firmware` both at `node tests/run.js`, `desktop` green, annotation "exit code 1".
   Not "never run": worse, because it had been guessed green for a day. That is deliverable A's
   premise gone, and it is exactly the round's rule turned on the round.

2. **Three causes, all in my own files**, reproduced locally without a token by cloning the repo
   into a fresh directory: GitHub's Windows image ships `core.autocrlf=true` (a CRLF dist, so the
   fixtures no longer equal `projectSerialize()`) — and `ci.yml`'s own "up to date" step was BLIND
   to it, because `git diff` normalises endings; `browser.js` finding `/usr/bin/google-chrome` and
   launching without `--no-sandbox`, which ubuntu 24.04 kills, so every real-browser test FAILED
   rather than skipped; and `desktop.test.js` running `cargo test` in the one job that never
   installs Tauri's deps. Fixed in `14f5a5e`. **Result: `firmware` green for the first time in 31
   runs** — windows-latest, the full suite with PlatformIO, compile gates executing.

3. **The log needs a token; the annotations do not.** Both test steps now tee the run and publish
   every failing test name, every `LOAD FAIL` and the verdict as `::error`, and on success the
   verdict, every skip reason and the count of compile gates that RAN as `::notice`. Thirty runs
   had said only "exit code 1". The very next run used it: the Linux job named `3853b57`'s stale
   `dist/index.html` — a data commit that changed 1043 lines and did not rebuild.

4. **And I did it to myself one commit later.** The dist I committed in `3f662d5` was built from
   a clean clone at `14f5a5e`, and four commits landed before it merged — so I replaced a newer
   bundle with an older one, the same defect I had just reported. Every dist since is built from a
   clean clone at `origin/main`. On a shared tree with `cancel-in-progress`, a bundle built from
   anything but the commit it will sit on is stale before it lands.

5. **Deliverable B is met for `tests/**`: twelve planted breaks, each seen red and restored**, 18
   planted-break tests green together, 14 refusals captured verbatim. The list of gates that
   cannot go red — B's acceptance — is empty. `tests/lib/mutant.js` holds the four shapes
   (`withMutantMcu`, `withMutantFile`, `withMutantDist`, `boot({html})`), each refusing a mutation
   that changed nothing, because an anchor that has moved turns a planted break into a silent pass.

6. **The find of the round so far: the `IN_EXTRACTION` expiry did not exist.** Since round 5 the
   pack, `TASKS.md` and the test itself promised "tick the line and every cell becomes a hard
   failure with no edit here". The guard checked `tasks.includes(task)` — and a ticked `- [x]`
   line still contains the phrase. The exemption could retire only by DELETING the line, which the
   working agreement forbids. A gate that could not go red, found by the sweep for that class, and
   now planted: a ticked COPY of `TASKS.md` fails **40 CH32H417 cells**.

7. **Two plants failed before they worked, and both were worth more than the plant.** Renaming
   `mcu.name` changed nothing the catalogue compares (it is keyed by part NUMBER); renaming the
   chip container made the app throw at boot, escaping `walk()` before the check it was meant to
   trip. A plant must break the thing the check measures, not the page.

**State.** Local: every suite I touched green; the full suite last read `1 FAILED, 774 passed`,
the one red being `app/tests/pinmap.test.js` with AGENT-2's engine files uncommitted in the shared
tree — clean at `origin/main`, reported, not touched. CI: `firmware` and `desktop` green on
`14f5a5e`; `test` red there on a stale dist that is now rebuilt; later runs cancelled by the next
push, which is `cancel-in-progress` working as designed.

**NOT claimed.** CI is **not yet read green on all three jobs** — `PROGRESS.md` carries the
measured sentence, not the badge. Worktrees stay OFF. `src-tauri` has not been relinked since
round 4. The DONE hardware line still reads **"builds, not flashed"**.

**Next, in order:** (a) read the first run that completes with the new `::notice` annotations and
confirm the compile gates RAN rather than skipped — that is the last thing standing between here
and deliverable A; (b) the same planted-break sweep over `app/tests/**`, which has 17 files and
almost no breaks; (c) `WALKTHROUGH.md` §1 end to end once A holds.
