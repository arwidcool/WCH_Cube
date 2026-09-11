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

## Current — round 3, cycle 2

**The EVT packages arrived during cycle 1** and are now the authority for every name.
Headers at `data/sources/<PART>/Evt/EXAM/SRC/Peripheral/inc/`, startup at `.../Startup/`.
`00_PROJECT.md` and my own brief both still say those folders are empty.

### Done this round so far

- **P0, both defects.** `codegen.header` → `ch32v00X.h`; `codegen.speeds` → the one macro
  this silicon has. New top-level `gpio.speeds` capability key, with a one-entry list
  meaning *the control is not shown*. AGENT-3 has already landed the UI half.
- **`tools/verify_sdk_names.py`** and **`verify_sdk_names_selftest.py`** — 20 planted
  breaks, 20 caught, re-runnable. Which SDK a part uses is data (`codegen.sdk`), not
  hardcoded; a synthetic part opts out by declaration; no SDK = "NOT CHECKED", never a
  silent pass.
- **C7** — `WCH-DUMMY32-C8` has `gpio` / `dma` / `nvic` / `codegen`, every block
  deliberately shaped unlike CH32V006 so no assumption can hide.
- **`params:` → the SDK** — 35 parameters, 64 option macros, all from EVT.
- **`FORMAT.md`** gained `gpio`, `codegen.sdk`, the `struct`/`sdk_field`/`sdk_call`/
  `sdk_none` rules, the two-name NVIC rule, and a section on `mcu.inherits`/`mcu.remove`
  that had never been written at all.
- **C4 answered** for AGENT-2; the stale comments in `CH32V005.yaml` are gone.

### What checking found that reading would not

- The wrong header was not a missing file but **a different part's register map**: the SDK
  ships `Peripheral/ch32v00Xx` *and* `Peripheral/ch32v00x` side by side, and NTFS resolves
  the wrong case to the right file.
- **`nvic` vector 29 claimed `ADC1_IRQn`, which exists nowhere.** EVT has `ADC_IRQn` in the
  enum and `ADC1_IRQHandler` in the startup table. Vectors now carry both names.
- **EVT settles the TIM3-vector contradiction**: there is no TIM3 vector, confirmed twice
  over. The round-2 decision not to invent one was right.
- **Three `params:` are not init-struct members** (`arpe`, ADC `sample`, SPI `crc`) and one
  belongs to a different struct (`deadtime`). ADC `lowpower` has no SDK surface at all.
- Every real part in the repo has ONE GPIO speed, so the multi-speed UI branch had no part
  behind it until the dummy got three.

### Cost

The fixes were small; the checking was most of the work, and it found four defects nobody
had a test for. That is the right ratio for this round.

### Next, in order

1. The Medium-confidence rows EVT can now settle: TouchKey channel→pin (note there is **no
   `ch32v00X_tkey.h`** in the EVT header list, which is itself the finding), and the OPA
   polling set against `ch32v00X_opa.h`.
2. `params:` for the peripherals that still have none: TIM3, IWDG, WWDG, TKEY, OPA1.
3. `data/mcus/CH32X035.yaml` — the first part with a compiler from day one, and EVT
   present from day one too.
4. Stale `data/sources/` paths in `CH32V006.notes.md` and `tools/extract_remaps.py`.
