# HUMAN_TODO — things only the human can do. Agents list them here once and never re-request them on the board.

1. **Add a git remote and push**: `git remote add origin <url> && git push -u origin main`.
   Unblocks: CI has never run, the worktree model, and a second machine. AGENT-3 takes over the
   moment it exists. The repo has been local-only for five rounds.
2. ~~**Rust toolchain on the dev box**~~ — **not needed.** `cargo` 1.98.1 is on PATH and
   `src-tauri/` compiles here. Kept as a line only so nobody re-adds it. The remaining desktop
   gap is item 7.
3. **Move the repo off the Google Drive mount** — `npm install` fails there (EBADF) and sync can
   corrupt a half-written `dist/index.html` mid-run. Any local folder works. This is also why the
   test suite must be run serially: one run rebuilding `dist/index.html` while another reads it
   makes both lie.
4. **Datasheet + RM markdown for the next parts** into `data/sources/`: **CH32V003, CH32V203,
   CH32V307**, in that order. AGENT-1 starts each one the cycle it appears, and adding a part is
   now a data job rather than an engine job — that is the claim rounds 4 and 5 exist to test.
   (CH32X035 has arrived, DS v2.2 + RM v1.9 + a 2 239-file EVT package.)
5. ~~**Verify the ch32v00x port-clock spelling**~~ — **resolved, no human needed.** The SDK is on
   this machine as `framework-wch-noneos-sdk`; `ch32v00X_rcc.h:157` declares
   `RCC_PB2PeriphClockCmd`, `:88-92` the `RCC_PB2Periph_GPIOA..D` and `RCC_PB2Periph_AFIO` macros,
   and `AFIO->PCFR1` is in `ch32v00X.h:197`. Kept as a line so nobody re-asks.
6. ~~**The ADC internal Vrefint channel**~~ — moved to round 5. It is an agent task now: the same
   gap exists on CH32V006 as well as CH32X035, so it is a repo-wide decision rather than a hole in
   one file. See `agents/PROJECT.md` §B.
7. **See the desktop app write a project, and say whether it worked.** `cargo build` is green and
   the Rust unit tests pass, but the round-4 changes to `write_project` have never been relinked
   into a running exe — the old one was open at the time. Close it, `cargo run`, and generate a
   project through the native folder picker. If it writes the folder, that closes E8.

---

8. **Flash one generated project.** ← *the only thing in this repository that
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

   Result goes in `tests/evidence/round5/` and would be **the first hardware
   result this project has**. Until it happens, the DONE line reads
   "builds, not flashed", in exactly those words, and nobody may round that up.
