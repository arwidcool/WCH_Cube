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

## P0a — the coverage gate is yours to keep honest (docs/COVERAGE.md)

`tests/coverage.test.js` runs `python tools/coverage.py --gate` for every part, the planted-break
self-test (`tools/coverage_selftest.py`, 21 breaks) and `python tools/ledger.py --check`. Three
things it must never do, and you are the one who notices if it starts: pass a part whose
`open_rows:` went UP (a regression the ratchet exists to catch — a diff that raises the number is
a review flag, not a fix); pass a `complete` part with an open row; or let `IN_EXTRACTION` in
`tests/completeness.test.js` soften a **pin, setting or chapter** cell — it may soften `params`
and `clock` only. When you write the DONE line for a part, quote the ledger's count.

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

**Round 5, the coverage-ledger cycle — the ledger was not in git, and now it is.**

1. **P0.1 found the ratchet had no history, because it was never committed.** The first
   instruction of this cycle is to read `git log -p -- data/coverage/` and flag any diff that
   raises `open_rows:`. That command returns nothing, and not because nothing changed: all six
   coverage files and all six generated ledgers existed **only on disk** — untracked, not
   `gitignore`d, invisible to every diff. The consequences were not subtle. A count could be
   raised by anyone with no diff to review, which is the one thing P0 exists to prevent; the
   review instruction was unrunnable; and a fresh `git clone` had no `data/coverage/` at all, so
   the CI step "Coverage ledger - every part meets its declared status" ran against nothing and
   **exited 2**. The same was true of the whole coverage system: `tools/coverage.py`,
   `tools/coverage_lib.py`, `tools/coverage_selftest.py`, `tools/ledger.py`, `docs/COVERAGE.md`,
   `CLAUDE.md` — the file every session is told to read first — and `tests/coverage.test.js` were
   all untracked. Landed. Evidence: `tests/evidence/round5/2026-09-12-ledger-untracked.md`.
   **The guard:** `tests/coverage.test.js` now asserts every coverage file and ledger is tracked
   by git, in both directions, with a planted break — it was **seen red naming all 13 files**
   before the fix and green after. An untracked ratchet is not a weaker ratchet, it is no
   ratchet, wearing a `status: complete` badge.
2. **P0.2 — `SOFT_CELLS` is pinned to `{params, clock}`.** Two tests: one asserting the set is
   exactly that (naming `settings`, `nvic`, `pins`, `chapter` and `routed` individually as cells
   that must never be excused), and a planted break proving four widenings are each caught.
   Widening it is invisible by construction — a softened cell *prints* instead of failing, so the
   run gets quieter and stays green.
3. **P0.3 — the ratchet was seen red four ways**, captured verbatim in
   `tests/evidence/round5/2026-09-12-ratchet-red.md`, each restored from a byte copy in a
   `finally`: `open_rows:` raised → *"lower it to N (the count may only go down, and it must be
   current)"*; `open_rows:` lowered → *"REGRESSION: 3 open rows, 1 recorded - 2 new gap(s) were
   introduced"*; `status: complete` with rows open → *"declared complete but 3 row(s) are OPEN"*.
   All three name the part in the summary line, which is P0.4's requirement holding.
4. **P0.4 — the per-part shape is kept**, and it survived a failure the tool was not designed
   around: with a coverage file missing, the gate prints one `CANNOT READ` line per part rather
   than collapsing into a single message.
5. **P1 — `docs/HOW-IT-WORKS.md`.** The ledger is now a row in the verification flowchart, between
   `validate_mcu.py` and `verify_sdk_names.py`, a new **rule 7** ("consistent is not the same as
   complete"), and two entries in the repository map. `PROGRESS.md` quotes
   `python tools/coverage.py --quiet` verbatim as a dated snapshot, and its stale
   "(no remote)" line is gone.
6. **P2 — the compile gate follows the data.** The CH32L103 fixture now claims `ADC1` channel
   `IN4`, and **`IN0` was tried first and correctly refused** (`PA0: TIM2_CH1_ETR / ADC1_IN0`) —
   the builder printing the pair is what made "pick another pin" a decision rather than a guess.
   On CH32H417 the analog claims were **tried, found a real defect, and reverted**: see below.
7. **Found by that extension — CH32H417 configures an analog pad `GPIO_Mode_AF_PP`.** `OPA`
   inputs/outputs and the `DAC` output are pads with no `(AFn)` code, because their function *is*
   analog and is selected by `GPIO_Mode_AIN`. `analogClaim()` (`app/engine/constraints.js:255`)
   decides "is this analog?" from `codegen.analog_signals`, falling back to "Analog-category
   peripheral on an analog-capable pin" — and **CH32H417 is the only shipped part that declares
   neither**, because its `pins:` block carries no `analog:` flag either (a declared gap in the
   file header). So the fallback returns false, `gpioEffectiveMode()` takes the alternate-function
   branch, and the generated C drives analog pads as AF push-pull. The TODO beside it then asks
   the reader to add an `af:` to a pad that has none. Wrong-but-compiling, which is the defect
   class this round exists to remove. Recorded with the generated C in
   `tests/evidence/round5/2026-09-12-analog-pads.md`; requested from AGENT-1 (the data half) and
   AGENT-2 (the message half). **The fixture claims those four pads in the commit that lands the
   fix, not before** — while they are claimed this fixture cannot be `--strict` clean, and
   `--strict` exit 0 for every fixture is deliverable B's acceptance test. Premature, not wrong,
   and the four lines are written out in `make_fixtures.js` so they come back with it.
8. **P3 — CI and the Taskfile are checked, not assumed.** `tests/release.test.js` gained three
   tests: the coverage ledger step exists in CI **and runs after** `verify_sdk_names.py` (a row
   closed by naming a signal whose macro does not exist must be reported by the name check first),
   a planted break proving a missing *and* a reordered step are caught, and a check that
   `task coverage` / `task coverage:gate` / `task ledger` exist and run the commands they claim.
9. **P4 — the pack.** `agents/README.md` said "no remote" in three places while `origin` points at
   `https://github.com/arwidcool/WCH_Cube.git`; corrected, together with the worktree condition —
   which is **not** "a remote exists" but item 12's list, and CI has still not been read green, so
   worktrees stay off and the state is posted instead of flipped. The three
   `PROMPT_AGENT_n_COVERAGE.txt` files and `PROMPT.txt` were checked for drift and agree on the
   gates; no contradiction found.
10. **Answered AGENT-1's `REQUEST(→AGENT-3)` first, as the work cycle requires.** Four `ABSENT`
    entries for CH32L103's CMP2/CMP3 (`nvic` and `clock`) are in `tests/completeness.test.js`,
    **re-verified here rather than pasted**: `ch32l103.h:100` is `CMPWakeUp_IRQn = 68` and the
    only comparator vector in the enum, and `ch32l103_rcc.h` defines no `RCC_*Periph_CMP` for any
    of the three. They take effect the moment AGENT-1 models the two peripherals; if CMP2/CMP3
    are ever abandoned they become dead declarations, which is noted in the entry itself.

State: **`python build.py && node tests/run.js` → ALL GREEN, 603 tests, 0 failed.**
`python tools/coverage.py --quiet` at 2026-09-12T12:19Z —

```
  CH32H417   OPEN 113  (modelled 1234, absent 20, disagreements 0)
  CH32L103   OPEN 12   (modelled 260, absent 11, disagreements 1)
  CH32V003   OPEN 3    (modelled 113, absent 10, disagreements 0)
  CH32V005   OPEN 0    (modelled 214, absent 14, disagreements 0)
  CH32V006   OPEN 0    (modelled 218, absent 11, disagreements 0)
  CH32X035   OPEN 0    (modelled 278, absent 11, disagreements 0)
```

`coverage gate: 6 of 6 part(s) meet their declared status`. `validate_mcu.py` 0 errors /
170 warnings, `verify_sdk_names.py` 0 errors, `--strict` exit 0 on all six fixtures in both
formats. **Three parts are still `in_extraction` and their counts may only go down**; no part is
reported done while the tool prints an open row, and the DONE line still reads **"builds, not
flashed"**.

**Next, in order:** (a) the day CI is readable, read the `Coverage ledger` step's result and post
it — it is now the third data gate and nothing has seen it run; (b) land the CH32H417 analog
fixture claims with `codegen.analog_signals` and delete the note in `make_fixtures.js`; (c) re-run
the CH32L103 CMP2/CMP3 `ABSENT` entries once the peripherals exist, and remove them if they are
abandoned; (d) `WALKTHROUGH.md` gets its "open `data/coverage/`, run the tool, expect six zeros"
section the day every part reads `complete` — not before, because six zeros is the claim it makes.
