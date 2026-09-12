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

**Round 6 opened 2026-09-12 by closing round 5.** Archived to `history/round5/`: the round-5
`PROJECT.md`, `BOARD.md` (222 KB, the whole decision record), `WALKTHROUGH.md`, the three
`AGENT_n_*.md`, and the six per-push prompts (`PROMPT_AGENT_n_COVERAGE.txt`,
`PROMPT_AGENT_n_H417.txt`). The launcher reads only `PROMPT.txt` + `AGENT_n_*.md`, so nothing
it needs moved. `proposals/` stays: the X035 DMA proposal is only 5 of 8 adopted, and three
files in `data/` cite `x035_dma_requests.py` by path. `reference/cubemx.png` stays: `tests/
layout.test.js` is the regression against it.

Baseline at the open, measured:

```
  CH32H417   OPEN 0    complete       params missing 66/78 (49 route pins)   collisions 4/0/0
  CH32L103   OPEN 12   AGENT-1        params missing 7/31
  CH32V003   OPEN 3    AGENT-1
  CH32V005 / CH32V006 / CH32X035   OPEN 0   complete
  suite      ALL GREEN, 721 tests, 0 skipped
  CI         never executed
  flashed    nothing — "builds, not flashed"
```

Stale pointers found and fixed in the close: `PROMPT.txt` said "round-5 brief" and "worktrees
stay suspended until a remote exists" (a remote has existed since 2026-09-12); `HUMAN_TODO.md`
item 1 asked for a remote; `DONE.md`'s head pointed at the round-5 section as authoritative;
`AGENT_2_APP.md` had two Current sections, one pointing at an archived prompt;
`AGENT_1_DATA.md`'s headings were double-encoded UTF-8 in the file bytes. Left for their owners
and posted: `app/tests/engine.test.js:253` cites `AGENT_2_ENGINE.md` (merged away in round 5);
`app/template.html:2092` says LTDC has no `paramRows()` (it has two).

**Next, in order:** (a) push and read the first CI run — P0.1; (b) the planted-break sweep,
starting with the collision ratchet; (c) `tests/evidence/round6/` opened with the first red.
