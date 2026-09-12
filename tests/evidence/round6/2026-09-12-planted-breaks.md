# Planted breaks seen red - round 6, deliverable B

Captured from `node tests/run.js planted` on 2026-09-12T20:48Z. Each break mutates a COPY - a temp folder, or the part's YAML text re-registered in memory - and restores, then re-proves the baseline; the tree is never touched. The `planted refusal` lines are what the gate SAID when it refused.

```
  ok    validate_mcu.py catches a planted break in every new AF check  [8828 ms]
  ok    clock configuration (real browser) › planted break: a truncated #ck-pllin is caught on CH32H417 (the PLL source mux offers 8 of the 32 (source, divider) pairs CH32H417 has)  [1422 ms]
  ok    clock configuration (real browser) › planted break: a truncated #ck-sys is caught on CH32H417 (the SYSCLK mux offers 1 of the 3 sources CH32H417 has)  [1104 ms]
      planted refusal (SPL map): CH32ZZ999: neither data/sources/<dir>/Evt/EXAM/SRC/Peripheral/inc nor C:\Users\CIA\.platformio\packages\framework-wch-noneos-sdk/Peripheral/<series>/inc
  ok    codegen compile gate › planted break: a fixture part missing from the SPL map is NAMED, not silently skipped
      planted refusal (fixture freshness): STALE CH32V006_TSSOP20_full.wchproj
  ok    codegen compile gate › planted break: a corrupted fixture is reported STALE by --check  [351 ms]
  ok    coverage ledger › tools/coverage_selftest.py catches every planted break  [2527 ms]
      planted refusal (nonzero): QFN128: 1 default pin collision(s) that an alternative pad was free to avoid.
        - USART1.Mode = "Asynchronous" puts USART1_TX + USART1_RX on PB14 — USART1_TX, USART1_RX had somewhere else to go
  ok    CH32H417 packages › planted break: a forced shared default pad is caught by the collision sweep as a regression  [33709 ms]
      planted refusal (dead pad): VBAT: bonded on QFN128, no peripheral routes a signal to it, and pins.VBAT.type is "mystery" — not one of power/ground/sys/reset/boot
  ok    CH32H417 packages › planted break: a bonded pad whose type is not a known pad type is reported dead
  ok    sdk names › the SDK-name checker catches its own planted breaks  [18227 ms]
  ok    source order › the pairing check can fail: a planted PDF with no conversion is caught
ALL GREEN — 10 tests, 746 filtered out  (69.1s)
```
