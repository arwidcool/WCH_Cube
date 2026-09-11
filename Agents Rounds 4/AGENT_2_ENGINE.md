# AGENT-2 — ENGINE, round 4.

Owns `app/engine/*`, `app/tests/*`, `build.py`, `tools/wchcube_cli.js`, and what `codegen.js` emits.
Must not edit `data/`, CSS/HTML markup, `tests/`, `src-tauri/`, `data/firmware/`.

Two jobs this round, and the second is the one users will notice:

1. **Make the engine actually generic.** CH32X035 is the first part that is not shaped like
   CH32V006, and it will find every assumption nobody knew they had made.
2. **Generate a whole PlatformIO project**, not a file pair — something a user opens and flashes.

## P0 — carried over from round 3
1. **D1** `generateAll()` returns the file set as `{ name, language, text }`, so the UI can list and
   preview without knowing what codegen produces. AGENT-3 is waiting on this.
2. **D2** Generator options in `S.project`, round-tripped in `.wchproj` and undoable.
3. **D3** User code sections: `/* USER CODE BEGIN <tag> */ … /* USER CODE END <tag> */` carried
   across a regeneration, never silently dropping a block whose tag disappeared. The generated
   `main.c` in deliverable B depends on this — if it is not ready, say so on the board and ship the
   option **not offered** rather than offered and broken.

## P0b — the assumptions CH32X035 will break

Every one of these is confirmed from that part's own EVT headers. Each is a place where the engine
either reads the MCU file or has a CH32V006 assumption baked in, and **today nobody knows which** —
finding out is the work.

4. **Ports are 24 bits wide.** `GPIO_Pin_0 … GPIO_Pin_23`, and the SDK's masks are `uint32_t`
   (`ch32x035_gpio.h:76-83`). Go looking for `uint16_t`, `0xFFFF`, `& 0xffff`, `1 << n` with an
   implied 16, and anything that formats a pin mask as 4 hex digits. `codegen.js`'s `hex()` defaults
   to 8 digits, which is fine; the mask *arithmetic* is what to check.
5. **PC is not a contiguous range, and it has two holes** — the DS names PC0–PC7, PC10–PC11 and
   PC14–PC19, and never names PC8, PC9, PC12 or PC13. AGENT-1 is confirming the exact set from the
   pin table. Anything doing
   `for (i = 0; i <= maxPin; i++)` over a port produces pins that do not exist. Iterate the pins the
   data lists, never a range.
6. **The part has no HSE.** `grep -c HSE ch32x035_rcc.h` → 0. Round 2's P0 made the HSE coupling
   unconditional in spirit; make sure it is conditional in code. `clockCalc().selectable` must come
   from `clock.sysclk.sources` as the data gives it, the HSE auto-enable must no-op cleanly when
   `clock.hse_peripheral` is absent, and nothing may throw, warn or emit a placeholder. **This is the
   first real proof that the clock tab is data-driven rather than V006-shaped.**
7. **Remaps may be a macro instead of a bitfield.** AGENT-1 is proposing a `macro:` per remap index
   alongside the existing `lsb`/`bits`, because CH32X035's EVT exposes 40 named macros
   (`GPIO_FullRemap_USART2`, `GPIO_PartialRemap5_TIM2`, …) applied with
   `GPIO_PinRemapConfig(macro, ENABLE)` — which is what WCH's own examples use. **Agree the schema on
   the board before they fill 40 entries.** Codegen then emits one `GPIO_PinRemapConfig` call per
   remapped peripheral where a macro exists, and the existing `AFIO->PCFR1` word where it does not.
   Both families, no special case.
8. **Clock domains are AHB / APB1 / APB2**, not HB / PB1 / PB2, and DMA has **8** channels, not 7.
   Both already come from the data — confirm that, do not assume it.
9. **NVIC vectors can be grouped.** `EXTI7_0_IRQn`, `EXTI15_8_IRQn`, `EXTI25_16_IRQn` cover 26 EXTI
   lines between them. Whatever shape AGENT-1 lands (a `lines:` range on the vector is the obvious
   one), the engine maps *many lines → one vector*, and enabling any line in a group enables that
   group's vector exactly once.
10. **`grep -ri "x035" app/engine/` must be empty when you are done.** That is a round-4 DONE line,
    not a style note. Same for any CH32V006-specific name that crept in.

## P1 — deliverable B: generate a project you can flash

The app can produce `wchcube_init.c/.h`. A user still has to go find a project to put them in.
Round 4 closes that: **Generate hands them a folder that builds and flashes.**

11. **The file set.** Mirror `data/firmware/`, which already works and whose `ARCHITECTURE.md`
    explains why each piece is where it is:

    ```
    <ProjectName>/
    ├── platformio.ini
    ├── README.md
    ├── .gitignore                 .pio/
    ├── include/
    ├── src/main.c
    └── lib/wchcube_generated/{include/wchcube_init.h, src/wchcube_init.c}
    ```

    Return it from the engine as the same `{ name, language, text }` list D1 introduces, with a path
    per file. One shape for previewing, downloading, zipping and writing to disk.

12. **`platformio.ini`** — every value from the MCU file and the chosen variant:
    `platform = ch32v`, `framework = noneos-sdk`, `board = variants[<part>].pio_board`,
    `build_flags = -D SDI_PRINT=1`, `upload_protocol = wch-link`, `monitor_speed = 115200`.
    **A variant with no `pio_board` cannot produce a project** — CH32V006F4U6 and D8U7 are already in
    that position deliberately. Refuse by name, list the variants that can, and never substitute the
    nearest board: F4U6 is 16 KB of flash against F8U6's 62 KB.

13. **`main.c` — observable, and honest about what it knows.** This is where inventing hardware
    would be easy. Do not:
    - `printf` over the WCH-Link SDI channel (`SDI_Printf_Enable()`, `-D SDI_PRINT=1`) **claims no
      pin** — that is why `data/firmware` uses it. Print the part, the package, the SYSCLK the
      configuration asked for, and `SystemCoreClock` read back after `WCHCube_Init()`. If those two
      disagree the user finds out on the first run instead of at 3am.
    - **A GPIO the user configured as an output is their configuration, not an invention.** If the
      project has one, blink it and name it in the banner and the README:
      `/* PA1 — "STATUS_LED" — Output Push Pull in this project */`.
    - **If there is no output pin, blink nothing** and say "no output GPIO configured — nothing to
      toggle", with the README explaining how to add one and regenerate.
    - `/* USER CODE BEGIN/END */` around the loop body (D3).
    - `main.c` calls the generated init and the SDK. It does not get its own HAL.

14. **The two-clock-owners sentence.** The board file's `f_cpu`/`clock_source` become a
    `SYSCLK_FREQ_*` macro that `SystemInit()` applies before `main()`; `WCHCube_RCC_Init()` then runs
    and wins. So a 24 MHz project boots at 48 and drops to 24. Call `SystemCoreClockUpdate()` after
    `WCHCube_Init()` so `Delay_Ms()` stays honest, and put one sentence in the generated README.
    `data/firmware/ARCHITECTURE.md` has the long version.

15. **The CLI.** `--pio <dir>` writes into an existing project. Add the other half:
    `--new-project <dir>` (name it as you like, say so on the board) writes the whole folder above,
    refusing a non-empty directory unless `--force`. That is what AGENT-4's gate will run, and what
    makes "generate, build, flash" a three-command story:
    ```
    node tools/wchcube_cli.js --project my.wchproj --new-project ../MyBoard
    cd ../MyBoard && pio run -t upload
    ```

16. **The browser has no filesystem.** Desktop gets a folder through AGENT-4's Tauri command (D5);
    the browser needs a **`.zip`**. No external library — the app is one offline file. A stored-entry
    (no compression) ZIP writer is about sixty lines plus a CRC-32 table, it belongs in
    `app/engine/`, and it is the price of the feature. If you judge otherwise, argue it on the board
    and ship individual downloads with the folder layout in the README — do not ship a half-working
    zip.

## Rules
- **Every bug fix ships with the test that would have caught it, in the same commit.**
- **Compile before you claim**, and name the configuration you compiled.
- **A second part is a regression test for the first.** Run CH32V006 and CH32V005 before every
  commit. "It works on X035" is half a result.
- The engine must not special-case a peripheral *or a part* by name.

## Gate before every commit
`python build.py && node tests/run.js` all green, then for anything that changes emitted C:
`node tools/wchcube_cli.js --project <fixture> --pio data/firmware --strict` and
`cd data/firmware && pio run -e CH32V006F8P6`, on a configuration with pins actually assigned.
Once CH32X035 lands, add `-e CH32X035G8U6` to that list.

---

## Current — round 4, cycle 1

**Done** (every compile named; nothing here is "green" only)
- **D1, D2, D3** were finished in round 3 and are on `main`. Nothing was waiting on them.
- **P0b 4, 5, 6, 8, 10.** A part with **no HSE** computes cleanly and offers only what its data
  lists — the clock half really is data-driven, now tested rather than believed. Two CH32V006
  assumptions found and fixed: the generated C told CH32X035 to start an HSE it does not have,
  and `assignSignal` / `resetPin` / `setGpioField` accepted pins in the holes in PC. Item 10 is a
  test with a planted break, not a grep anyone has to remember.
- **Deliverable B, all of it.** `projectFiles()` → a whole PlatformIO project;
  `--new-project <dir>` (+ `--force`, `--variant`); `projectZip()` and `app/engine/zip.js` for
  the browser. Compiled as standalone folders in the system temp directory: CH32V006F8P7 TSSOP20
  7896 B, CH32X035G8U6 QFN28 6428 B, the TSSOP20 fixture 8748 B, and the zip path end to end
  through Windows' own Expand-Archive → 7452 B.
- Three refusals that would otherwise build and be wrong: no `pio_board`, a part number for a
  different package, and an ambiguous package with two part numbers in it.

**Open**
1. **P0b 7** — `GPIO_PinRemapConfig(<macro>, ENABLE)`. Waiting on AGENT-1's `macro:` schema; the
   brief says agree it on the board before they fill 40 entries. I have posted nothing yet — next.
2. **P0b 9** — grouped NVIC vectors (many EXTI lines → one vector). Same: shape first.
3. **`codegen.nvic`** (round-3 request, 17:31Z) — an enabled vector still generates a comment
   rather than an `NVIC_Init` call. Four names, citations posted.
4. **`channel_params.channels`** (round-3 request, 16:44Z) — the TIM_OCInitTypeDef emitter is
   written and parked on it.

**Rules I hold to**
- Every fix ships with the test that would have caught it, in the same commit.
- A name the data does not carry becomes a TODO naming the missing key, never a guess.
- `fresh()` is one engine singleton; `node --test app/tests/<file>` does not run these tests.
