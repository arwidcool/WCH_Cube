# AGENT-2 — ENGINE, round 3.

Owns `app/engine/*`, `app/tests/*`, `build.py`, `tools/wchcube_cli.js`, and — new this round —
**what `codegen.js` emits**. Must not edit `data/`, CSS/HTML markup, `tests/`, `src-tauri/`,
`data/firmware/` (except by generating into `lib/wchcube_generated/`, which nobody edits by hand).

Your output now has a compiler behind it. `data/firmware/` builds the C you emit, for real silicon,
with the real WCH SDK. That changes what "done" means for every line below: **`pio run` exited 0 on
a configuration that exercises the change**, not "the string looks right".

## The seam
One file pair: `wchcube_init.c` / `wchcube_init.h`. You decide what is in them; AGENT-4 decides what
compiles them. Neither of you edits the other's side. `data/firmware/ARCHITECTURE.md` lists the
seams and the two-clock-owners hazard — read that section before touching `WCHCube_RCC_Init()`.

## P0 — the carry-over defects
1. **`mcu.remove` is applied after the parent is merged** (`app/engine/inherit.js` ~line 61), so a
   child that removes a path *and* redefines it loses its own version too. CH32V005 shipped with no
   DMA request map at all because of this, which means your channel-clash detection has been dead on
   that part since it shipped. Fix it one of two ways — AGENT-1 says either is fine, silently
   discarding the child's data is not: apply `remove` to the **parent** before merging the child, or
   reject a removed path the child also defines as a hard error. Ship the test that catches it.
2. **`setSetting()` on a `type: checkboxes` setting** does not throw, replaces the `Set` with a
   `String`, and the next `compute()` dies with `v.has is not a function` — a blank app until
   reload. Not reachable through today's UI, and it becomes reachable the moment the peripheral
   tabs are driven generically. Reject it by name and point at `toggleSetting`.

## P0b — stop emitting names the part does not have
3. **GPIO speed.** AGENT-1 is landing the truth in data: CH32V006 has exactly one output speed
   (`GPIO_Speed_30MHz`; `GPIOx_CFGLR.MODEy` is one bit), CH32X035 has one (`GPIO_Speed_50MHz`), and
   a one-entry list means *the control is not offered*. Consume that key the moment it is on the
   board. Codegen must emit the part's one speed macro and never a Low/Medium/High mapping, and
   `S` must not carry a per-pin speed the part cannot express.
4. **Never invent an SPL name.** `codegen.js` already refuses to guess register encodings and emits
   an explicit TODO instead — hold that line for every new block below. If the MCU file does not
   carry the struct, field or macro, emit the TODO that names exactly what is missing. A real part
   with no `codegen:` block still gets `#error`.

## P1 — configuration must reach the C  (this is the round)
Everything a user can set has to survive into code that compiles. In this order, each with tests in
`app/tests/codegen.test.js` and a compile request to AGENT-4 on the board:

5. **`params:` → init structs.** AGENT-1 is adding `struct:` and `field:` to the schema so you do
   not have to infer the mapping. Emit `USART_InitTypeDef`, `SPI_InitTypeDef`, `I2C_InitTypeDef`,
   `TIM_TimeBaseInitTypeDef`, `TIM_OCInitTypeDef`, `ADC_InitTypeDef` per enabled peripheral, in the
   SDK's own order, followed by the `*_Init()` call and the clock enable from
   `codegen.periph_clock`. A parameter the data marks as derived or UI-only is not emitted.
6. **DMA → `DMA_InitTypeDef`.** Per enabled request: the struct from `dma.channel_params` and the
   user's values, `DMA_DeInit(DMA1_Channelx)`, `DMA_Init(...)`, `DMA_Cmd(..., ENABLE)`, plus
   `RCC_HBPeriphClockCmd(RCC_HBPeriph_DMA1, ENABLE)`. A double-booked channel stays a hard conflict
   in `E.resourceIssues` and must produce `#error`, not silently-last-wins code.
   Note the one coupling AGENT-1 deliberately did not automate: **SPI1 at 16-bit data size needs
   half-word widths on both sides**, and nothing enforces it today. A warning beats a silent
   mismatch.
7. **NVIC → the enabled vectors.** The PFIC is **not** the Cortex-M scheme: `PFIC_IPRIORx` gives
   each vector a byte and implements **two** bits ([5:0] are "reserved, fixed to 0, write invalid",
   RM 6.5.2.21), max nesting depth 2. `nvic.scheme.groups` carries both variants. Emit what the
   scheme says and nothing more — where the RM does not document a register for the nesting switch,
   do not claim a write for it.
8. **Round-trip.** `params`, `dma` and `nvic` all through `.wchproj`, undo/redo and reload, and
   regenerating after a save/open cycle must produce **byte-identical C**. That last one is a cheap
   test and it catches an entire family of ordering bugs.
9. **No TODO sections for a fully configured CH32V006.** That is a round-3 DONE line.

## P1b — the CLI, which is now the build's front door
10. `tools/wchcube_cli.js` writes both generated files into one directory, so the firmware README
    has to tell people to `mv` the header afterwards. Remove that step: add a flag —
    `--pio <project-dir>` — that writes `wchcube_init.h` into `<dir>/lib/wchcube_generated/include/`
    and `wchcube_init.c` into `.../src/`, creating neither if the target is not a PlatformIO project
    (check for `platformio.ini`). Post `HANDOFF(→AGENT-4)` so the gate and the README use it.
11. `--strict` should also fail on anything codegen emitted as a TODO or `#error`, so CI can tell
    "generated successfully" from "generated a complaint".
12. Deterministic output: no timestamps, no map-iteration order, nothing that makes two runs of the
    same configuration differ. The byte-identical test in item 8 depends on it.

## P2 — behind the Project Manager tab
AGENT-3 is building the code generation UI on the dead `Project Manager` tab. You own everything
behind it; agree the shape on the board before either of you writes a line.

13. `generateAll()` should return the full file set as `{ name, language, text }` so the UI can list
    files and preview the selected one without knowing what codegen produces. Today it is shaped for
    downloading, not for showing.
14. Generator options in `S.project` (single file vs a pair per peripheral; preserve user code
    sections between markers; also emit the pin table and clock summary), round-tripped in
    `.wchproj` and undoable like everything else.
15. **User code sections**: if the UI offers "keep my code on regeneration", the engine has to
    honour it — recognise `/* USER CODE BEGIN <tag> */ … /* USER CODE END <tag> */`, carry the body
    across a regeneration, and never silently drop a block whose tag disappeared. If that is too
    much for one cycle, say so on the board and ship the option as *not offered* rather than offered
    and broken.

## Rules
- **Every bug fix ships with the test that would have caught it, in the same commit.** Unchanged
  from round 2, and it is the reason the engine is at 100 % export coverage.
- **Compile before you claim.** Name the configuration you compiled in the commit message.
- The engine must not special-case a peripheral by name. Anything DATA adds with
  settings/params/dma/nvic appears with zero engine changes — keep the synthetic-peripheral test.

## Gate before every commit
`python build.py && node tests/run.js` all green, then — for anything that changes emitted C —
`node tools/wchcube_cli.js CH32V006 --package TSSOP20 --format c --pio data/firmware` followed by
`cd data/firmware && pio run -e CH32V006F8P6`, on a configuration with pins actually assigned. A
default configuration assigns nothing and proves nothing.

---

## Current — round 3, cycle 3

**Closed this round** (all compiled, not just green)
- **C4** `mcu.remove` before the merge · **C5** `setSetting()` rejects a `checkboxes` setting.
- **P0b** the emitted GPIO speed AND the GPIO mode macros come from `gpio.speeds` /
  `gpio.modes`; three places that wrote a mode or speed name into `S` from nowhere are gone.
- **P1b** `--pio <dir>`, `--strict` on a generated TODO or `#error` (`cComplaints()`).
- **P2** `params:` → init structs with all five `sdk_args` placeholders, `sdk_call`,
  `sdk_repeat`, `sdk_none` and `no_handle`; DMA → `DMA_InitTypeDef` with a double-booked
  channel as `#error`; NVIC → the enabled vectors with PFIC priorities and no invented
  nesting register; byte-identical regeneration. **`--strict` exits 0 on all three
  fixtures: zero TODOs, zero `#error` for a fully configured part.**
- **Engine state for C2/C3** — `S.dma`, `S.nvic` and per-channel params, all with
  AGENT-3's names, round-tripped and undoable.
- **P1 13–15** `generateAll()` → `[{name, language, text}]`, `generatorOptions()` (three,
  every one honoured), USER CODE sections that survive regeneration and never drop a block.
- **The per-peripheral file split**, so that option is offered rather than withheld.
- **CH32X035 compiles with zero engine changes** — 24-bit ports and a hole in PC included.

**Open, and why**
1. `TIM_OCInitTypeDef` codegen: written, tested, parked. Waiting on
   `channel_params.channels` (REQUEST → AGENT-1, 16:44Z). Re-apply and done.
2. Whatever the board asks for next.

**Rules I have been holding to, worth keeping**
- Every fix ships with the test that would have caught it, in the same commit.
- A name the data does not carry becomes a TODO that names the missing key, never a guess.
- `fresh()` is one engine singleton — read each configuration out before starting the next.
