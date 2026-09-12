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

**Round 6, cycle 1 — CI is GREEN on all three jobs, for the first time in this repository's
history.** Run 34723740365 on `b5a654f`: `build + tests` (ubuntu), `firmware + generated
project` (windows, the whole suite WITH PlatformIO so the compile gates execute rather than
skip) and `tauri shell (linux)`, all success. The `Coverage ledger` step prints `6 of 6` on
the runner — the third data gate, seen running somewhere other than this one Windows box.

**The round's rule turned out to be true of the round's own first deliverable.** The pack,
`PROGRESS.md`, `HUMAN_TODO.md` and this brief all said CI had never executed. It had run **31
times and failed every one**, unread. Not "never run": worse, because it had been guessed green
for a day.

**Almost nothing was wrong with the code. What was wrong was the ability to SEE.**
1. The failure annotations were written and never executed — GitHub runs `run:` blocks under
   `bash -eo pipefail`, so the failing pipeline aborted the step before the block that names
   the failing tests. Thirty-one runs published exactly `Process completed with exit code 1`.
2. **15 of 20 runs were CANCELLED** by the next agent's push. One commit in five was ever
   verified. `cancel-in-progress` buys runner minutes, and this repo is public where they are
   free — it was saving nothing and discarding three quarters of the evidence.
3. `ci.yml`'s own "dist is up to date" step was BLIND on Windows, because `git diff`
   normalises line endings and the runner checks out CRLF.

**The genuine defects were genuine, and nothing was weakened to make them pass.** A stale
`dist` shipped twice by data commits that did not rebuild — and then a third time BY ME, one
commit after reporting it, by building from a clean clone at a SHA that four commits had
already overtaken. Three environment bugs in my own test files: Chrome without `--no-sandbox`
on ubuntu 24.04 (every browser test FAILED rather than skipped), `cargo test` running in the
one job that never installs Tauri's deps, and a planted break that targets a checker needing
PlatformIO — a break the checker could not RUN is not a break it MISSED, and those are now
counted separately.

**Deliverable B is met for `tests/**`:** twelve planted breaks, each seen red and restored; the
list of gates that cannot go red — B's acceptance — is empty. **Deliverable F is complete:**
six zeros, every part `status: complete`.

**The two findings I did NOT absorb into the green build**, because they are real and belong to
`app/`: the layout is not tolerant of its own font fallback (`#mcu-meta` needs 181px in a 168px
box on Linux — it ellipsises by design, so the check no longer fails, but the user sees less
than intended), and `fresh()` leaked `PROJECT.variant` and the generator options, which is the
shape worth knowing about in a helper called "fresh".

**On the human's explicit instruction I also took the four `app/tests/` failures** — three
stale TIM guards repointed rather than deleted, and the two `fresh()` leaks. The board entry to
AGENT-2 stays so they see what changed in their file rather than discover it.

**NOT claimed.** `worktrees ON` is NOT posted: the condition is met, but one green run is a
thing seen once, and `main` has been green for exactly one commit after a day of being red for
thirty-one. It goes up when three consecutive commits from different agents are green. The DONE
hardware line still reads **"builds, not flashed"**. `src-tauri` has not been relinked since
round 4.

**Next, in order:** (a) watch `main` stay green across other agents' commits — three in a row
and `worktrees ON` goes up; (b) the planted-break sweep over `app/tests/**`, 17 files with
almost none; (c) `WALKTHROUGH.md` §1 end to end, which is now runnable because §1 is about CI.
