# AGENT-1 — DATA, round 2. Owns data/, tools/extract_*, tools/validate_mcu.py, data/FORMAT.md.

You were the bottleneck at the end of round 1: five requests waited on you. Round 2 starts with them.
Every item below is unblocked. Work top to bottom; post DONE on the board after each.

## P0 — support the clock fix
1. Confirm `clock:` in CH32V006.yaml and the dummy part expresses everything the UI needs: `sysclk.sources`
   lists HSI, HSE, PLLCLK; `pll.inputs` lists HSI and HSE (V006 has no /2 inputs — verify RM 3.4.2 PLLSRC);
   HSE has `min_mhz`/`max_mhz`; MCO `choices` list every RM MCO[2:0] value (SYSCLK, HSI, HSE, PLL). Add
   `clock.hse_signals: [XI, XO]` and `clock.hse_peripheral: RCC` so the engine knows which RCC setting to
   auto-enable when HSE is selected as a source (AGENT-2 consumes it). Document in FORMAT.md.

## P1 — the round-1 queue (unchanged, all unblocked)
2. `data/mcus/CH32V005.yaml` via `inherits: CH32V006` + `remove: [peripherals.TKEY, peripherals.TIM3]` + own
   variants (DS model table). Validate. Post DONE.
3. LQFP64 / LQFP100 / LQFP144 package tables on WCH-DUMMY32-C8 (plus needed `pins:`). Any plausible map.
4. `codegen:` block for CH32V006 — verify every lsb against RM 7.3.2.2 (AFIO_PCFR1) and 3.4.2 (RCC_CFGR0);
   ADCPRE + ADC_CLK_MODE (bit 31) as two slices. Record checks in the notes file.
5. `codegen.analog_signals` for CH32V006 (ADC IN0–7, TKEY CH0–7, OPA P/N/OUT).
6. validate_mcu.py: io-only duplicate-name warning; SYS first-choice warning → info; quoted-comma check.

## P1b — DMA and NVIC data (human: "DMA has no configuration"; every MCU must be fully featured)
6b. Extend `dma:` in FORMAT.md and CH32V006.yaml so the UI can build a DMA Settings tab. Current
    `dma.requests[ch] = [signals]` stays; add `dma.channel_params`: the fields of `DMA_InitTypeDef` in the
    WCH EVT SDK with RM-sourced options — direction (PeripheralSRC/DST), priority (Low/Medium/High/VeryHigh),
    mode (Normal/Circular), peripheral/memory increment, peripheral/memory data size (Byte/HalfWord/Word),
    M2M — plus `dma.request_defaults` per signal (e.g. USART1_TX: dir=MemoryToPeripheral, widths=Byte;
    ADC1: dir=PeripheralToMemory, width=HalfWord, circular typical). Source: RM ch.8 DMA_CFGRx, RM Table 8-2.
6c. Add `nvic:` to FORMAT.md and CH32V006.yaml: every vector from the RM interrupt table (ch.5 / PFIC):
    `{ name: USART1_IRQn, number, peripheral: USART1, description }`, plus `nvic.scheme` (PFIC priority
    bits, preemption/sub split options for the V2A core). Group vectors by owning peripheral so each
    peripheral's NVIC tab lists only its own; system vectors (SysTick, SW, NMI, HardFault) under NVIC itself.
6d. For every peripheral in the RM that is NOT yet in CH32V006.yaml (check the RM chapter list: PWR, FLASH,
    EXTI as a configurable peripheral, PFIC/NVIC, SysTick, TIM3 modes, OPA/CMP details, AWU auto-wakeup if
    present), add it with real settings — no empty "Activated" stubs. Post the list you added on the board.

## P2 — `params:` (unblocks the Parameter Settings tab)
7. Define `params:` in FORMAT.md: `{ name, group: Basic|Advanced, type: int|float|enum|bool, default, min?,
   max?, options?, unit?, depends_on?, register?: "USART_BRR" }`. Then fill for CH32V006 from the RM register
   chapters: USART1/USART2 (baud, word length 8/9, parity, stop bits 0.5/1/1.5/2, oversampling if present),
   SPI1 (baud prescaler 2..256, CPOL, CPHA, first bit, data size 8/16), I2C1 (clock speed, duty cycle, own
   address, addressing mode), TIM1/TIM2 (prescaler 0..65535, period, counter mode, clock division, repetition
   counter for TIM1, per-channel PWM mode 1/2 + polarity), ADC1 (resolution per DS, sample time cycles list
   from RM ADC_SAMPTR, continuous, scan, data align). Post HANDOFF(→AGENT-2,AGENT-3) after the FIRST one.

## When idle
- Any part whose DS+RM appears in data/sources/ (CH32V003, V203, V307, X035 in that order).
- 5 V-tolerance, drive-strength, input-only flags per pin where the DS states them.

---

## Current — round 2, cycle 1 (2026-09-11)

Commits: `cb6873a` (clock/HSE + validator), `d7c9efb` (DMA), `86e1e88` (NVIC + peripherals).
Gate after each: `validate_mcu` 0 errors, `python build.py`, `node tests/run.js` ALL GREEN 267.

| # | Brief item | State |
|---|---|---|
| 1 | P0 clock data | done — `hse_peripheral` / `hse_setting` / `hse_signals`; PLLSRC and MCO re-verified against the RM; HSE range corrected |
| 2 | CH32V005 | was already shipped; round 2 found and fixed two real defects in it |
| 3 | Large dummy packages | already shipped in cycle 2 |
| 4 | `codegen:` block | extended with `ctlr` (RCC_CTLR) and `rcc.mco` |
| 5 | `codegen.analog_signals` | already shipped; a stale inherited copy removed from CH32V005 |
| 6 | validate_mcu warnings | already applied by the human's decisions; four new checks added |
| 6b | DMA data | done — `channel_params`, `request_defaults`, `register`, `request_notes` |
| 6c | NVIC data | done — 29 vectors, PFIC scheme with its real two bits |
| 6d | Missing peripherals | done — PWR, FLASH, EXTI; four deliberate absences recorded |
| 7 | `params:` | shipped in cycle 2 for the big seven; five small peripherals still have none |

**Three defects found by checking rather than reading.** All three were invisible to every
existing test, and two of them were live in the shipped app:

1. **HSE maximum was 25 MHz and had no citation.** DS Tables 3-9 and 3-10 both say 3 / 24 / 32.
   The 25 appears once in the datasheet, in a footnote about the ESR of a 25 MHz crystal.
2. **CH32V005 inherited `codegen` entries for hardware it does not have** — TouchKey analog
   pins and a TIM3 clock enable. Its generated C would have configured both.
3. **CH32V005 had no DMA request map at all.** `mcu.remove` is applied after the parent is
   merged, so removing `dma.requests` deleted the child's own replacement defined right below
   it. Reproduced through `app/engine/inherit.js` itself: the engine's channel-clash detection
   has been dead on that part since it shipped. Data-side fixed; the engine semantics are a
   `QA-FAIL(→AGENT-2)` on the board, because any future child part will hit the same trap.

**One thing the PFIC will catch people out with.** `nvic.scheme` says two priority bits
because that is what `PFIC_IPRIORx` implements — RM 6.5.2.21 calls [5:0] "reserved, fixed to 0,
write invalid". Anyone building the NVIC tab from CubeMX muscle memory will reach for four bits
and a group selector; the validator now fails a range wider than its bits, so that mistake
cannot ship quietly.

**Two things the sources will not settle, recorded rather than guessed.** RM Table 6-1 has no
TIM3 vector although this part has a TIM3, and the PFIC's nesting depth is configured in a core
CSR this manual never mentions. Both are in `CH32V006.notes.md`.

Next, in order: the dummy part has no `dma` / `nvic` / `params` / `codegen` at all, so the new
tabs have nothing to render on a large package; then `params:` for TIM3, IWDG, WWDG, TKEY and
OPA1; then the Medium-confidence rows (TouchKey channel→pin from RM ch.10, the OPA polling
set). Not blocked on anyone.
