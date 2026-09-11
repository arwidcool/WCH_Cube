# AGENT-1 — DATA. You own everything under `data/` and `tools/extract_*`.

Read `agents/README.md` first and follow the work cycle exactly. You never stop to ask; you decide and log.

## Mission
Make the MCU description files complete, correct, and provably consistent with the WCH datasheets and
reference manuals. Every number you write must be traceable to a DS/RM table noted in `<mcu>.notes.md`.

## Priorities (in order)
1. Second-pass verification of `data/mcus/CH32V006.yaml`: re-extract each remap table from
   `data/sources/CH32V00XRM.md` (7.2.11) with a script (`tools/extract_remaps.py`), diff against the YAML,
   fix the YAML if the script is right, fix the script if the YAML is right, log the outcome on BOARD.
2. Add to CH32V006: EXTI line→pin mapping (RM ch.6 / AFIO_EXTICR), DMA channel table (RM ch.8),
   TIM1_1_RM (CH1→LSI) note, option-byte RST_MODE values (RM ch.18).
3. `tools/validate_mcu.py` — schema check, every remap pin exists in `pins`, every package pin exists,
   I/O count per package equals DS model table, signals identical across remaps of one peripheral, no
   duplicate pin numbers. AGENT-2 runs this in the test suite; keep exit codes meaningful.
4. CH32V005 file via an `inherits: CH32V006` mechanism: file lists only differences (drop TKEY, TIM3, OPA
   polling). Coordinate the `inherits` semantics with AGENT-2 through a BOARD REQUEST before writing it.
5. Next parts in this order if their sources appear in `data/sources/`: CH32V003, CH32V203, CH32V307,
   CH32X035. If sources are absent, post `REQUEST(→HUMAN)` once, then continue with other work.
6. Package library: add any package a new MCU needs; verify pitch/body from DS chapter 4.

## Open requests addressed to you — answer these first, in this order. ALL are unblocked.
1. **CH32V005** — UNBLOCKED since 04:50Z. AGENT-2 shipped `inherits:` with exactly your proposed shape:
   `mcu.inherits: CH32V006`, `mcu.remove: [peripherals.TKEY, peripherals.TIM3]`, own `mcu.variants`.
   Lists replace wholesale, maps merge, `variants` replaces. Write `data/mcus/CH32V005.yaml` now.
2. **Large dummy packages** (AGENT-3 01:04Z, AGENT-4 01:35Z) — add LQFP64/LQFP100/LQFP144 tables (and the
   `pins:` they need) to `WCH-DUMMY32-C8.yaml`. AGENT-3 left a fragment in their scratchpad; if that path is
   gone, invent a plausible 9-port map. Closes a DONE line with zero code changes.
3. **`codegen:` block for CH32V006** (AGENT-2 05:43Z) — copy the worked example from
   `app/tests/codegen.test.js`, VERIFY every lsb against RM 7.3.2.2 and 3.4.2, record the check in the notes
   file. Encode ADCPRE and ADC_CLK_MODE (bit 31) as two slices so `ADC: 1` is expressible.
4. **`codegen.analog_signals`** (AGENT-2 05:44Z) — ADC1 IN0–IN7, TKEY CH0–CH7, OPA P0–P3/N0–N2/OUT0–OUT1.
   Triggers (RETR*/IETR*) are digital.
5. **Repeated supply-pin names** — DECIDED by HUMAN (BOARD 11:30Z): keep `VSS`/`VDD` repeated as the
   datasheet does; only `type: io` names must be unique. `validate_mcu.py` warns for io duplicates only.
6. `tools/validate_mcu.py`: keep the key whitelists. Add a check that a choice `name` containing a comma is
   quoted (the unquoted-comma trap you found).

## Priority 7 — peripheral parameters (AGENT-2 and AGENT-3 are idle waiting for this)
Define `params:` on a peripheral in `data/FORMAT.md` yourself — you own the format: a list of
`{ name, type: int|float|enum|bool, default, min?, max?, options?, unit?, depends_on? }`. Fill it for CH32V006
USART1/2 (baud, word length, parity, stop bits), SPI1 (prescaler, CPOL/CPHA, first bit), I2C1 (speed,
addressing), TIM1/TIM2 (prescaler, period, counter mode, per-channel PWM mode/polarity), ADC1 (resolution
per DS, sample time, continuous). Source each from the RM register descriptions. Post
`HANDOFF(→AGENT-2,AGENT-3)` when the FIRST peripheral lands so they build against it while you fill the rest.

## When idle
- Improve `.notes.md` confidence table; convert "Medium" entries to "High" by finding the RM table.
- Add `analog: true`, 5V-tolerance, drive strength notes per pin wherever the DS states them.
- Write `data/FORMAT.md`: the full YAML schema, with every field explained, kept in sync with the engine.

## Current

**Cycle 2 (2026-09-11). Every one of the six queued requests is answered and priority 7 is
delivered.** `validate_mcu` exit 0, `extract_remaps` exit 0 (232 pin assignments, 0
differences), `extract_pins` exit 0 on CH32V005, `build.py` OK. Commits: aff1da4, the
line-ending fix, d97f9b9.

| # | Queue item | State |
|---|---|---|
| 1 | CH32V005 via `inherits` | done — pinout machine-verified against DS Table 2-2 |
| 2 | Large dummy packages | done — LQFP64/100/144 + ports E..I, 151 pins |
| 3 | `codegen:` block | done — every bit position re-read from the RM |
| 4 | `codegen.analog_signals` | done — ADC1, TKEY, OPA1; triggers excluded, they are digital |
| 5 | Repeated supply pins | already implemented when I arrived |
| 6 | validate_mcu whitelists + comma check | done — added a raw-text flow-mapping check |
| 7 | `params:` | done — 35 parameters, 19 enums with register encodings |

**Four errors found by checking rather than copying.** These are the cycle's real output:

1. **ADCPRE /6 is 16, not 8.** Code 8 is `01000` = base /4 x1 = **/4**. The field is not a
   divider index: bits [4:3] pick a base (/2, /4, /6, /8) and bits [2:0] scale it
   (x1, x2, x4, x8, x16), which reproduces all 21 rows of RM 3.4.2. The proposed value
   would have run the ADC 1.5x fast.
2. **ADCPRE has no /1 code.** Undivided HB clock is ADC_CLK_MODE at bit 31, a different
   field. `1` is left out of the map on purpose so the generator says so instead of
   emitting the /2 code.
3. **SPI has no TI frame format** on this family — no FRF bit anywhere in the RM.
4. **The ADC sampling-time list was wrong in every middle entry**, and its meaning changes
   with ADC_LP (RM 9.3.4).

Plus two corrections to my own earlier work: the clock note wrongly implied PB1/PB2 do not
exist (they do — one prescaler, three enable registers), and my Python writes had flipped
six files to CRLF against the repo convention.

**Not blocked on anyone.** Three tests are red; none needs a data change, and verified
one-line fixes for all three are on the board (AGENT-2 x2, AGENT-4 x1).

Next, in order:

1. Remaining Medium-confidence rows in `CH32V006.notes.md`: TouchKey channel→pin from
   RM ch.10, and the OPA polling channel set.
2. The rest of the option bytes — START_MODE, STANDBYRST, IWDG_SW, RDPR, WPR (RM 18).
3. `params:` for the dummy part, so the UI has something to exercise on a large package.
4. CH32V003 and the later parts the moment their sources appear in `data/sources/`
   (HUMAN_TODO 4). Asked once; not asking again.
