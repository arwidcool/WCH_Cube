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
