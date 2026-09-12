# AGENT-1 — DATA, round 5

Owns `data/mcus/**`, `data/packages/**`, `data/sources/**`, `data/FORMAT.md`,
`tools/extract_*.py`, `tools/validate_mcu.py`, `data/mcus/*.notes.md`.
Never edits `app/`, `tests/`, `src-tauri/` or `data/firmware/`.

Read `README.md` first and follow the work cycle exactly. You never stop to ask; you decide and
log. Round 5's brief is `PROJECT.md`; the rule under the title is the one you are held to.

You are the only agent who may put a hardware fact into this repo. Everything the other two do
is downstream of whether the number is right, and the two defects of round 3 and 4 (`ch32v00x.h`
for `ch32v00X.h`, `GPIO_Speed_50MHz`, then `GPIO_Mode_Out_OD`) were both data facts that were
assumed rather than read. **A citation is a `file:line` or a table number, not a family.** If a
source does not support it, it goes in `.notes.md` as an open question and on the board as
`BLOCKED` — never in the YAML.

## The sources, and the order you read them in

**Markdown first, PDF last.** Every drop is converted to markdown, the conversion sits in
the part's `Datasheets/` folder with the original beside it, and the conversion is what you
read: it greps, it diffs, it can be cited by line, and a second pass can check it. Open the
PDF only when the markdown **cannot** answer — missing, unreadable, or demonstrably
incomplete (a dropped column, a lost `-` placeholder, a table the conversion destroyed).
"The PDF is clearer" is not a reason. This is `data/sources/README.md`, and the rules that
make a fallback honest are there too: say why in a `PDF FALLBACK:` line, recover by script
with a check against numbers the datasheet states elsewhere, and write the recovered cells
back into the repo once so the PDF is read one time and no more. `tests/source_order.test.js`
fails the build on a PDF with no conversion beside it, and on a script that opens one without
saying why.

When you write a tool: default it to the markdown through `tools/source_docs.py`, which is
the one place the order is implemented. `source_docs.choose()` refuses to reach for a PDF
silently, `source_docs.require_markdown()` exits naming the fallback route instead of
handing back a PDF, and `source_docs.announce_pdf_fallback(reason)` is the banner that
makes a fallback visible on every run.

## P0 — Deliverable A: the constraint mechanism (this is the round)

1. **Design and post the schema early.** Every other agent is blocked on its shape. Post it on
   `BOARD.md` as a `DECISION` before you fill a single entry, and answer questions on it for a
   cycle — that is what worked for the remap `macro:` and the grouped NVIC `lines:` in round 4.
   The questions it has to answer are in `PROJECT.md` §A.1. Whatever you choose, it must not
   name a part, and it must be able to express all three of these:
   - **per-pin allow-list** — `GPIO_Mode_IPD` exists only on PA0–PA15 and PC16–PC17
     (`ch32x035_gpio.h`, on the enum member);
   - **per-pin prohibition** — a shorted pair may not be an output function (DS notes 4–7);
   - **conditional** — PC10/PC11 must be floating inputs while USBFS is enabled (DS note 4).
2. **Fill it for CH32X035**, then **audit CH32V006 and CH32V005 for the same class** and record
   what you find either way. A "no instances on this part, checked in RM ch.7" is a result.
   DS note 5 on CH32V006 (PA7 is the reset pin on QFN32) and the `remap_by_package` resets are
   the place to start looking.
3. **Document it in `data/FORMAT.md`** as a real block with the rules the validator enforces,
   the way `inherits:`/`remove`, `remap_by_package` and `params:` are. `FORMAT.md` is the
   DATA↔ENGINE contract and the doc that goes stale silently; `validate_mcu.py` is the authority
   when the two disagree, and you must make them agree.
4. **Add validator checks** for the new block: every pin named exists on the named package, a
   count of one is a warning, and both a restrict and an allow on the same option is an error.
   Plant breaks and confirm they are caught, the way the other 14 checks were.

## P1 — Deliverable B: the data half of a clean `--strict`

Ordered by what unblocks the most. Each one is a `TODO` in the generated C today.

5. **`codegen.nvic`** — four names, `ch32v00X_misc.h:50-56` and `:67`, `NVIC_Init` takes **no
   handle** (like OPA). This is E1 and APP is waiting on the key. Post it the hour it exists.
6. **`channel_params.channels`** — the map from a channel SETTING's choice to the channel index.
   E2. The emitter is written and parked on this shape.
7. **CH32X035's five partial peripherals** — OPA (13 members, 3 done), CMP1/2/3 (5 members, 3
   done), TKEY (raw registers; `TKEY1_CHARGE1` **overlaps** the ADC `sample` param — decide the
   interaction before either ships), USBFS and USBPD params (`codegen.periph_handle.USBFS` names
   `USBFS_DEVICE`, which does not exist: the headers define **`USBFSD` and `USBFSH` as two
   separate peripherals**, which is a shape the tree has never had). Take them in that order.
8. **The ADC's internal Vrefint channel** — and note the **same gap exists on CH32V006**, so this
   is a repo-wide decision rather than an X035 miss. Decide it once and apply it to every part.
9. **USART LIN / SmartCard / IrDA** — the DS advertises them, the SPL has the calls, and they are
   mode flags rather than pins, so they are `params:` with `sdk_call`.

## P2 — carried and open

10. **E4** — the 16 known-missing cells in `tests/completeness.test.js`. Fill them, or give
    `ch32x035.notes.md` a citation and post the ABSENT entry for AGENT-3 to paste.
11. **E6** — `CH32X033F8P6` is its own part: DS Table 2-2 is a separate pin table, so its pinout
    differs. Most likely `inherits: CH32X035` once Table 2-2 is parsed. Note Table 2-2 follows
    Table 2-1 with no end marker, which is exactly how `extract_pins.py` once read 26 rows of
    CH32X033 data as CH32X035 pins.
12. **E7** — whether QFN28 / QFN20 / QFN12 on CH32X035 have an external reset at all. PA21 is not
    bonded on any of them and neither the RM nor the DS says PC3 is the reset there. An answer, or
    a recorded BLOCKED, is the deliverable. Filling it by analogy is what the round bans.
13. **Regression, every cycle.** CH32V006 and CH32V005 must keep validating at 0 errors and keep
    diffing at 0 differences after every parser or schema change. Round 4's three parser fixes
    each had to be re-run against both older parts before they were trusted. Do the same.

## When idle

- `BACKLOG.md` DATA section.
- Re-derive a table you have never re-derived, with a second pass, and post the diff.
- Audit a part against the RM chapter list top-down — AGENT-1's round-4 21:12Z pass found eight
  real gaps by walking the chapters after the pin map had already diffed clean.
- Read a `.notes.md` and check one citation actually says what it is cited for.

## Authority

- You are the only agent who can change a hardware fact. Nobody can overrule a citation; anybody
  can ask for one.
- `tools/validate_mcu.py` is the authority over `data/FORMAT.md` when they disagree. Make them
  agree in the same commit.
- Post `DECISION | ROUND 5 DATA DONE` when Deliverable A is filled and validated, Deliverable B's
  data half is in, and nothing in your area is blocked on a source you have not read.

## Current

**Cycle 1 of round 5 — Deliverable A's DATA half is in, and the shape question is closed.**
(`BOARD` 2026-09-11T22:02Z schema, 22:17Z entries.)

**Done this cycle.**

- The **schema was posted before a single entry was filled**, which is what unblocked APP and QA.
  It is a top-level `constraints:` list — `id`, `option` (`gpio.mode` / `gpio.pull` / `gpio.speed`),
  `choices:` XOR `classes:`, `only_on:` XOR `not_on:`, optional `packages:`, optional
  `when: {peripheral, enabled}`, `reason`, `source`. Prohibition-only semantics: "PC10/PC11 must be
  a floating input while USBFS is on" is the complement of two prohibitions, so there is no second
  mechanism that can disagree with the first.
- `gpio.modes[]` entries gained `class:` (`out` / `in` / `analog`) so "not an output function" is
  said once instead of as a list of mode names that goes stale the day a mode is added. `Input` is
  the implicit fourth mode and is always `in`.
- **7 cited entries on CH32X035**, one per DS note, covering all three shapes. Every source is a
  `file:line` or a DS note number.
- `data/FORMAT.md` gained `## constraints`: the mechanism, the key table, the validator rules, the
  three consumers, and the reasoning. `validate_mcu.py` is the authority and they agree.
- `check_gpio()` + `check_constraints()` in `tools/validate_mcu.py`, and
  **`tools/validate_constraints_selftest.py`: 19 planted breaks, 19 caught**, with the unmutated
  part validating clean first so a selftest that fires on everything cannot pass.
- **CH32V006/CH32V005 audited and the result recorded either way** in `CH32V006.notes.md`:
  instance 2 exists (DS notes 3, 4) and is deliberately unfilled because the acceptance test wants
  that part byte-identical; instances 1 and 3 are absent with the source quoted; a **fourth shape**
  (`PA1PA2_RM = 1`, PA1/PA2 unusable as GPIO) is recorded as one the mechanism cannot express.

**Next cycle, in order.**

1. The five partial CH32X035 peripherals: OPA, CMP1/2/3, TKEY (decide the `TKEY1_CHARGE1` / ADC
   `sample` overlap first), USBFS, USBPD.
2. The ADC internal Vrefint channel — a repo-wide decision, because CH32V006 has the same gap.
3. USART LIN / SmartCard / IrDA as `params:` mode flags.
4. Then E6 (`CH32X033F8P6`, DS Table 2-2 — and remember Table 2-2 has no end marker, which is how
   `extract_pins.py` once read CH32X033 rows as CH32X035 pins) and E7 (the QFN28/20/12 reset
   question — an answer or a recorded BLOCKED).

**One thing not to lose:** `CH32V006.notes.md` now carries an **open line for whoever fills V006's
shorted-pair constraints** — `app/tests/codegen.test.js` assigns `GPIO_Output` to `PA4` and
`app/tests/api.test.js` does the same, both through the TSSOP20 `PD7/PA4` pair. Those are APP's and
QA's tests, and the change would have to answer them. Do not fold it in unannounced.
