# AGENT-1 — DATA, round 3.

Owns `data/mcus/*`, `data/packages/*`, `data/mcus/*.notes.md`, `data/FORMAT.md`,
`data/sources/README.md`, `tools/extract_*.py`, `tools/validate_mcu.py`.
Must not edit `app/`, `tests/`, `src-tauri/`, `data/firmware/`.

Round 2 you were fast and thorough, and the validator you built caught fourteen planted breaks.
Round 3 is about the one class of error it could not catch: **names that are spelled correctly and
belong to a different chip.** Two of them shipped in CH32V006's `codegen:` block and neither the
validator, nor 267 tests, nor a browser could see them — only a compiler could.

## The new rule, and why it is yours

**A name nobody compiled is a guess.** Every SPL macro, function, struct field and enum member in
an MCU file must exist in *that part's* SDK headers. The sources are:

- **`data/sources/<PART>/Evt/`** — the WCH EVT package. Will be provided per MCU. Empty today.
  When it lands it is the **top authority**, above the RM, for anything with a *name*.
- Until then: `~/.platformio/packages/framework-wch-noneos-sdk`, the same vendor code as a
  PlatformIO package. `Peripheral/<series>/inc/`, `Core/`, `System/`, `Startup/`, `Debug/`.

Series mapping, which is not guessable from a part number and has already bitten us once:

| Part | SPL series | Main header |
|---|---|---|
| CH32V005, CH32V006 | `ch32v00Xx` | `ch32v00X.h` — **capital X** |
| CH32V003 | `ch32v00x` | `ch32v00x.h` |
| CH32X035 | `ch32x035` | `ch32x035.h` |

Precedence: **EVT → RM → DS → anything else.** Where EVT and the RM disagree, record it in the
part's `.notes.md`; EVT says what the SDK will compile, the RM says what the silicon does.

## P0 — the two defects, then make the class impossible

1. **`codegen.header` on CH32V006 names the wrong part's header.** Line ~1415:
   `header: ch32v00x.h`. That is the **CH32V003** header. This part is `ch32v00X.h`. It compiles on
   this box only because NTFS ignores case; Linux CI fails outright, and on a machine with both
   include paths present it silently compiles the wrong register map. One line.

2. **`codegen.speeds` on CH32V006 names macros this part does not have.** Line ~1423:
   `speeds: { Low: GPIO_Speed_2MHz, Medium: GPIO_Speed_10MHz, High: GPIO_Speed_50MHz }`. Those are
   CH32V10x/20x/30x spellings. Proved by compiling:

   ```
   error: 'GPIO_Speed_50MHz' undeclared (first use in this function);
          did you mean 'GPIO_Speed_30MHz'?
   ```

   `GPIOSpeed_TypeDef` in `Peripheral/ch32v00Xx/inc/ch32v00X_gpio.h` has exactly **one** member:
   `GPIO_Speed_30MHz`. The RM agrees — §7.3.1.1, `GPIOx_CFGLR.MODEy` is a single bit: *"1: Output
   mode, maximum speed 30MHz; 0: Input mode."*

   So this is not only a rename. **The GPIO table is offering a Low/Medium/High choice the silicon
   does not have.** Express the truth in the data so the UI can stop offering it — the engine and
   the UI must learn it from you, not hardcode it:

   - `codegen.speeds` becomes the single real entry for this part.
   - Add a capability the UI can read, e.g. `gpio.speeds: [ { name: "30 MHz", macro: GPIO_Speed_30MHz } ]`,
     and document in `FORMAT.md` that **a one-entry list means the control is not shown**, not that
     it is shown disabled. Post `HANDOFF(→AGENT-2,AGENT-3)` with the exact key the moment it is in.
   - CH32X035, when you get to it, has one too: `GPIO_Speed_50MHz`.

3. **`tools/verify_sdk_names.py`** — the tool that makes this the last time. For a given MCU file,
   resolve its SDK series, then check that every name it claims actually appears in that series'
   headers: `codegen.header`, `codegen.gpio_clock.fn` / `.port` / `.afio`, every `codegen.speeds`
   macro, every `codegen.periph_clock` macro, every `params.*.options[].macro`, every
   `dma.channel_params.*.options[].macro`, every `nvic.*.name`. Report unknown names with the file
   it searched, and — this is the part that earns its keep — **suggest the closest match**, the way
   GCC did above.
   - Wire it into `node tests/run.js` (ask AGENT-4 on the board; `tests/` is theirs).
   - Negative-test it the way you negative-tested `validate_mcu.py`: plant a break per category,
     confirm each is caught, and say how many in the commit message.
   - Where the series has no SDK on this machine, it must say *"no SDK for series X, not checked"*
     and exit clean. Silent passes are what got us here.

4. **Mark the assumption resolved.** `CH32V006.notes.md` records the port-clock spelling as an
   assumption. It is confirmed: `ch32v00X_rcc.h` declares `RCC_PB2PeriphClockCmd` (line 157),
   `RCC_PB2Periph_GPIOA..GPIOD` (89–92), `RCC_PB2Periph_AFIO` (88); `AFIO->PCFR1` is in
   `ch32v00X.h` (`AFIO_TypeDef`, line 197). `HUMAN_TODO` item 5 is closed.

## P1 — carry-over C7, and params that reach the compiler

5. **`WCH-DUMMY32-C8` has no `dma` / `nvic` / `params` / `codegen` blocks at all** (round-2 item,
   still open). Until it does, every new tab is exercised on exactly one part and every UI test is
   single-part. Give it the lot. Keep spelling things differently where it is safe — its HSE pins
   are already `OSC_IN`/`OSC_OUT`, which is how we keep the engine honest. It is a synthetic part,
   so `verify_sdk_names.py` must skip it by name rather than fail it; say how in `FORMAT.md`.

6. **`params:` must name real init-struct members, not plausible ones.** AGENT-2 is going to emit
   `USART_InitTypeDef`, `SPI_InitTypeDef`, `I2C_InitTypeDef`, `TIM_TimeBaseInitTypeDef`,
   `TIM_OCInitTypeDef`, `ADC_InitTypeDef` and `DMA_InitTypeDef` straight from your `params:` and
   `dma.channel_params`. Go through `Peripheral/ch32v00Xx/inc/*.h` and confirm, for each parameter:
   the struct it belongs to, the **exact field name**, and the **exact macro** for each enum option.
   Add the struct and field to the schema (`struct: USART_InitTypeDef`, `field: USART_BaudRate`)
   so codegen does not have to guess the mapping from the display name.
   Where a parameter has no SDK field — a derived or UI-only value — say so explicitly rather than
   leaving codegen to infer it.

7. `params:` for the peripherals that still have none: TIM3, IWDG, WWDG, TKEY, OPA1.

8. The Medium-confidence rows still open in `CH32V006.notes.md`: TouchKey channel→pin (RM ch.10),
   the OPA polling set. Both are *first in the queue the day an EVT package lands* — so is the
   TIM3-vector contradiction (RM Table 6-1 has no TIM3 vector although this part has a TIM3).

## P2 — CH32X035, the first part with a compiler from day one

9. `data/mcus/CH32X035.yaml` from `data/sources/X035/Datasheets/CH32X035DS0.md` and `CH32X035RM.md`.
   Same discipline as CH32V006: remap tables re-derived by a second pass and diffed, DS I/O counts
   per variant, citations in `CH32X035.notes.md`.
   Facts already confirmed against the SDK, so you do not have to rediscover them — and note that
   **each one differs from the V00x family**, which is exactly why nothing may be inherited by
   analogy:
   - ports **A, B, C only** (no GPIOD), `RCC_APB2PeriphClockCmd` / `RCC_APB2Periph_GPIOx` —
     *not* the `PB2` spelling the V00x family uses;
   - one GPIO speed, `GPIO_Speed_50MHz`;
   - `RCC_ClocksTypeDef` has **no** `ADCCLK_Frequency` member;
   - PlatformIO board `genericCH32X035G8U6` states `mabi=ilp32`, `march=rv32imacxw`, 62 KB flash,
     20 KB RAM, 48 MHz HSI+PLL. The board files are a cross-check on the DS, not a substitute.
10. When `data/sources/<PART>/Evt/` is filled for any part: re-run `verify_sdk_names.py` against the
    EVT headers rather than the PlatformIO package, re-check every Medium-confidence row, and post
    what changed. Update `data/sources/README.md` to say which parts have EVT and which do not.

## When idle
- Any part whose DS + RM appear in `data/sources/`: CH32V003, CH32V203, CH32V307, in that order.
- Per-pin drive strength / input-only / 5 V-tolerance where the DS states them.
- `data/FORMAT.md` drift: it still names the pre-reorganisation source paths
  (`data/sources/CH32V006DS0.md`), as do `CH32V006.notes.md` and `tools/extract_remaps.py`.

## Gate before every commit
`python tools/validate_mcu.py data/mcus/<part>.yaml` → 0 errors, then
`python tools/verify_sdk_names.py …` once it exists, then `python build.py && node tests/run.js`.
When you change anything in a `codegen:` or `params:` block, also ask AGENT-4 on the board to run
the compile gate — a data change is now capable of breaking a build.

---

## Current — round 3, cycle 3

### Done since cycle 2

- **`params:` → the SDK, finished.** 35 parameters and 64 option macros across USART1/2,
  SPI1, I2C1, TIM1/2, ADC1, then OPA1, TIM3, IWDG and WWDG. Every name from EVT.
- **Everything AGENT-2's emitter was missing**: `codegen.init_structs`,
  `codegen.periph_handle`, `codegen.channel_macros`, `sdk_args`, `sdk_repeat`,
  `sdk_enabled`/`sdk_disabled`, `gpio.modes` / `gpio.input_modes`. Generated C for a
  fully configured CH32V006 went from 8 TODOs to **zero TODOs and zero `#error`**.
- **Both Medium-confidence rows settled by EVT**, one of them against us.
- **EXTEN (RM ch.20)** modelled, with the new `dma.remaps` key.
- **`mcu.variants[*].pio_board` / `.pio_env`** for AGENT-3's Toolchain panel.
- **`tools/extract_pins.py` fixed twice** and `data/mcus/CH32X035.notes.md` written.

### What checking found that reading would not

Five defects this cycle, none of which any existing test could see:

1. **`nvic` vector 29 claimed `ADC1_IRQn`, a name that exists nowhere.** EVT has
   `ADC_IRQn` in the enum and `ADC1_IRQHandler` in the startup table. Vectors now carry
   both names, because the vendor uses both and they are not interchangeable.
2. **The OPA positive-input list offered `Polling P0/P1/P2/P3` — four polled channels on
   silicon whose maximum is three.** And the set was not fixed either: all ten legal
   two- and three-channel sets are now offered instead of one arbitrary triple.
3. **Three `params:` are not init-struct members** (`arpe`, ADC `sample`, SPI `crc`) and
   one belongs to a different struct (`deadtime` → `TIM_BDTRInitTypeDef`). ADC
   `lowpower` has no SDK surface at all.
4. **`tools/extract_pins.py` hardcoded `P[A-D][0-7]`** — the 16-bit-port assumption I had
   spent the afternoon warning everyone else about, in my own tool.
5. **The same tool read straight past the end of its own table** into CH32X033's, and
   produced 26 rows of one part's data wearing another part's pin names.

Two smaller ones worth keeping: my `sdk_note` for ADC `lowpower` named `ADC_LowPowerCmd`
in prose, codegen quotes notes into the C, and AGENT-2's test rightly failed on that
identifier appearing in generated code — **naming a function that does not exist puts the
string in the output even when you are saying "do not use this"**. And my own self-test
had a case that picked "the first parameter with options" as its subject, so adding IWDG
params silently moved it onto one that already had `sdk_args` and the case stopped
testing anything.

### The pattern in all of it

Every one of these is the same defect as the round's opening pair: a name or a shape
borrowed from a part that has it, applied to a part that does not. The V10x GPIO speeds,
the V003 header, `ADC1_IRQn`, a four-channel poll, 8-bit ports, one datasheet table read
as another's. **`tools/verify_sdk_names.py` now covers the name half — 32 planted breaks,
32 caught — and the shape half is still only caught by reading carefully.**

### Cost

The fixes are minutes each. The checking is the work, and it found five defects nobody
had a test for. That remains the right ratio.

### Next, in order

1. **CH32X035**, the top of my queue. Groundwork is in `data/mcus/CH32X035.notes.md` and
   `data/sources/README.md`; all five ambiguous pin rows are now understood. Remaining:
   close the pin table to 0 differences, the six per-package shorted pairs, then Table 2-3
   remaps with an independent second parser — the larger half.
2. Two keys CH32X035 needs that the format cannot express yet, both stated outright by its
   DS: **a pin that may not be an output** (every shorted pair says so) and **a pin
   constrained by a peripheral being on** (PC10/PC11 must float in USB applications).
3. Per-pin drive strength and 5 V tolerance where a DS states them. CH32V006's does not.
