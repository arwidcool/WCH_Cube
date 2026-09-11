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

## When idle
- Improve `.notes.md` confidence table; convert "Medium" entries to "High" by finding the RM table.
- Add `analog: true`, 5V-tolerance, drive strength notes per pin wherever the DS states them.
- Write `data/FORMAT.md`: the full YAML schema, with every field explained, kept in sync with the engine.

## Current

**Cycle of 2026-09-11. All green: `extract_remaps` exit 0, `validate_mcu` exit 0,
`build.py` OK, `node tests/run.js` ALL GREEN (85 tests). No commit hash — this checkout is
not a git repo (logged on BOARD at 02:10Z).**

Done this cycle, in priority order from this file:

1. **Second pass (priority 1) — complete.** `tools/extract_remaps.py` re-parses RM 7.2.11
   with its own parser and diffs the YAML: 7 peripherals, 31 signal rows, **232 pin
   assignments, 0 differences**. Negative-tested against planted pin edits. Then added a
   **third pass** the brief did not ask for: the same grids diffed against the AFIO_PCFR1
   register prose in RM 7.3.2.2, which states every remap a second time — **227 of 228
   confirmed by two independent descriptions**. DONE.md data line 1 is met with evidence,
   not with a careful read.
2. **Priority 2 — complete.** CH32V006 gained the EXTI line→pin map, the DMA1 7-channel
   request map, option-byte RST_MODE as four SYS choices, TIM1_RM=11xx (CH1 from LSI), and
   TIM2 complementary outputs on the CH3/CH4 pins (RM 12.3.9, which the first pass missed).
3. **Priority 3 — complete.** `tools/validate_mcu.py`. It was rewritten by another agent
   mid-cycle; I kept the rewrite and restored the key whitelists it dropped, plus fixed a
   crash on off-drive paths. See BOARD 03:40Z.
4. **`data/FORMAT.md`** written (was a "when idle" item).

Two findings worth carrying forward:

- **The unquoted-comma trap.** A comma inside a YAML flow mapping truncates the value and
  turns the rest into a null key. The file still parses and the app still loads, but the
  app keys setting state by choice name, so two truncated names collapse into one option.
  Four live instances found and fixed. The validator now rejects unknown keys for exactly
  this reason — do not remove those whitelists.
- **The RM contradicts itself once.** RM 7.3.2.2 writes USART2_RM=101 RTS as `PA11`; port A
  stops at PA7 and Table 7-11 says `PA1`. The YAML follows the table. Expect the same typo
  when extracting other CH32V00x parts.

Next, in order:

1. **CH32V005** — blocked on AGENT-2 answering the `inherits:` shape (BOARD 02:50Z).
   Proposal is deep-merge plus a `remove:` list, resolved in the loader.
2. **CH32V003 and later parts** — blocked on sources. `data/sources/` has only the V006
   datasheet and the V00X reference manual. Asked once at 03:05Z; will not ask again.
3. **Unblocked meanwhile:** convert the remaining Medium-confidence rows in
   `CH32V006.notes.md` to High — TouchKey channel→pin from RM ch.10, and the OPA polling
   channel set. Then the remaining option bytes (START_MODE, STANDBYRST, IWDG_SW).
