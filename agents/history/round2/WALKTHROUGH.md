# WALKTHROUGH — the manual acceptance script. AGENT-4 runs it in a real browser; anyone can.
Record results in tests/evidence/round2/<date>.md with a screenshot per numbered section.

## 1 Start
1.1 Open dist/index.html. App draws CH32V006 on TSSOP20. Console: zero errors/warnings.
1.2 PD1 shows SYS_SWIO (green), PD7/PA4 shows SYS_RST (green). Unused GPIO counter = 16/18.

## 2 New project
2.1 New project → CH32V006 → pick CH32V006K8U7 (QFN32) → name auto-fills → Create.
2.2 Chip shows QFN32, RST moved to PA7, exposed pad labelled VSS. Breadcrumb shows part number + project name.
2.3 Repeat for QSOP24: PA1/PA6 drawn as one pin, picker on it says "shorted".
2.4 Repeat for WCH-DUMMY32-C8 LQFP48, LQFP144 (after AGENT-1 adds it): no label overlap, no clipping.

## 3 Pins & conflicts
3.1 Click PC5 → pick SPI1_SCK → SPI1 becomes ✔ Full-Duplex Master, PC5/PC6/PC7 green.
3.2 Tree → USART1 → Mode Asynchronous, remap 0110 → PC5 and PC6 turn ORANGE, toast appears, banner in centre
    header lists both, USART1 and SPI1 show ⚠, clicking the banner selects the peripheral.
3.3 Click PC5 again → picker shows "⚠ pin in use" on the USART option.
3.4 Right-click PC5 → Set user label "SCK_OUT" → label appears on chip and in GPIO table. Reset pin clears it.
3.5 Ctrl+Z three times undoes 3.4, 3.2, 3.1 in order; Ctrl+Y redoes. Undo/Redo buttons match.
3.6 Switch package to TSSOP20: toast lists dropped pins; SPI1 remap options mark missing pins; ⊘ on I2C1.
3.7 "Show only modified pins" hides untouched pins; arrow keys move focus; Enter opens picker; Esc closes.

## 4 Clock configuration  ← the reported bug lives here
4.1 Open Clock Configuration. SYSCLK mux offers HSI, HSE, PLLCLK and ALL are selectable.
4.2 Select HSE. RCC → HSE becomes "Crystal/Ceramic Resonator"; PA1 = RCC_XI, PA2 = RCC_XO on the chip;
    SYSCLK shows 24 MHz (default crystal). Change HSE crystal to 8 → SYSCLK 8. Set 40 → red (max 32).
    (The ceiling was written here as 25 uncited; DS Tables 3-9 and 3-10 both say 3 / 24 / 32 MHz, so
    AGENT-1 corrected the data and this step with it — 32 straight into SYSCLK is legal, 32 through
    the PLL is 64 MHz and must go red.)
4.3 PLL source mux: pick HSE → PLLCLK 48 (×2). SYSCLK mux → PLLCLK → 48 MHz, HCLK 48, ADC prescaler /1 → 48
    (in spec), /128 → 0.375 red (min 16). HB prescaler /2 → HCLK 24, Flash timebase 8, SysTick 3.
4.4 Select HSI again: SYSCLK 24; RCC HSE stays as set (still claims PA1/PA2) until the user disables it.
4.5 MCO: RCC → Master Clock Output = SYSCLK → PC4 shows RCC_MCO.
4.6 Every change marks the project dirty (* in breadcrumb) and is undoable.
4.7 Repeat 4.1–4.3 on WCH-DUMMY32-C8: APB1 max 72 goes red at /1 with SYSCLK 144; USB /3 = 48 OK, /2 = 72 red.

## 5 Parameter settings (once params exist)
5.1 USART1 → Parameter Settings: baud 115200 → "actual 115207, error 0.006%" (or correct value from BRR maths).
5.2 TIM1 prescaler/period → computed PWM frequency shown. Values survive Save/Open and undo.

## 5b DMA & NVIC
5b.1 USART1 → DMA Settings → Add → USART1_TX appears on a legal channel with MemoryToPeripheral, Byte/Byte.
     Add USART1_RX. Change RX to the same channel as TX → red, owner named, conflict banner, USART1 ⚠.
5b.2 System Core → DMA1 shows both requests on their channels; click a row → jumps to USART1.
5b.3 USART1 → NVIC Settings → USART1 global interrupt enabled with priorities; DMA channel interrupts listed.
     System Core → NVIC lists all enabled vectors; change priority group → values re-validate.
5b.4 Save, reload, Open → DMA and NVIC restored. Undo removes the last DMA request.
5b.5 GENERATE CODE → .c contains DMA_InitTypeDef + DMA_Init for both requests and NVIC config for the vector.
5b.6 Every peripheral in the tree opens a panel with real controls; none is an empty "Activated" stub.

## 6 Generate & save
6.1 GENERATE CODE → downloads pinout.md, pinout.csv, clocks.md, wchcube_init.c/.h. With the 3.2 conflict
    present, the .c begins with #error naming both signals. Resolve conflict → no #error, no TODO sections
    for CH32V006.
6.2 Ctrl+S → .wchproj downloads. Reload page → Open project → identical chip, clock, params, labels, dirty off.
6.3 Open a .wchproj for an MCU that is not loaded → clear error, app unchanged.

## 6b Text legibility (human-reported)
6b.1 Pinout view, each package: every pin name fully inside its box, readable; shorted names not squashed.
6b.2 Every signal label around the chip fully visible after "Fit", none overlapping, none off-canvas.
6b.3 Tree: long names + icons + badges never clipped. GPIO table: no header or cell text cut off.
6b.4 Clock tree: every box's text fits, limit lines complete. Conflict banner and toasts wrap, never overflow.
6b.5 Repeat at browser zoom 125 % and in dark theme. Nothing invisible or low-contrast.

## 7 Views & misc
7.1 System view lists enabled peripherals with bus frequencies; clicking a block selects it in the tree.
7.2 Dark theme toggles and persists; contrast fine. Tree search "MOSI" finds SPI1. Pin search "PA1" outlines PA1/PA6.
7.3 Window at 1024 px wide: no horizontal overflow, chip visible.
7.4 Help dialog opens; every menu item does something.
