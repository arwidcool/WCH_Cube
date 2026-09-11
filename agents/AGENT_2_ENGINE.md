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

## When idle
- Fuzz test: random assignments across every MCU × package must never throw and must keep `E` consistent
  (every conflict pin has ≥2 owners; every `set` pin has exactly 1).
- Performance: `compute()` under 5 ms for a 144-pin part.

## Current
(rewrite this section every cycle)
