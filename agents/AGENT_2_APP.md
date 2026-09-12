# AGENT-2 — APP, round 5

Owns `app/engine/**`, `app/template.html`, `app/tests/**`, `app/assets/**`, `build.py`,
`tools/wchcube_cli.js`. Never edits `data/`, `tests/`, `src-tauri/`.

Read `README.md` first and follow the work cycle exactly. You never stop to ask; you decide and
log. Round 5's brief is `PROJECT.md`.

**You are the merge of the old ENGINE and UI agents, and that is deliberate.** The seam between
them produced more board traffic than any other: a data-driven control, a codegen option and a
tab's render path are one change, and splitting them meant one agent describing a shape and the
other implementing it. Both halves now answer to you, so a change that spans
`app/engine/model.js`, `app/template.html` and `app/tests/` is one commit instead of three
handoffs. The obligation that comes with it: **the engine must not gain a DOM dependency and the
page must not contain engine logic.** The two remaining invariants are `tests/no_part_names`
(no part named in `app/`) and the fact that Node imports the same modules the browser bundles.

## Current — round 6 (brief: `PROMPT_AGENT_2_COVERAGE.txt`)

**Peripheral names and descriptions (HUMAN request).** Hovering a tree item showed `SDIO` and
nothing else; selecting it showed controls and no explanation. Now:

- **`app/engine/glossary.js`** — what each peripheral's name stands for and what that kind of
  block does. An acronym's expansion is *vocabulary* (one sentence on every part, so six files
  would be six copies of it — the same argument `PIN_KIND` and the GPIO mode lists follow).
  Keyed by name with the instance number stripped, so `USART7` → `USART`; an exact key wins, so
  `TIM1` is the advanced-control timer while `TIM` stays the general sentence.
- **`title:` / `desc:` on a peripheral** — the data override, each half independent, with
  `notes:` unchanged and still the part-specific paragraph below both. Documented in
  `data/FORMAT.md` (AGENT-1's file, recorded as a DECISION).
- **An unknown block is not guessed at**: no entry and no `title:` means the bare id and no
  description. `unnamedPeripherals()` lists them and the Tools tab prints the count.
  **Measured: 0 unnamed across all six parts**, and the 8 WCH-specific blocks
  (`PIOC`, `GPHA`, `ECDC`, `UHSIF`, `SDIO`, `SDMMC`, `SWPMI`, `SERDES`) carry the datasheet's
  own words with the line number.
- **The tooltip** is the tree item's `title=`, and the expansion went into the accessible name
  too. **The focus panel** gets a card: name, category and unit, one sentence on what the block
  does, then the part's own notes. `P.notes` used to print at the *bottom* of that panel; it is
  folded into the card now rather than printed twice.
- **Search by meaning** fell out of it: `secure digital` finds SDMMC and `input/output` finds SDIO.

Tests: 8 in `app/tests/glossary.test.js`. Two plants run and confirmed — deleting SDIO's entry
reddens 5, and making the instance regex greedy (`I2C1` → base `I`) reddens 5. **verified in
browser:** real Chrome at 1280/1920 × light/dark × 100 %/125 %, tooltips correct on
SDIO/USART1/GPHA/TIM2, the card renders with no overflow, console silent.

**Power setup + pin descriptions (HUMAN request).** Two things a user asked for and the format
could not say: what the supply and fixed-function pins ARE, and a Power setup under System Core.

- **36 pin descriptions**, every non-io pin of all six parts, each from that part's own datasheet
  section — voltage range, what it feeds, what to connect, and the caveats (VDDA must not exceed
  VDD; VIO18 is normally an LDO output; BOOT0 is a strap with no register).
- **`peripherals.<PID>.pins.supplies:`** — a NEW key, added to `data/FORMAT.md`,
  `tools/validate_mcu.py` and `tools/coverage_lib.py` (AGENT-1's files; recorded as a DECISION on
  the board, because the human asked for the feature directly). Each rail carries `name`, `pins`,
  `range`, `note` and a **required** `source`. A routing peripheral may carry `supplies:` alone —
  CH32L103's PWR holds the WKUP pad, so `none:` there would be a false claim.
- **A real hover card** on the chip: pin(s), number, what the type means, the notes, the supply
  rail the pad carries, and the current assignment. The SVG `<title>` carries the same words
  multi-line, because that is all a screen reader or keyboard user gets — the card is decoration
  on top of it, not a replacement.
- **The Power setup** is a Supplies table in the peripheral panel, rendered for whichever
  peripheral declares rails, so `app/` names no part and no peripheral.

Tests: 8 in `app/tests/power.test.js`, all over every shipped part. Two plants run and confirmed.
**verified in browser:** real Chrome, 1280/1920 × light/dark × 100 %/125 % — 9 rail rows on
CH32H417, the hover card shows VDDIO's range and the rail it must not exceed, no viewport edge
crossed, console silent.

**P0a: DONE and committed.** The conditional second init struct needed no new engine feature — it
works today through param-level `when:` — so the deliverable became the thing that was actually
missing: making a MIS-WRITTEN gate loud. `depProblems(pid, def)` in `app/engine/params.js` reports
a `when:` whose setting name does not exist, whose value is not one of the target's choices, whose
key names a parameter (the repair there is `depends_on:`, not `when:`), or that uses the prose
shape `{ setting: X, is: Y }`; `initPlan()` collects it over EVERY param and `periphBlock()` emits
a named TODO, so `--strict` exits 2 rather than shipping plausible wrong code. The `when:` on only
SOME of a struct's params is a data-discipline rule and is deliberately not reported (a struct may
legitimately mix gated and ungated fields). The shape DATA writes is on `BOARD.md` at 14:55Z.

Evidence: 8 new tests (6 in `app/tests/params.test.js`, 4 in `app/tests/codegen.test.js` feeding a
two-struct peripheral both ways and then with each hazard planted); **35 generated files across all
7 fixtures SHA-256 identical before/after** (HEAD engine mirrored into `%TEMP%`, same frozen data,
only the engine differing); compile `CH32V006_QFN32_full` → CH32V006K8U6 `pio run` SUCCESS,
Flash 9 032 B / RAM 712 B; `python build.py && node tests/run.js` 598 passed.

**It found three real defects in shipped data on the first run** — one dead gate on CH32L103, a
prose-shaped gate and a missing gate on CH32X035, the last two in a part `coverage.py` calls
`complete`. All three are on the board as FINDINGs with `file:line` and the repair; I have not
edited `data/` to fix them.

**P1: DONE and committed.** Two rows in the Tools tab's Peripherals table, both read by the engine
rather than computed in the page — `model.js` gained `openPadPeripherals()` and
`unclaimableSignals()`. The first renders the coverage ledger's queue with the owner named in the
data; the second reads `none` on every part that ships and exists to keep saying so. Verified in a
real browser at 1280/1920 × light/dark × 100 %/125 %, both rows present and none empty, zero
overflow, console silent.

**P2: DONE and committed.** `peripherals.<pid>.pins` is read by nothing as a routing — every other
`P.pins` hit is `M.pins`, `E.pins`, `remaps[].pins` or package geometry, and the only reads of a
peripheral's own block are P1's two, taking `open`/`owner`/`task`/`none`/`source`. `projectObject()`
serializes exactly `settings`, `remap`, `af_pins`, `params`, `channel_params` per peripheral, so a
fact about the MCU file cannot be written into a project opened on another part. Three tests in
`app/tests/model.test.js` on the fixture's three declarations (IWDG, WWDG, DMA1), and **both plants
that should fail were run and both failed** (`signalPinDefs` falling back to `P.pins`, and
`signalPins` doing the same). **One plant proved nothing and the test says so in its own comment**:
the byte-comparison test cannot catch either leak, because those three peripherals route nothing
and `afPlan()` skips them before it asks. A byte-comparison that cannot move is not evidence.

**P3: DONE.** `app/engine/codegen.js` read end to end for an assumption that only holds for the
parts that exist today. Seven findings in `agents/BACKLOG.md` under APP; the first is fixed:
**`rccWord()` went silent about a PLL input it had no encoding for**, so on CH32H417 a
configuration asking for `HSE /8 x 8` printed `SYSCLK 25 MHz from PLLCLK (HSE /8 x 8)` in the
header comment and then wrote the SW and HPRE fields and nothing else. It now carries a `PLL input`
note naming the missing key and the chosen input, and `app/tests/codegen.test.js` asserts the
missing/covered split by part name. The other six are one line each and none is a guess about
silicon: `isFixture()` sniffs the part's name and vendor; `gpioPlan()` silently drops an `io` pin
that is not spelled `P<letter><digits>`; `structVar()` assumes `*TypeDef`; `GPIO_Pin_<n>` is the
one SPL macro written without the data; the RCC word reports its gaps as comments where everywhere
else a gap is a TODO; and `codegen.rcc.pllsrc` is keyed on the PLL input's *source*, which cannot
express H417's source-and-divider field.

**`const:` — AGENT-1's twice-made REQUEST, implemented and answered on the board (18:10Z).** A
param carrying `struct:` + `sdk_field:` + `const: <macro>` is a member whose value is fixed by
*which instance this is*: written into the struct as a literal, never drawn as a control, never
stored, refused by `setParam`, dropped with a reason from a hand-written `.wchproj`, and skipped by
both `paramDefaults()` and `initState()`. It is deliberately not `readonly:`, which codegen filters
out of `initPlan` entirely and which would therefore drop the member instead of filling it. The
shared predicate lives in `util.js` (`isConstParam`) because `initState()` is in `model.js` and
`paramDefaults()` in `params.js`, and the latter imports the former. Six tests, and every plant that
should fail was run and failed. **Recorded limit:** the cross-module agreement test's loop over the
real files is vacuous until DATA writes its first `const:` member — measured — so the test also
loads a synthetic part that has one and asserts that it has one.

Also this cycle: repaired one duplicated YAML key in `data/mcus/CH32L103.yaml` (`BKP` had
`settings:` twice, so the file did not parse at all and every `fresh()` threw) — declared on the
board, behaviour-preserving, AGENT-1's file.

## P0a — one request from the coverage ledger (docs/COVERAGE.md)

CH32V003 is held at 3 open ledger rows for one reason that is yours: DS Table 2-1 and RM Table
7-10 give USART1 a synchronous clock pin (`UCK` on PD4 / PD7 / PC5) and the SPL drives it with a
**second** init struct, `USART_ClockInitTypeDef` + `USART_ClockInit` (`ch32v00x_usart.h:51-66,156`),
which the generator cannot emit or gate off today. DATA will not model the pin until it can be
configured — claiming a pad the generated C never drives is the round's defect class. A
`codegen.init_structs` entry that can be conditional on a setting's choice is the shape; post it
on the board and DATA closes the three rows the same cycle.

## P0 — Deliverable A: consume the constraint mechanism

DATA posts the schema on the board before filling it. Do not wait for the whole file — build
against the shape, and if the shape is wrong say so in the same cycle rather than after.

1. **Three consumers, and they must agree.** DATA's `PROJECT.md` §A.2 lists them; in this repo's
   terms:
   - **the GPIO table** — the control is absent, or its option list is reduced, **on that row**.
     A mechanism that greys a whole column when only some pins are affected has not solved it.
   - **the conflict engine** (`app/engine/engine.js`) — a claim that violates a constraint is an
     issue that names the constraint, the way an EXTI or DMA clash does today.
   - **codegen** (`app/engine/codegen.js`) — it never emits a combination the data forbids, and
     if it somehow reaches one it emits a `TODO` naming it rather than plausible-looking bits.
2. **A stored value the part forbids must degrade the way a stored speed already does.** Round 3
   fixed this once already: `gpioSpeedFor()` rewrites a saved speed the part no longer offers,
   falls back to the first legal one, and **reports what it dropped**. A `.wchproj` saved before
   the constraint existed, or one that violates it, must load with no console error and say what
   changed. Reuse that path rather than inventing a second one.
3. **CH32V006 and CH32V005 byte-identical.** Every existing test unchanged, and every generated
   file byte-identical for the same configuration. This is the half that catches a mechanism
   designed against one part, which is how rounds 3 and 4 each shipped a defect.

## P1 — Deliverable B: a clean `--strict`

4. **`codegen.nvic`** (E1) — land it the hour DATA posts the key. Round 4 wrote it as a comment;
   it becomes an `NVIC_Init` call. `NVIC_Init` takes **no handle**, like OPA.
5. **`channel_params.channels`** (E2) — the `TIM_OCInitTypeDef` emitter is written, tested against
   the proposed shape and parked. It needs the channel index from the data, not from reading the
   digit out of `"Channel1"`.
6. **Close every remaining `TODO` in generated C** across all three parts, so
   `--strict` exits 0 for every fixture — it exits 2 today.
7. **DMA and NVIC round-trip through `.wchproj`**, and regenerating after save → close → open is
   **byte-identical including DMA and NVIC**. Round 3 made this a DONE line and it is still open.
8. **USBFS host and device are two peripherals** on CH32X035 (`USBFSD`, `USBFSH`), which is a
   shape the peripheral tree has never had. The tree reads its categories from the file, so this
   may cost nothing — check rather than assume.

## P2 — carried

9. **E8-adjacent:** `window.generateProjectFiles()` and `window.desktopWriteProject` are the only
   two names the Tauri bridge looks for. If you rename either, AGENT-3's
   `tests/desktop.test.js` breaks and the desktop app stops writing projects. Say so on the board
   in the same commit if you must.
10. **The page owns the layout, the shell owns only where the root goes.** That split is what lets
    the browser ship the identical file list as a ZIP. Keep it — a path decision in
    `src-tauri/desktop.js` is a cross-area edit.
11. `app/tests/**` is yours: engine unit tests plus the api coverage floor
    (`tests/features.test.js` requires 90 % of `app/engine` exports to be referenced). A new
    engine export needs a test in the same commit or the floor drops.
12. `tools/wchcube_cli.js` must stay byte-identical to what the app produces for the same
    configuration. `app/tests/cli.test.js` asserts it; if the two ever drift, a generated-output
    diff stops being evidence about the app.

## When idle

- `BACKLOG.md` ENGINE and UI sections — the project diff, the KiCad pin CSV, the A→Z tree toggle,
  the print view, the accessibility pass.
- Read `app/engine/codegen.js` end to end looking for an assumption that only holds for the parts
  that exist today. Both round-3 and round-4 defects were found that way.

## Authority

- `python build.py && node tests/run.js` green before every commit. If you changed what the
  generator emits, **compile it** and say which configuration in the commit message.
- If you change the UI, **verify it in a real browser** at 1280 and 1920, light and dark, 100 %
  and 125 % zoom, and write `verified in browser` in the commit message. jsdom is necessary, not
  sufficient — three of the last two rounds' UI defects were invisible to jsdom.
- Post `DECISION | ROUND 5 APP DONE` when the three consumers agree, `--strict` is clean for
  every fixture, no part is named in `app/`, and CH32V006/CH32V005 are unchanged.

## Current

**Round 5, cycle 1 — deliverable A's three consumers are wired, to the DOCUMENTED schema.**

`data/FORMAT.md` `## constraints` is the contract (AGENT-1 posted it 22:02Z) and
`app/engine/constraints.js` is the only place it is interpreted. All three consumers read the
same `constraintFor(pin, field, choice)`:

- **the GPIO table** reduces the option list **per row** and puts the constraint's `reason` and
  `source` in that row's tooltip — never a greyed column;
- **the conflict engine** reports a violating claim as an issue carrying the author's reason and
  the constraint id (`E.constraintIssues`, plus the owning peripheral's issue list);
- **codegen** declines and emits the TODO the strict gate looks for.

`normaliseGpioConstraints()` is called from `projectApply()`, so a `.wchproj` that violates a
constraint opens with no console error and says what it dropped. **`gpioEffectiveMode()` is now
shared** — the engine used to look only at what the user stored while the generator derives a
mode for a peripheral's pin, which was one rule with two answers; it was moved, not copied, and
the generated C is byte-identical to the baseline.

Evidence: 510 tests ALL GREEN with no skips; `--strict` 0 on all four fixtures in both formats;
all four fixtures' `.c`/`.h` byte-identical to the pre-change baseline; verified in browser at
1280×720 and 1920×1080, light and dark, 100 % and 125 % zoom, no viewport overflow.

**Two things I got wrong and the gates caught, both worth remembering:**

1. My first consumer read a shape I invented (`gpio.constraints` with `field:`/`deny:`/`allow:`)
   because DATA's post was 20 minutes old and I had not seen it. The documented shape was
   already in `FORMAT.md` and already gated by `tests/constraints.test.js`. **Read the board and
   the data document before designing a schema, not after** — the whole point of shape-first is
   that the second mover does not re-design it.
2. I had `only_on`/`not_on` inverted. `only_on` is an allow-list, so the refused region is the
   **complement**; `not_on` is the exact deny-list. Inverted, it refused outputs on PA0 because
   PA0 was not in a `not_on` list — a mechanism that looked like it worked and was exactly
   backwards. QA's one-sided-check control ("an unshorted pin keeps the output mode") is what
   caught it.

**Next in my area, in order:** the USBFS/`classes: [out]` question I sent to AGENT-1
(2026-09-12T01:22Z) — if it is unanswered for two of my cycles it becomes my call, and the
least-invasive call is a `choices:`-based entry, which needs a DATA commit, not an APP one. Then
deliverable B's remaining evidence: `--strict` is already 0 on every fixture and every part ×
package, so what is left there is the tracked CH32X035 `params:` gaps arriving from DATA and
being consumed without an engine change — and if one needs one, that is a finding. Then the
`when: {peripheral}` shape is only used by two entries; a third consumer of it (a peripheral's
own state making another pin illegal) is where a part with a different coupling would prove the
mechanism was not built for one chip.

### The audit that followed, and it paid twice

Same cycle, after the three consumers were green: read `app/engine/codegen.js` end to end for an
assumption that only holds for the parts that exist today — the exercise that found
`ch32v00x.h` in round 3 and `GPIO_Speed_50MHz` in round 4. Then a machine pass: on every part ×
every package, switch each peripheral on **one at a time** and list any complaint that is not a
pin conflict. Two real findings, both fixed in this cycle:

1. **`assignSignal()` stored this app's mode vocabulary, not the part's.** The literals
   `"Output Push Pull"` / `"Analog"` / `"Input"` went into `S.gpio[pin].mode`, while the macro is
   looked up in that part's `gpio.modes` — so a part that spells its plain output mode
   differently would store a name its own file does not carry and emit a TODO for a mode the
   silicon does have. Latent, because every shipped part spells it the same way. Now
   `gpioModeForSignal()`, with the literal kept as the **fallback**.
2. **CH32X035 TSSOP20 and QSOP28 emitted a spurious remap TODO on every configuration with a pin
   assigned** — a live defect: `--strict` exited 2 for `genericCH32X035F7P6`. `SYS`'s reset pin
   is bonded to PC3 on those packages (`remap_by_package`), its table carries no `macro:` because
   the reset pin is an option-byte setting and not a remap, and the "the data cannot apply the
   selected remap" filter asked only "is a non-zero index selected". QFN28 was unaffected, which
   is why the compile fixture never caught it. My first fix was too broad and broke two existing
   tests; the right rule came out of that, and it is data-driven: **does any signal this
   peripheral requires actually reach a GPIO register** (`codegen.skip_signals`). A check now
   assigns a pin on every part × every package and demands zero complaints.

Lessons worth keeping: a **default** configuration never reaches the remap section (no GPIOs
means an early return), so "the fixtures are green" is not evidence about that code path — the
package you did not put in the fixture is the one that is broken. And when a fix breaks two
existing tests, the tests are usually telling you the rule you actually want.

