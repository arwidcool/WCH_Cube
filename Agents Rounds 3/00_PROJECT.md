# WCH_CubeMX — Round 3: "the generated code is the product"

Round 1 built the machinery. Round 2 made what you can click correct. **Round 3 makes what comes
*out* correct**: a configuration the user builds in the app becomes C that compiles, links and can
be flashed, with a UI that shows them exactly what they are going to get.

Read this file, then your own `AGENT_n_*.md`, then `BOARD.md` in this folder, then `../PROGRESS.md`,
then `../TASKS.md`. `../agents/README.md` rules (ownership, work cycle, shared tree, "idle is not a
stop", 2-cycle request deadline, HUMAN_TODO) remain in force. `../Agents Rounds 2/00_PROJECT.md`
still describes work that is not finished — see "Carried over" below; it comes first.

## What changed since round 2 started

Three things, and they reframe the round.

**1. The generated C now has a compiler behind it.** `data/firmware/` is a PlatformIO project on
platform `ch32v` + framework `noneos-sdk` (the WCH EVT Standard Peripheral Library). Four
environments build offline on this box: CH32V006 TSSOP20 and QFN32, CH32V005 TSSOP20, CH32X035.
`node tools/wchcube_cli.js … --format c --out data/firmware/lib/wchcube_generated/src` is picked up
automatically and linked. See `data/firmware/README.md` and `data/firmware/ARCHITECTURE.md`.

Which means **"generated C compiles" stops being an aspiration and becomes a gate.** It is no longer
human-blocked, no longer CI-only, and no longer something anyone gets to assert without running it.

**2. Compiling it immediately found two defects that every existing test missed.** Both in
`data/mcus/CH32V006.yaml`'s `codegen:` block, both invisible from a browser:

- `codegen.header: ch32v00x.h` is the **CH32V003** header. CH32V006 is `ch32v00X.h`, capital X.
  It builds here only because NTFS is case-insensitive.
- `codegen.speeds` names `GPIO_Speed_2MHz/10MHz/50MHz` — the CH32V10x/20x/30x spelling. On this part
  `GPIOSpeed_TypeDef` has exactly one member, `GPIO_Speed_30MHz`, because `GPIOx_CFGLR.MODEy` is a
  single bit (CH32V00X RM v1.4 §7.3.1.1). So the GPIO table is also **offering the user a speed
  choice the silicon does not have** — round-2 item 4, found in the data rather than the UI.

Read those two together and the lesson is the round's rule: **a name nobody compiled is a guess.**

**3. EVT sources are coming, per MCU.** WCH's EVT package — SPL sources, headers, startup files,
linker scripts, `.svd`, examples — will be provided for each MCU under `data/sources/<PART>/Evt/`.
Those folders exist and are empty today. When a package lands it is the **highest authority** for
anything the software has to *name*: register and bitfield names, the header they live in, SPL
function names, init-struct fields, enum members, startup code, vector order, and which options
exist on *this* part rather than its family.

Precedence, highest first: **EVT sources → Reference Manual → Datasheet → anything else.** Where EVT
and the RM disagree they are answering different questions — EVT says what the SDK will compile, the
RM says what the silicon does. Record the contradiction in the part's `.notes.md`; do not average
them and do not pick the convenient one. Full rule: `data/sources/README.md`.

Until the drop arrives the same vendor code is installed by PlatformIO at
`~/.platformio/packages/framework-wch-noneos-sdk` and carries the same authority in practice. That
is where both defects above were found — and where `HUMAN_TODO` item 5 was settled in AGENT-1's
favour (`RCC_PB2PeriphClockCmd` / `RCC_PB2Periph_GPIOx` / `RCC_PB2Periph_AFIO` all confirmed).

**Nothing is assumed that these sources do not support.** Not an API, not a peripheral, not a
register behaviour, not a startup detail, not "the other CH32 parts have it".

## Project layout (as of the start of round 3)

```
WCH_CubeMX/
├── PROGRESS.md              standing status: state, blockers, decisions, next steps  (AGENT-4)
├── app/
│   ├── template.html        UI: CSS + markup + render code (AGENT-3). Sections 4–7 UI, 8 glue.
│   ├── engine/*.js          12 ESM modules, zero DOM (AGENT-2)
│   ├── tests/*.test.js      engine unit tests (AGENT-2)
│   └── assets/              UI assets, param stubs (AGENT-3)
├── data/
│   ├── mcus/*.yaml          CH32V006, CH32V005 (inherits), WCH-DUMMY32-C8       (AGENT-1)
│   ├── packages/packages.yaml
│   ├── sources/<PART>/
│   │   ├── Datasheets/      DS + RM markdown                                     (human)
│   │   └── Evt/             the WCH EVT package — EMPTY, incoming                (human)
│   ├── sources/README.md    where facts come from, and the EVT authority rule
│   ├── FORMAT.md            YAML schema — the DATA↔ENGINE contract               (AGENT-1)
│   ├── firmware/            ***NEW*** PlatformIO project                         (AGENT-4)
│   │   ├── platformio.ini   4 environments
│   │   ├── ARCHITECTURE.md  layers, seams, ownership
│   │   ├── src/ include/    application layer + build-time config
│   │   └── lib/             components: board, wch_hal, util, wchcube_generated
│   └── Pio Source/          reference copy of the ch32v platform (human, read-only)
├── tools/                   extract_*.py, validate_mcu.py (AGENT-1), wchcube_cli.js (AGENT-2)
├── tests/                   runner, smoke, layout, features, clock_ui, desktop, build (AGENT-4)
├── src-tauri/               Tauri 2 shell (AGENT-4) — cargo EXISTS now, it can be compiled
├── build.py                 python build.py → dist/index.html (single file, offline)
├── dist/index.html          GENERATED. Never hand-edit.
├── agents/                  round-1 pack, DONE.md, HUMAN_TODO.md, the working agreement
├── Agents Rounds 2/         round-2 pack — still has open P0s
└── Agents Rounds 3/         THIS folder
```

Run: `python build.py && node tests/run.js` — and now also `cd data/firmware && pio run`.

## Ownership — additions for round 3

`../agents/README.md`'s table still holds. Round 3 adds:

| Area | Owner | Note |
|---|---|---|
| `data/firmware/**` | **AGENT-4** | build config, HAL, board, util, docs, its tests |
| `data/firmware/lib/wchcube_generated/**` | **nobody** | machine-written, `.gitignore`d. Regenerate, never edit. |
| *what codegen emits* (`app/engine/codegen.js`) | **AGENT-2** | ENGINE writes the C; QA compiles it |
| `PROGRESS.md` | **AGENT-4** | the standing status file. Keep it true. |
| `data/sources/README.md` | **AGENT-1** | the EVT rule lives with the person who reads the sources |
| `Agents Rounds 3/BOARD.md` | everyone | append-only, as always |

The seam between AGENT-2 and AGENT-4 is exactly one file pair: `wchcube_init.c` / `wchcube_init.h`.
AGENT-2 decides what is in them. AGENT-4 decides what compiles them. Neither edits the other's side.

## Carried over from round 2 — these come FIRST

Round 2 is not finished. Nothing in round 3 outranks an open round-2 P0:

| # | Open item | Owner |
|---|---|---|
| C1 | 8 text-legibility findings, all measured in a real browser | AGENT-3 |
| C2 | DMA Settings tab + DMA1 channel table in System Core | AGENT-3 |
| C3 | NVIC Settings tab + NVIC overview in System Core | AGENT-3 |
| C4 | `mcu.remove` applied after the parent merge discards a child's own redefinition | AGENT-2 |
| C5 | `setSetting()` on a `checkboxes` setting replaces the Set with a String and blanks the app | AGENT-2 |
| C6 | `#mcusel` shows the wrong part at boot; `#pkgsel` keeps the old package after a project load | AGENT-3 |
| C7 | `WCH-DUMMY32-C8` has no `dma` / `nvic` / `params` / `codegen`, so the new tabs are single-part | AGENT-1 |
| C8 | `tests/completeness.test.js` | AGENT-4 |

## Round-3 priorities

### P0 — the two codegen defects, and the rule behind them
Fix `codegen.header` and `codegen.speeds` on CH32V006 (AGENT-1), stop emitting a speed field where
the part has one speed (AGENT-2), stop offering the choice in the GPIO table (AGENT-3), and gate all
three with a compile (AGENT-4). Then make the class of bug impossible: **every SPL name any MCU file
claims is checked against the SDK headers by a tool, not by a reader.**

### P1 — the code generation UI  ← the round's visible feature
The `Project Manager` and `Tools` tabs are `disabled` placeholders in the tab bar today. That is a
dead control *and* the obvious home for this. CubeMX's Project Manager is where you say what you
want generated and where it goes; ours additionally **shows you the code before you take it**.

Minimum shape (AGENT-3 owns the tab, AGENT-2 owns everything behind it):
- **Project** — name, MCU, part number, package (read-only, from the project), output folder.
- **Toolchain / IDE** — `PlatformIO` is the only real option today. Show the environment name it
  maps to (`CH32V006F8P6`, …) and say plainly that other toolchains are not supported rather than
  listing greyed ones.
- **Code generator options** — generate peripheral init into one file or a pair per peripheral;
  keep user code sections between markers on regeneration; emit the pin table and clock summary
  alongside.
- **Preview** — a file list (`wchcube_init.h`, `wchcube_init.c`, `pins.md`, `clocks.md`) and the
  actual text of the selected one, read-only, with a copy button. This is what makes a codegen bug
  visible to a human before it reaches a compiler.
- **Generate** — browser: download. Desktop (Tauri): write to the chosen folder, defaulting to
  `data/firmware/lib/wchcube_generated/` with the header in `include/` and the source in `src/`.
- Anything that cannot be done yet is **removed, not greyed**. Round-2 rule, still in force.

### P2 — configuration actually reaching the code
Everything the user can set must survive to the C. Per-peripheral, in this order: `params:` →
`*_InitTypeDef` blocks; DMA requests → `DMA_InitTypeDef` + `DMA_Init` + `DMA_Cmd`; NVIC → the
enabled vectors with PFIC priorities. And the generated file must compile for every one of them.

### P3 — more parts, now that there is a compiler
`CH32X035` has its DS and RM in `data/sources/X035/Datasheets/` and a working PlatformIO
environment, but no `data/mcus/CH32X035.yaml`. It is the first part whose data can be checked
against a build from the day it lands.

## Round-3 definition of done

AGENT-4 appends this to `../agents/DONE.md` as a "Round 3" section and ticks only on evidence.

- [ ] Every round-2 carry-over C1–C8 closed.
- [ ] `codegen.header` and `codegen.speeds` correct on CH32V006; no SPL name in any MCU file that
      does not exist in the SDK for that part.
- [ ] `tools/verify_sdk_names.py` (or equivalent) checks every `codegen:` / `params:` / `dma:` /
      `nvic:` name a part claims against that part's SDK headers, and is wired into
      `node tests/run.js`. Planted-break tested, like `validate_mcu.py` was.
- [ ] **The compile gate**: generating C from a configuration **with pins, params, DMA and NVIC set**
      and building it in `data/firmware` succeeds, for CH32V006 on two packages and for CH32V005.
      Automated, skipped-with-a-reason when PlatformIO is absent, never silently skipped.
- [ ] Generated C for CH32V006 has zero TODO sections and zero `#error` for a fully configured part.
- [ ] Project Manager tab implemented: project info, toolchain, generator options, file preview,
      Generate that writes where it says it writes. `Tools` tab either implemented or removed.
- [ ] No `disabled` control anywhere in the app that is not justified by the MCU data.
- [ ] `params:` → C for USART/SPI/I2C/TIM/ADC on CH32V006, round-tripping through `.wchproj` and undo.
- [ ] DMA and NVIC configuration → C, with a double-booked channel still a hard conflict.
- [ ] Save → close → Open restores everything, and regenerating produces byte-identical C.
- [ ] `data/firmware` builds all four environments; `pio check` clean.
- [ ] `PROGRESS.md` current: no statement in it is false.
- [ ] Every DONE.md line not marked human-blocked is ticked.

## Round-3 rules (additions)

- **A name nobody compiled is a guess.** Any SPL macro, function, struct field or enum member that
  goes into `data/`, `app/engine/codegen.js` or generated C must be traceable to a header in the
  EVT package or the installed `framework-wch-noneos-sdk`. Cite the file and line in the commit or
  the `.notes.md`. "The V20x has it" is not a citation.
- **Compile before you claim.** "Generated C is correct" means `pio run` exited 0 on a configuration
  that exercises the thing you changed. Say which configuration in the commit message.
- **A hardware choice the part does not have must not be offered.** Greying is for options the MCU
  data says are absent; it is never a consequence of UI state. Round-2 item 4, promoted to a rule.
- **Real-browser verification stays mandatory** for UI changes — `python build.py`, open
  `dist/index.html` in Edge/Chrome, exercise it, write "verified in browser" in the commit.
- **Bug first, then feature.** A human P0 or a QA-FAIL beats anything in the priority lists.
- **`data/firmware/lib/wchcube_generated/` is never hand-edited.** If the generated code is wrong,
  the generator is wrong.
- **Do not vendor the SDK into this repo.** It is a PlatformIO package and an incoming `Evt/` drop.

## Environment facts (corrected — `agents/README.md` is stale on two of these)

- Windows box. `python` (3.12), not `python3`. `node` v24.
- **`cargo` 1.98.1 IS on PATH.** `src-tauri/` can be compiled locally now; it is no longer CI-only.
- **A C compiler IS available**: PlatformIO ships WCH's RISC-V GCC 12.2.0 at
  `~/.platformio/packages/toolchain-riscv` (`riscv-wch-elf-gcc`). PlatformIO Core is 6.2.0.
- Everything `data/firmware` needs is already installed, so it builds **offline**.
- Repo sits on a Google Drive mount: `npm install` fails with EBADF; test deps live in
  `%LOCALAPPDATA%\wchcube-deps`.
- No git remote. CI has still never run. Shared working tree, direct commits to `main`,
  `AGENT-n: <task>`.
- Timestamps from `date -u +%Y-%m-%dT%H:%MZ` (PowerShell:
  `Get-Date -AsUTC -Format yyyy-MM-ddTHH:mmZ`), not guessed.
