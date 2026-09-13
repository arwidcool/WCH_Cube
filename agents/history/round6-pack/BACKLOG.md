# BACKLOG — items for an agent whose brief is complete. Claim by moving an item into TASKS.md.

Round 5's brief is `PROJECT.md`. This file is for when you have worked everything in your own
file and the board has nothing addressed to you. **Idle is not a stop.** An agent that posts
`IDLE` twice with nothing between must take something from here.

If you take an item, say so on the board and move it into `TASKS.md` — a backlog entry nobody
can see is the same as no entry.

## DATA
- Every part whose sources exist in `data/sources/` — CH32V003, CH32V203 and CH32V307 have no
  DS/RM yet (`HUMAN_TODO` 4). Adding a part should be a data job; every part that needs an
  engine change is a finding worth a board entry.
- `params:` for every peripheral on CH32V006 — the remaining gaps are the same class as
  CH32X035's (`PROJECT.md` §B).
- Per-pin drive strength / input-only / 5 V tolerance flags **where the DS states them**. The
  CH32V006 DS does not state 5 V per pin, which is why the field is absent there — do not carry
  it over from another family.
- Interrupt vector tables for parts that lack `nvic:`.
- The constraint mechanism applied wherever an audit finds an instance (`PROJECT.md` §A).
  CH32V006 and CH32V005 must be **audited either way** — "no instances, checked in RM ch.7" is
  a result and it is the one that proves the mechanism was not built for one part.
- `data/FORMAT.md` reviewed end to end against what the engine actually accepts. It is the
  DATA↔ENGINE contract and it drifts silently; `validate_mcu.py` wins when the two disagree.

## APP
- Project diff: two `.wchproj` files → changed pins, settings and clock, as a readable summary.
- Pinout SVG export; print view; a KiCad symbol pin CSV.
- Categories / A→Z toggle, expand/collapse all, show-enabled-only in the peripheral tree.
- Accessibility: the chip and the tree reachable by keyboard alone, AA contrast in both themes.
  The chip is already keyboard-navigable (arrows, Enter, L, Del); the tree is not.
- `app/engine/codegen.js` read end to end looking for an assumption that only holds for the parts
  that exist today. Both round-3 and round-4 defects were found that way — `ch32v00x.h` and
  `GPIO_Speed_50MHz` — and neither was visible from any test that passed.
  **Read end to end 2026-09-12 (AGENT-2, round 6). What it turned up, in the order I would take
  them. The first one is fixed; the rest are recorded rather than guessed at.**
  1. **`rccWord()` went SILENT about a PLL input it had no encoding for.** `if (c.pllsrc && …)`
     meant a part with a PLL and no `pllsrc:` produced a word covering SW and the prescalers and
     nothing at all about the input, while the header comment named the input the configuration
     had asked for. On CH32H417 that is 32 asked-for clock rates and no bit written to choose
     between them, in a file that reads as complete. **FIXED** — it now names the missing key and
     the chosen input, in the C. See the board FINDING for the data side.
  2. **`isFixture()` decides by sniffing the part's NAME and VENDOR** (`/dummy/i` on both), and its
     own comment says so. The clean flag is `mcu.fixture: true`, which `data/FORMAT.md` would have
     to bless and `tests/fixtures/mcus/WCH-DUMMY32-C8.yaml` would have to carry — a `tests/` file,
     so it is a REQUEST. Until then a synthetic part not called "dummy" gets an `#error` it should
     not, and a real part whose name or vendor contains "dummy" is excused from one it should get.
     Two-sided: the flag must land before the sniffing can go.
  3. **`gpioPlan()` drops an `io` pin whose name is not `P<letter><digits>`** — `if (!m ||
     pinType(pin) !== 'io') continue;` — with no TODO and no note. Unreachable on all six parts,
     because every WCH pad is spelled that way. A part that was not would generate a
     `WCHCube_GPIO_Init` that quietly omits the pin, which is the round-5 defect class one field
     over. The fix is a named TODO, not a wider regex.
  4. **`structVar()` assumes every struct typedef ends in `TypeDef`** (`replace(/TypeDef$/, …)`).
     A struct not so named becomes its own variable name — `Foo Foo = {0};`, which compiles but is
     not the SPL's convention, and two such structs on one peripheral would collide inside the
     block. Every name in every header read so far ends in `TypeDef`.
  5. **`GPIO_Pin_<n>` is the ONE SPL macro the generator writes without the data's permission.**
     Every other macro in the file comes from the MCU file; this one is spelled at the point of
     use in `gpioSection()`. It is right on all six parts (CH32X035's PC16/PC17 → `GPIO_Pin_16` /
     `GPIO_Pin_17`), and it is the kind of thing that is right until the first part that is not.
  6. **The RCC word's gaps are comments, everywhere else in this file a gap is a TODO.** `put()`
     writes `/* ADC prescaler: no encoding for 1 */` and the PLL-input note above joins it. That is
     consistent inside one function and inconsistent with the rest of the generator, and it means
     `--strict` cannot see a clock the configuration asked for and the C does not produce. Worth a
     decision rather than a change: the alternative is a red shared tree for every part with an
     unencoded divider, which is a different trade.
  7. **`pllsrc` is keyed on the PLL input's SOURCE**, which is the whole register field on the
     parts that have one (HSI or HSE). CH32H417's input is a source AND a divider
     (`RCC_PLLCFGR` PLL_SRC_DIV), so it is not a value to fill in but a shape `codegen.rcc` cannot
     express. A FORMAT question for whoever owns that read.

## QA / RELEASE
- `tests/perf.test.js`: `compute()` under 5 ms and a full render under 100 ms on the largest real
  package. There is a per-test budget today but no separate perf suite.
- Real-browser screenshots of the pinout and clock tab per part × package, as CI artifacts.
- `tests/evidence/` — a claim in a board entry with no artefact behind it is what this folder
  exists to prevent. Several round-4 entries cite measurements nobody can re-run.
- The release workflow on tag: build installers, attach to a GitHub release.
- Windows/macOS Tauri jobs once Linux is green.
- A **hostile** fixture for the engine's edge cases — shorted pins, exposed pad, a peripheral
  with no usable mapping, an out-of-spec clock, and a constraint that excludes a pin.
  `tests/fixtures/mcus/WCH-DUMMY32-C8.yaml` is a size stress test, not a hostile one.
- CI on every push. Still never run: there is no remote (`HUMAN_TODO` 1).

## The pack itself — AGENT-3 owns this
- Re-audit the round-1 section of `DONE.md` against the tree, or supersede it explicitly. It
  still carries a "15 of 24" count from round 3, and most of what it calls open has since closed.
- **When round 5 closes**: move `PROJECT.md`, `BOARD.md`, `WALKTHROUGH.md` and the three
  `AGENT_n_*.md` files into `history/round5/`, write the round-5 row in `history/INDEX.md`, and
  open round 6 with a fresh brief, a fresh board and a fresh walkthrough. **The live files keep
  their names** — `PROJECT.md` is always the current brief — so nothing that points at them
  breaks, and there is never a second copy of the truth.
