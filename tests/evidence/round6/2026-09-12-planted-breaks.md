# Planted breaks seen red - round 6, deliverable B

Captured from `node tests/run.js planted` on 2026-09-12T21:31Z. Each break mutates a COPY - a temp folder, the part's YAML text re-registered in memory, or the built page handed to `boot({html})` (tests/lib/mutant.js) - restores, and re-proves the baseline; the tree is never touched. The `planted refusal` lines are what the gate SAID when it refused.

```
  ok    validate_mcu.py catches a planted break in every new AF check  [8101 ms]
      planted refusal (painted): the peripheral tree is empty - #cats .item = 0
  ok    boot › planted break: a page whose peripheral tree never renders is caught as unpainted  [1143 ms]
      planted refusal (silent): [warn] planted: boot is not silent
  ok    boot › planted break: a page that writes to the console at boot is caught as not silent  [590 ms]
  ok    clock configuration (real browser) › planted break: a truncated #ck-pllin is caught on CH32H417 (the PLL source mux offers 8 of the 32 (source, divider) pairs CH32H417 has)  [1353 ms]
  ok    clock configuration (real browser) › planted break: a truncated #ck-sys is caught on CH32H417 (the SYSCLK mux offers 1 of the 3 sources CH32H417 has)  [1001 ms]
      planted refusal (SPL map): CH32ZZ999: neither data/sources/<dir>/Evt/EXAM/SRC/Peripheral/inc nor C:\Users\CIA\.platformio\packages\framework-wch-noneos-sdk/Peripheral/<series>/inc
  ok    codegen compile gate › planted break: a fixture part missing from the SPL map is NAMED, not silently skipped
      planted refusal (fixture freshness): STALE CH32V006_TSSOP20_full.wchproj
  ok    codegen compile gate › planted break: a corrupted fixture is reported STALE by --check  [318 ms]
      planted refusal (IN_EXTRACTION expiry): CH32H417's IN_EXTRACTION line "CH32H417: `params:` for the peripherals that have none" is TICKED in TASKS.md — the exemption has expired
      planted refusal (matrix): 40 CH32H417 cell(s) failed once the line was ticked
  ok    completeness › planted break: ticking an IN_EXTRACTION line in TASKS.md expires the exemption and the cells fail  [2903 ms]
  ok    coverage ledger › tools/coverage_selftest.py catches every planted break  [1963 ms]
      planted refusal (8080 preset): 8080 LCD, 8-bit (D0-D7, RS=A0, CS=NE1, RD=NOE, WR=NWE): no NWE
  ok    CH32H417 FMC › planted break: an 8080 preset missing its WR strobe is named by the completeness check  [429 ms]
      planted refusal (LTDC default): PA8 is the default for both LTDC_B3 and LTDC_R6
  ok    CH32H417 LTDC › planted break: putting PA8 back at the front of B3 re-creates the original R6/B3 collision, and it is caught
      planted refusal (nonzero): QFN128: 1 default pin collision(s) that an alternative pad was free to avoid.
        - USART1.Mode = "Asynchronous" puts USART1_TX + USART1_RX on PB14 — USART1_TX, USART1_RX had somewhere else to go
  ok    CH32H417 packages › planted break: a forced shared default pad is caught by the collision sweep as a regression  [47639 ms]
      planted refusal (dead pad): VBAT: bonded on QFN128, no peripheral routes a signal to it, and pins.VBAT.type is "mystery" — not one of power/ground/sys/reset/boot
  ok    CH32H417 packages › planted break: a bonded pad whose type is not a known pad type is reported dead
      planted refusal (pinless USB): USBFS: pins.none
  ok    CH32H417 USB › planted break: a USB controller re-declared as pinless is caught
      planted refusal (catalogue): parts in data/mcus/ the New Project list does not offer - CH32V003F4P6/TSSOP20
  ok    new project selector (real browser) › planted break: a part renamed in the bundle drops out of the catalogue, and the check names it  [917 ms]
  ok    sdk names › the SDK-name checker catches its own planted breaks  [21411 ms]
  ok    source order › the pairing check can fail: a planted PDF with no conversion is caught
      planted refusal (smoke sweep): CH32V006 / QFN32: nothing drawn (0 pins)
  ok    smoke (every MCU x every package) › planted break: a page that draws no chip is reported by the sweep for every package  [2877 ms]
ALL GREEN — 18 tests, 759 filtered out  (93.3s)
```
