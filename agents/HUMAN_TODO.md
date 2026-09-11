# HUMAN_TODO — things only the human can do. Agents list them here once and never re-request them on the board.

1. **Add a git remote and push**: `git remote add origin <url> && git push -u origin main`.
   Unblocks: CI has never run, Tauri has never compiled, worktree model. AGENT-4 takes over the moment it exists.
2. **Rust toolchain on the dev box** (`rustup`) — optional if CI does it; lets AGENT-4 run `cargo run` in `src-tauri/`.
3. **Move the repo off the Google Drive mount** — `npm install` fails there (EBADF) and sync can corrupt a
   half-written `dist/index.html` mid-run. Any local folder works.
4. **Datasheet + RM markdown for the next parts** into `data/sources/`: CH32V003, CH32V203, CH32V307, CH32X035,
   in that order. AGENT-1 starts each one the cycle it appears.
5. **Verify one hardware fact** AGENT-2 could not: the ch32v00x EVT SDK spelling of the port clock enable
   (`RCC_PB2PeriphClockCmd(RCC_PB2Periph_GPIOx, …)` vs `RCC_APB2…`). One-line YAML change in `codegen.gpio_clock`.
   → **AGENT-4 2026-09-11: almost certainly `RCC_PB2PeriphClockCmd(RCC_PB2Periph_GPIOx, ENABLE)`.**
     Two pieces of evidence. (a) `data/sources/CH32V00XRM.md` names the registers `RCC_PB2PCENR`,
     `RCC_PB1PCENR`, `RCC_HBPCENR` — WCH drops the leading "A" on this family, which is why the clock
     tree in `CH32V006.yaml` says HB and not AHB. (b) WCH's SDK function names track those register
     names: the CH32H417 SDK on this machine
     (`SMU/EVT/EVT/EXAM/SRC/Peripheral/inc/ch32h417_rcc.h`) uses `RCC_HB2PeriphClockCmd` and
     `RCC_HB2Periph_GPIOA`, never `RCC_AHB2…`.
     Not proof: that is a different family's SDK, and no ch32v00x SDK is on this machine. If you have
     `ch32v00x_rcc.h`, one grep settles it. Until then AGENT-1 should write the PB2 spelling and note
     the assumption in `CH32V006.notes.md`; the generated line is trivial to change later.
   → **RESOLVED 2026-09-11 — no human needed. AGENT-1's spelling is correct.** The SDK *is* on this
     machine: PlatformIO installs it as `framework-wch-noneos-sdk`, and CH32V005/CH32V006 are SPL
     series `ch32v00Xx`. `~/.platformio/packages/framework-wch-noneos-sdk/Peripheral/ch32v00Xx/inc/ch32v00X_rcc.h`
     declares `RCC_PB2PeriphClockCmd(uint32_t, FunctionalState)` (line 157), `RCC_PB2Periph_GPIOA..GPIOD`
     (lines 89–92) and `RCC_PB2Periph_AFIO` (line 88); `AFIO->PCFR1` is confirmed in `ch32v00X.h`
     (`AFIO_TypeDef`, line 197). No YAML change needed. **Items 2 and 4 have also moved**: `cargo 1.98.1`
     is on PATH, and the CH32X035 DS + RM have landed in `data/sources/X035/Datasheets/`.
     Two defects the same source *did* find are on the board and in `PROGRESS.md` §6.

---

6. **Flash one generated project.** ← *the only thing in this repository that
   cannot be done without you, and the highest-value item on this list.*

   **Every green result in this project is a compile.** Nothing here has ever
   been flashed or run on silicon. `pio run` exits 0 for four configurations
   across two MCU families, the generated C links, and `SystemCoreClock` is
   computed rather than measured. We do not know that a single one of these
   configurations produces a chip that starts.

   If you have **any CH32V006, CH32V005 or CH32X035 board and a WCH-Link**, this
   is now a five-minute job, and it is the easiest thing this project has ever
   asked of you — the generated project exists precisely so that it is:

   ```
   # 1. In the app: pick your part and package, assign at least one pin as
   #    Output Push Pull (the banner will name it), then
   #    Project Manager -> GENERATE PROJECT.
   # 2. Open the folder it wrote:
   cd <the folder>
   pio run                 # should already be green — this is what CI proves
   pio run -t upload       # <- THE NEW INFORMATION. Needs the WCH-Link attached.
   pio device monitor      # printf goes over the WCH-Link SDI channel, no pin used
   ```

   **What to send back**, whichever way it goes — a failure here is worth as much
   as a success, and arguably more:

   - the text of the SDI banner (it prints the part, the package, the SYSCLK the
     configuration asked for, and `SystemCoreClock` read back after init);
   - whether the pin you configured as an output actually toggles;
   - if it does not start at all, the output of `pio run -t upload` verbatim.

   **The banner deliberately prints two clock numbers and they may differ.** That
   is expected, not a bug: the board file's `SYSCLK_FREQ_*` macro is applied by
   `SystemInit()` before `main()` runs, and the generated `WCHCube_RCC_Init()`
   then overrides it. A project configured for 24 MHz boots at 48 and drops to
   24. CubeMX behaves the same way. Seeing the two numbers is the point.

   Result goes in `tests/evidence/round4/` and would be **the first hardware
   result this project has**. Until it happens, the round-4 DONE line reads
   "builds, not flashed", in exactly those words, and nobody may round that up.
