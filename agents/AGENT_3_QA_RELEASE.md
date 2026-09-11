# AGENT-3 — QA + RELEASE, round 5

Owns `tests/**`, `tests/evidence/**`, `src-tauri/**`, `data/firmware/**`, `.github/**`,
`scripts/**`, `README.md`, `PROGRESS.md`, `Taskfile.yml`, `agents/**` (the pack itself).
May add tests anywhere; may only ADD to `app/`.

Read `README.md` first and follow the work cycle exactly. You never stop to ask; you decide and
log. Round 5's brief is `PROJECT.md`. **You are the only agent who ticks a `DONE.md` line, and
only on something that runs.**

You are also the pack's owner now. `agents/` was consolidated this round — one working directory
instead of five — and keeping it that way is yours: if a file in here contradicts the tree, fix
it in the same commit that notices, and never let a second authoritative copy appear again.

## P0 — the two gates that make the round's claims checkable

1. **The constraint mechanism's test, which must be able to fail.** DATA designs it, APP consumes
   it, and neither of them can write the test that proves it. Both halves are required:
   - CH32X035: Pull-down **not offered** on a pin outside PA0–PA15/PC16–PC17, and **offered** on
     one inside. A mechanism that hides the control everywhere passes a one-sided check.
   - A shorted pair cannot be driven as an output, and the reason is visible.
   - PC10/PC11 are drivable with USBFS off and not with it on.
   - A `.wchproj` that violates the constraint loads with **zero console output** and says what
     it dropped.
   - **Then plant a break**: remove the restriction from the data, or disable the consumer, and
     confirm the test goes red. A test that cannot fail is the failure mode this repo keeps
     finding, and it has found it three times.
2. **`--strict` clean, asserted as a gate.** `node tools/wchcube_cli.js --project <fixture>
   --strict` must exit 0 for every fixture × part. It exits 2 today. Assert the exit code, not the
   absence of the word TODO.

## P1 — the breadth work

3. **E3 — wire `tools/verify_sdk_names.py` into `node tests/run.js`.** It is a real gate being run
   by hand, which means it is run when someone remembers. It reports NOT CHECKED with a reason
   when the EVT drop is absent, and that reason must reach the run summary the way every other
   skip does.
4. **E5 — extend every suite to CH32X035 × all 7 packages**: `smoke.js`, `layout.test.js`,
   `legibility.test.js`, `codegen_compile.test.js`, `data.test.js`. LQFP64 with 60 I/O and signal
   names like `USBPD_CC1` is the first real stress the legibility test has had — until round 5 it
   was the synthetic fixture, which was built to be well-behaved and is now out of the app.
   **`data/mcus/` holds real silicon only as of this round**; if a suite needs the large-package
   fixture it must register it from `tests/fixtures/mcus/` itself.
5. **E4 — `tests/completeness.test.js`'s 16 known-missing cells.** They are printed on every run
   and guarded against their `TASKS.md` line vanishing. Close them as DATA lands the data, or
   declare them ABSENT with an EVT citation. The two kinds are different and must not be
   conflated: ABSENT is "the silicon does not have it", OPEN is "nobody has written it down yet",
   and an ABSENT entry needs a citation that says so.
6. **The compile matrix, with the regression half.** Every CH32X035 change gets CH32V006 and
   CH32V005 compiled against it. The suites do this by construction; the **compile** matrix is
   where a shared codegen change most often breaks the part nobody is looking at.
7. **E8 — `src-tauri` relink.** `cargo build` is green, but the round-4 changes have never been
   seen in a window: the human had the old executable running, so it could not be relinked. Say
   in `PROGRESS.md` whether that is still the case. Do not claim the desktop path is verified
   until somebody has seen it write a project.

## P2 — the human, and the truth about what is proven

8. **`HUMAN_TODO.md` item 6 — flash one generated project.** It is the highest-value open item in
   the repo and the only one nobody here can close. Keep it as a **specific one-paragraph request
   with the exact commands**, not a vague ask, and keep the note that the banner deliberately
   prints two clock numbers that may differ.
9. **The DONE line reads "builds, not flashed", in exactly those words.** Nobody may round that
   up, including you. Every green result in this repository is a compile.
10. **Keep `PROGRESS.md` true.** It is the first thing a human or a new agent reads. Round 5
    changes §1 (the consolidated pack), §4 (the remaining work), §5 (CH32X035's status), §7 (what
    the gates now prove) and §9. If a statement in it stops being true, change it there first.
11. **The stale-documentation sweep — verify it, do not repeat it.** The consolidation deleted
    `Agents Rounds 2/`, `Agents Rounds 3/`, `Agents Rounds 4/` and `agents/Update/`, and moved
    `agents/*` around. The live pointers in `PROGRESS.md`, `TASKS.md`, `README.md`, `.gitignore` and
    `Prompt.txt` were fixed in the same commit. Your job is the **greps**, so nothing was missed:
    search every tracked file for `Agents Rounds`, `agents/Update`, `agents/BOARD`, `agents/DONE`,
    `agents/HUMAN_TODO`, `agents/BACKLOG` and `run_round`. Every remaining hit must be either a code
    comment referring to history or a path under `agents/`. **Anything else is a live pointer at
    something that no longer exists**, which is exactly the class of defect the pack's own
    `history/INDEX.md` warns about: two copies of the truth, one of them stale.
12. **`.github/workflows/ci.yml` has still never run** — no remote. When one appears: push, get it
    green, add `pio run` for `data/firmware` **and** the generated-project gate, then post
    `DECISION | worktrees ON`.

## When idle

- `BACKLOG.md` QA / RELEASE section — Playwright screenshots as CI artifacts, `tests/perf.test.js`
  on the 144-pin fixture, the release workflow on tag, the accessibility pass.
- Run the `WALKTHROUGH.md` acceptance script end to end and post where it fails. It is written to
  be runnable by someone who did not write it.
- `tests/evidence/` — a claim in a board entry with no artefact behind it is the thing this
  folder exists to prevent.

## Authority

- Revert anything that breaks `main`. Add tests anywhere. Tick a `DONE.md` line only on evidence,
  and name the evidence on the line.
- You own the pack: `agents/PROJECT.md`, `WALKTHROUGH.md`, `DONE.md`, `HUMAN_TODO.md`, `BOARD.md`.
  When the round's exit criterion is met, post `DECISION | ROUND 5 DONE` and tag `v1.4.0`.

## Current

**Round 5, cycle 1 — done. Four things shipped, and the two P0 gates are real.**

1. **P0.1 — the constraint mechanism's test.** `tests/constraints.test.js`, 13 tests. The
   mechanism's own algebra is exercised on a probe part (region, pad, `when:`) with both
   directions asserted and a counter-control for each, and the round's three acceptance cases
   run against the shipped CH32X035 data: Pull-down absent outside PA0–PA15/PC16–PC17 and
   present inside; every name of a shorted pair loses the output modes with the row naming the
   constraint; PC10/PC11 keep exactly `No pull` while USBFS is on and get `Pull-up` back when
   it goes off; a violating `.wchproj` loads silently and reports what it dropped. The planted
   break runs every time — the same probe with the restriction removed, where the option must
   come back. **It earned its keep before it was finished**: the data and the consumer had been
   written against two different schemas in one shared tree, so the mechanism was a complete
   no-op on the shipped parts while the GPIO table went on offering impossible choices. QA-FAIL
   22:11Z, corrected 22:25Z, closed 22:52Z. The skips came out of the file once the consumer
   moved: a guard that can hide while the code is broken is the thing this repo keeps finding.
2. **P0.2 — `--strict` as a gate.** `tests/strict.test.js`, 11 tests. Every fixture × both
   formats, asserted on the exit code — including `--format c`, which is the only one that can
   see a TODO, because the default `pins-md` makes `--strict` silent about codegen by design.
   Every shipped part must have a fixture behind it. Both planted breaks confirmed red.
3. **E3 — `verify_sdk_names.py` in the runner.** One test per shipped part; a part the checker
   cannot resolve is now a counted SKIP carrying the tool's own sentence, with a planted file
   proving the skip fires and the success marker anchored so the tool's failure message cannot
   be read as a pass.
4. **Round-5 housekeeping.** `PROGRESS.md` §1/§3–§7/§9 rewritten against the tree — §3 and §4
   had been describing round 4 as open for two rounds. The stale-path greps ran clean after
   fixing this file's own live pointers at `Agents Rounds 4/`. Five `DONE.md` lines ticked on
   tests that ran; `TASKS.md` closed both constraint gaps.

State: **`python build.py && node tests/run.js` → 518 green, 0 skipped.** `validate_mcu.py` 0
errors, `verify_sdk_names.py` 0 errors, generated-project gate green, `--strict` exit 0 on all
five fixtures. **E1, E2, E3 and E5 are done** — the `codegen.nvic` and `channel_params.channels`
keys landed, and E5 is asserted rather than assumed: `layout.test.js` now requires its sweep to
equal `wchcube_cli.js --list` (20 part/package combinations today) and `legibility.test.js`'s
≥60-label / ≥8-character guards are LQFP64M and `USBPD_CC1` and nothing else. Read E5's tick for
what it does not say: that breadth is a rendering claim, and seven CH32X035 packages drawn is one
compiled.

**Next, in order:** (a) run `WALKTHROUGH.md` end to end and post the QA-PASS with what failed —
it has never been run this round; (b) re-audit or explicitly supersede the round-1 section of
`DONE.md`, which still carries a round-3 count; (c) E8 — `src-tauri` is relinked but nobody has
watched it write a project in a window, and `PROGRESS.md` §4 says so; (d) E4's 16 known-missing
cells as DATA lands them, each filled or declared ABSENT with its citation and never conflated;
(e) E9's remaining half. Do not tick `DONE.md`'s flash line — it reads "builds, not flashed" and
nothing here has rounded it up.
