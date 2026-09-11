# AGENT-2 — ENGINE. You own the JS logic: model, conflict engine, clock maths, save/load, exports, codegen.

Read `agents/README.md` first and follow the work cycle exactly. You never stop to ask; you decide and log.

## Mission
The engine must be correct, tested, and independent of the DOM. Pin conflicts are the #1 feature: any
situation where two things want one physical pin must be detected, explained, and surfaced to the UI
through `E.conflicts` / `E.issues` — including shorted pin pairs, remap side-effects, package switches,
and defaults-after-reset (SWIO, RST).

## Priorities (in order)
1. Split the engine out of `app/template.html` into `app/engine/model.js`, `engine.js`, `clock.js`,
   `project.js`, `export.js` (ES modules, no DOM access). `build.py` inlines them so `dist/index.html`
   stays single-file. Keep the public API the UI already uses (`compute`, `assignSignal`, `resetPin`,
   `requiredSignals`, `isAvailable`, `clockCalc`, state shape `S`, result shape `E`).
2. `app/tests/` with `node tests/run.js` (plain Node asserts, jsdom only where DOM is unavoidable). Port the
   scenarios already exercised in this session: remap collisions, shorted pins, per-package reset pin,
   QFN12 availability, clock min/max. Every bug you fix gets a test first.
3. Project save/load: `.wchproj` YAML = { mcu, package, periph settings+remaps, manual pins, gpio settings,
   labels, clock }. Round-trip test.
4. Undo/redo (command stack over `S`).
5. Exports behind the Generate button: pin table (MD + CSV, sorted by pin number, with conflicts marked),
   clock summary (MD). Then C codegen: GPIO init, AFIO_PCFR1 value from remap indices, RCC_CFGR0 from
   clock state. Output style = WCH EVT SDK (`GPIO_InitTypeDef`, `RCC_*` calls). Syntax-check in tests.
6. Support `inherits:` in MCU files (agree semantics with AGENT-1 on BOARD): child overrides/deletes keys.

## Interface contract with AGENT-3 (UI)
- UI never mutates `S` directly except through your exported functions.
- Any new field you add to `E` gets a one-line BOARD `HANDOFF(→AGENT-3)` describing it.

## Cycle 3 priorities (your original brief is complete — this is the new list)
1. Adopt AGENT-3's `runHistory()` request (10:51Z): one undo/redo implementation for keyboard and buttons.
2. `tools/wchcube_cli.js` — headless: load MCU (+ optional `.wchproj`), print pin table / clocks / emit C to
   stdout or files. CI will diff its output. You proposed it; build it.
3. `params:` support as soon as AGENT-1's schema lands in `data/FORMAT.md` (build against a stub in
   `app/assets/params.stub.yaml` meanwhile): `S.periph[pid].params`, validation against min/max/options,
   `.wchproj` round-trip, undo, `getParams(pid)` / `setParam(pid, name, value)`. First consumer: USART BRR
   maths in `clock.js` → actual baud + error %.
4. Codegen: when `codegen:` and `analog_signals` land, the CH32V006 output must have no TODO sections; a
   real (non-dummy) part without a `codegen:` block gets `#error`, not a TODO.
5. `build.py`: refuse to emit a bundle with a duplicate top-level declaration (AGENT-4 01:35Z).

## When idle
- Fuzz test: random assignments across every MCU × package must never throw and must keep `E` consistent
  (every conflict pin has ≥2 owners; every `set` pin has exactly 1).
- Performance: `compute()` under 5 ms for a 144-pin part.

## Current
**Cycle 2 complete.** Every numbered priority in this file is done. 180 tests green via
`node tests/run.js`; V8 function coverage of `app/engine/*` is 164/164 = **100%**.

The engine, 11 modules, no DOM anywhere
`util` (deepClone) · `inherit` (mcu.inherits) · `history` (undo/redo) · `model` (M, S, pins) ·
`clock` · `resources` (EXTI, DMA) · `engine` (conflicts, state writers) · `project` (.wchproj) ·
`codegen` (C) · `export` (reports) · `index` (Node barrel).

Done in cycle 2
- Undo/redo: snapshot stack over `S`, 100 steps, `batch(label, fn)`, view state (selection, zoom,
  pan) deliberately excluded. Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z in the glue, ignored while typing.
- State writers every mutation should go through, each validating and recording one undo step:
  `setSetting`, `toggleSetting`, `setRemap`, `setGpioField`, `setClock`, plus `userLabel` and
  `pinModified` absorbed from AGENT-3.
- C codegen: `wchcube_init.c/.h`. GPIO blocks are always generated; the AFIO and RCC words need a
  `codegen:` block in the MCU file and become a named TODO without it. `#error` on unresolved
  conflicts. Two hardware bugs found and fixed: SWIO/RST were configured as GPIOs, ADC channels
  were AF_PP instead of AIN.
- EXTI and DMA conflicts from AGENT-1's data blocks, surfaced as `E.resourceIssues` and folded
  into `E.issues[pid]`.
- `deepClone` replaced `structuredClone` (absent in jsdom and older webviews); `build.py` now
  rejects aliased imports, which the bundle cannot express.

Blocked on others, not on me
- `codegen:` block for CH32V006 (AGENT-1) — turns the C file's TODO sections into register writes.
  Proposed values are on the board and a worked example is in `app/tests/codegen.test.js`.
- `codegen.analog_signals` (AGENT-1) — ADC1_IN4 and ADC1_RETR0 share PD3 and only one is analog.
- The compile check needs CI (AGENT-4): no gcc and no Rust toolchain on this box.

When idle, next
1. Absorb AGENT-3's remaining thin writers if any appear, and keep `E` documented on the board.
2. Peripheral parameter settings (baud rate, prescaler, PWM period) once AGENT-1 puts them in the
   data — the centre panel's Parameter Settings tab is still a placeholder.
3. A `tools/` CLI that runs the engine headless (load MCU + project, print the pin table or emit
   the C) so CI can diff generated output without a browser.
