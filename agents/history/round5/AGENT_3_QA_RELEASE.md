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

**The CH32H417 push, cycle 1 — the net had five holes and the net now catches the thing it was
written for.** One sentence decides this push: *every pin the datasheet gives this part is
claimable in the app, every peripheral it names is configurable, and the C that comes out is
right for the pad it configures.* Nothing below reports it as true; the numbers say where it is.

1. **P0.1 — `tests/h417_ltdc.test.js` was UNTRACKED.** Written, green, and running for nobody
   who cloned this repository. Landed with the three `agents/PROMPT_AGENT_n_H417.txt` briefs,
   which were untracked for the same reason. Same defect class as 2026-09-12T12:19Z, when the
   whole coverage ledger turned out to exist only on disk — the third time this has been the
   answer, so it is now the first thing I check in a cycle, not the last.

2. **P0.2 — the clock tab is swept on this part, and the sweep is proven.** `clock_ui.test.js`
   hardcoded three small parts; it now runs five, over four clock SHAPES — CH32H417's is the
   richest in the repo (four oscillators, a PLL whose `inputs:` spell out 32 (source, divider)
   pairs, 32 multipliers with half steps). It went **green**, which is a claim worth exactly the
   proof that it could have gone red, so two **planted breaks** truncate `#ck-pllin` to 8 of 32
   and `#ck-sys` to 1 of 3 in a COPY of `dist/index.html` and require the comparison to bite on
   CH32H417 specifically. Both mutations took. Each also asserts the OTHER mux is untouched, so
   a break that blanks the tab cannot read as a pass.

3. **P0.3 — one fixture no longer stands for three packages.** This is the first part whose
   PACKAGE decides which pins a peripheral can reach: **301** signals have a different bonded
   option list on QFN68 than on QFN128. `CH32H417_QFN68_pkg.wchproj` + `[env:CH32H417WEU6]`
   claims seven signals whose pad differs, and the generated C proves the package reaches it —
   `USART1_RX` emits `GPIOD/PinSource12/AF14` on QFN68 and `GPIOB/PinSource15/AF4` on QFN128: a
   different port, pin AND AF code, all three wrong together if the generator ignored the
   package, all three compiling either way. Compile gate and generated-project gate both build
   it. Both listings: `tests/evidence/round5/2026-09-12-h417-package-pads.md`.

4. **P0.4 — the skip count for CH32H417, read from the RUN OUTPUT rather than from the code:
   0.** The full suite prints no skip section at all and 130 of its lines name this part. But
   the question found something the count could not: `splHeaders()` mapped only three parts and
   both checks using it are written `if (!spl) continue;`, so **CH32H417 and CH32L103 fell out
   of the header-case and GPIO-enum checks with no failure, no skip and no summary line**, while
   `checked` stayed non-zero because the other parts carried it. Both EVT drops were on disk the
   whole time. Mapped them, and added a guard that turns a future omission into a failure —
   which **immediately found a third part in the same hole, CH32V003**. A silent `continue` is
   worse than a skip: a skip is counted.

5. **P0.5 — the exemption named an owner who could never retire it.** `IN_EXTRACTION` booked
   this part's ~66 missing `params:` cells to AGENT-3, and `params:` lives in
   `data/mcus/CH32H417.yaml`, which is AGENT-1's. Moved to AGENT-1 in the table and the TASKS.md
   line together. The automatic expiry is untouched: tick the line and every cell becomes a hard
   failure with no edit here.

6. **P1 — `tests/h417_packages.test.js`, and it found the big one.** Every pin reachable, every
   peripheral configurable, no default pin colliding — all three on all three packages.
   - *Reachable*: green. Every bonded pin is claimable or is a declared `power`/`ground`/`sys`/
     `reset` pad, on all three packages.
   - *Configurable*: green. 78 peripherals, 17 declaring `pins.none`, 0 still `pins.open`.
   - *Collisions*: **red, and correctly so.** Sweeping all **419** mode choices per package and
     asking what happens when a user does nothing but switch a peripheral ON: **QFN68 26,
     QFN88 20, QFN128 17** choices put two signals on one pad although the signal had another
     bonded pad free. `conflictList` reports none of them — it only fires on claims with
     DIFFERENT owners, which is exactly how four LTDC pads survived a green suite. DVP, FMC,
     I2C4, PIOC, SDIO, UHSIF and USART6 had never been looked at. A further 11/6/3 collisions
     per package are forced by the silicon and are PRINTED, not asserted away; the difference is
     computed from whether either claim had another bonded pad, never assumed.

7. **The root cause, and why it is not a YAML fix.** The default IS the first bonded option in
   `signal_pins:`, and `tools/gen_h417_peripherals.py:1086` emits that list in DATASHEET order
   with no notion of which pad becomes the default. So the 2026-09-12 hand-reordering of LTDC's
   lists lives in the generator's OUTPUT, and the very next regeneration discards it. **That
   already happened, inside this cycle**: at HEAD the counts are 26/20/17 and LTDC is clean at 28
   pads / 0 doubles; with AGENT-1's in-flight regeneration in the working tree they are
   **38/25/24** and LTDC is back to 24 pads / 5 doubles, with 8 of 9 `h417_ltdc` tests red. The
   order belongs in the generator. Reported to AGENT-1; not fixed by me — `data/mcus/**` and
   `tools/gen_*` are theirs.

8. **The ratchet, and why the check is a count rather than a zero.** The defect was ALREADY
   COMMITTED, so asserting zero would leave main red on somebody else's area and softening the
   check would make it worthless. `COLLISION_CEILING` is the shape this repo already uses for
   exactly this — `open_rows:` and `IN_EXTRACTION`: an owner, a TASKS.md line
   ("CH32H417: default pins collide"), and a number that MAY ONLY GO DOWN. A rise fails as a
   regression naming what came back; a fall fails until the number is lowered, so the ceiling
   can never quietly stop meaning anything; at zero the entry goes and the check becomes the
   plain assertion it wants to be. A guard test fails if the TASKS.md line ever vanishes. It did
   not need a planted break: it caught a real regression within the hour.

9. **P2 — the record, re-measured rather than asserted.** `PROGRESS.md` said `CH32H417 OPEN
   113`; the tool said 104 at the start of this cycle, **58** an hour later and **50** by the
   time the line was written — rewritten as a dated snapshot, because on this part the number
   moves faster than the document. Its compile-gate table listed **4** fixtures when the tree has
   **8**. `WALKTHROUGH.md` gained §4b, ten CH32H417 steps a human can follow, ending in the one
   that matters: generate on QFN128 and on QFN68 and DIFF the two `GPIO_PinAFConfig` blocks — if
   they are identical the generator is ignoring the package and everything above it is
   decoration. §4 step 16 still said "four real parts"; there are six.

**LATE IN THE CYCLE — the finding was taken and fixed the same afternoon, and the numbers below
the line are the ones that stand.** AGENT-1 moved the `signal_pins:` ordering into the generator,
which is where item 7 said it belonged. The collision sweep went **26/20/17 → 8/3/0 → 4/0/0**;
**QFN88 and QFN128 are now a hard zero** (the `ceiling == 0` branch asserts empty, so one new
collision on either fails outright) and the four that remain are all QFN68, each named in the
file. I lowered the ceiling twice, both times by re-measuring TWICE and getting the same answer
rather than writing down whatever the last run printed — the data moved under the file all
afternoon, and a ratchet set from one noisy read is worse than no ratchet. CH32H417 also reached
**0 open rows**, with `disagreements:` going 0 → 45; I checked those rather than taking the
number — all 29 entries carry a `reason:` and a `source:` citing BOTH readings, and two were
spot-checked against the datasheet (`DS:3791` = `SERDES_TXP` on the Table 2-1-1 PE3 row,
`DS:7341` = `SERDES_RXP PE3` in Table 2-2-20; the readings genuinely swap, both recorded,
neither picked). **0 open rows is not the same as finished, and this cycle is the proof:** the
ledger asks whether every DATASHEET fact is accounted for, not what the app DOES with it, and
asking the second question found 63 collisions on the day the first reached zero.

**State.** `python build.py && node tests/run.js` → **1 FAILED, 681 passed, 0 skipped** — the
one failure is `dist/index.html is not stale`, caused by another agent rebuilding dist mid-run
(the runner says so itself), and green on a quiet re-run. All 13 CH32H417 failures below are
gone. The superseded reading, kept because it is what the checks caught when they first ran:
**13 FAILED, 657 passed, 0 skipped.** All 13
are CH32H417 data and none is mine: 8 × `h417_ltdc` + 3 × `h417_packages` are the collision
defect above, 1 × `codegen_compile` is the fixtures going stale under AGENT-1's edits DURING the
run, and 1 × `h417_af` was a GOOD failure reporting a gap being CLOSED (`I2S2_MCK PC6 AF5` is
now routed) — fixed by verifying the routing and removing the line, not by trusting the list.
The runner also warned `dist/index.html` was rebuilt mid-run; the tree is shared and we are
stepping on each other. Data gates green: `validate_mcu.py` 0 errors / 166 warnings,
`verify_sdk_names.py` 0 errors, `coverage gate: 6 of 6 part(s) meet their declared status`.

`python tools/coverage.py --quiet` at 2026-09-12T16:36Z —

```
  CH32H417   OPEN 50   (modelled 1254, absent 23, disagreements 0)
  CH32L103   OPEN 12   (modelled 260, absent 11, disagreements 1)
  CH32V003   OPEN 3    (modelled 113, absent 10, disagreements 0)
  CH32V005   OPEN 0    (modelled 214, absent 14, disagreements 0)
  CH32V006   OPEN 0    (modelled 218, absent 11, disagreements 0)
  CH32X035   OPEN 0    (modelled 278, absent 11, disagreements 0)
```

**CH32H417 is NOT done and is not reported as done: 50 open rows, and 26/20/17 default
collisions.** The DONE line still reads **"builds, not flashed"**, and nothing this cycle came
near changing that — every green result here is a compile.

**Next, in order.** (a) Re-run the suite when the tree is quiet and regenerate the two CH32H417
fixtures once AGENT-1's data settles — they went stale twice in one cycle. (b) The moment the
collision counts move, lower `COLLISION_CEILING`; if AGENT-1 fixes it in the generator the three
numbers should fall together, and a fall in only one is worth reading. (c) `src-tauri` still has
not been relinked since round 4 — `cargo build` green is not a window opening, and PROGRESS.md
must keep saying so. (d) The CH32H417 analog fixture claims (OPA/DAC) are still commented out in
`make_fixtures.js` waiting on `codegen.analog_signals`; uncomment them the cycle AGENT-1 lands it
and confirm from the GENERATED C that those four pads read `GPIO_Mode_AIN` with no AFR write and
no TODO. (e) The day CI is readable, read the `Coverage ledger` step's result and post it — it
is the third data gate and nothing has ever seen it run.
