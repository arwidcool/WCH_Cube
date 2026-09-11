# AGENT-2 — ENGINE, round 2. Owns app/engine/*, app/tests/*, build.py, tools/wchcube_cli.js.

## P0 — clock source selection bug (human-reported, blocks the round)
The user cannot select HSI vs HSE on the Clock Configuration tab. Whether the cause is in the engine or the UI,
you own the engine half and go first:
1. `setClock({sys:'HSE'})` and `setClock({pllIn:<HSE index>})` must ALWAYS be accepted when the MCU's
   `clock.sysclk.sources` / `clock.pll.inputs` contain that source. Never reject based on RCC state.
2. Add the CubeMX coupling: when a clock mutation makes HSE feed SYSCLK (directly or via PLL) and the RCC HSE
   setting (from `clock.hse_peripheral` / `clock.hse_signals`, AGENT-1 adds them; fall back to peripheral
   `RCC`, setting name containing "HSE") is at its neutral choice, set it to the first choice whose signals
   include both XI and XO ("Crystal/Ceramic Resonator"). Record as ONE undo step together with the clock
   change. Do NOT disable HSE when the user switches back to HSI.
3. `clockCalc()` must return, for the UI: `sources[name].mhz`, `sources[name].feeding` (bool), `pll.in`,
   `pll.out`, `sysclk`, `hclk`, each prescaler output, derived taps, `over[]`, `under[]`, and
   `selectable = { sys:[...], pllIn:[...] }` — the full lists from the data, never filtered by state.
4. Tests in `app/tests/clock.test.js`: every source selectable on both MCUs; HSE selection enables RCC HSE and
   claims PA1/PA2 (and conflicts if PA1 is already SPI1_SCK on remap 101); switching back to HSI keeps RCC HSE;
   HSE crystal out of DS range → `over` contains HSE; PLL ×2 maths; ADC min/max; USB target on dummy.
5. Post `HANDOFF(→AGENT-3)` with the exact `clockCalc()` shape so the UI binds to it, then coordinate on the
   board until WALKTHROUGH §4 passes in a real browser (AGENT-4 confirms).

## P1
6. `params:` support once FORMAT.md has it: `S.periph[pid].params` with defaults from data, validation
   (min/max/options/type), `.wchproj` round-trip, undo, `getParams(pid)` / `setParam(pid,name,value)`,
   `derivedParams(pid)` for computed rows: USART actual baud + error % (BRR from HCLK), TIM output frequency
   from prescaler/period/HCLK, SPI actual clock, I2C actual speed. Codegen emits `USART_InitTypeDef` etc.
   from params.
6b. DMA configuration (human-reported gap): `S.periph[pid].dma = { <signal>: { channel, dir, priority, mode,
    pinc, minc, psize, msize } }`; `addDmaRequest(pid, signal)` picks the first free channel from
    `dma.requests` and applies `request_defaults`; `setDmaField`, `removeDmaRequest`. Two enabled requests on
    one channel → hard conflict in `E.resourceIssues` (upgrade from the round-1 warning). Enabling DMA on a
    peripheral auto-enables DMA1 in System Core. `.wchproj`, undo, and codegen (`DMA_InitTypeDef` +
    `DMA_Init(DMA1_Channelx, …)` + `DMA_Cmd`) all cover it. Expose `dmaTable()` for the DMA1 overview
    (channel → request → owner → state).
6c. NVIC: `S.nvic = { <IRQn>: { enabled, preempt, sub } }` seeded from `nvic:`; `setNvic()`; enabling a
    peripheral's DMA or a mode that requires an interrupt suggests the vector (CubeMX marks it "enabled" by
    default for DMA); codegen emits `NVIC_InitTypeDef`/`NVIC_SetPriority` per enabled vector and the
    `NVIC_PriorityGroupConfig` for the chosen scheme. `.wchproj` + undo.
6d. Completeness by construction: the engine must not special-case peripheral names. Anything DATA adds with
    settings/params/dma/nvic must appear in the UI with zero engine changes. Test this with a synthetic
    peripheral in `app/tests/`.
7. Codegen for CH32V006 must have no TODO sections once AGENT-1's block lands; real part without a block →
   `#error`.
8. `tools/wchcube_cli.js` headless (load MCU + .wchproj → pin table / clocks / C) — CI diff target.
9. `build.py` refuses duplicate top-level declarations.
10. Adopt AGENT-3's `runHistory()` so there is one undo/redo implementation.

## Rule
Every bug fix ships with the test that would have caught it, in the same commit.
