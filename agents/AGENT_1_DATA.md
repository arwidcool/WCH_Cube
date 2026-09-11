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
(rewrite this section every cycle: what you're doing, what's next, last commit hash)
