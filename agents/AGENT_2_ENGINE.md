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
**Cycle 1 complete (2026-09-11T04:4xZ).** Priorities 1, 2, 3, 5 and 6 are done; 4 (undo/redo) is next.

Done this cycle
- Engine split into `app/engine/{inherit,model,clock,engine,project,export}.js` — ES modules, zero DOM.
  `build.py` strips the import/export keywords and inlines them as one classic `<script>`, so every engine
  name is still a global for the UI; Node imports the same files. Public API unchanged.
- `app/tests/*.test.js`: 63 engine tests on AGENT-4's `node tests/run.js`. 100% V8 function coverage
  (82/82) of `app/engine/*`, measured with `NODE_V8_COVERAGE`.
- js-yaml vendored (`app/vendor/`, MIT) and inlined; `dist/index.html` has no network references at all.
- Bugs fixed (test first, both were live): `resetPin()` could not release a pin whose owning choice is
  `choices[0]` — CH32V006's external reset pin ships ENABLED, so right-click-reset on PD7 did nothing;
  and a manual GPIO did not clear the other name of a shorted pin.
- `mcu.inherits:` implemented (maps merge, lists replace, `mcu.remove:` deletions, `mcu.variants` replaced,
  chains allowed, loops and dead remove-paths rejected). AGENT-1 is unblocked for CH32V005.
- GENERATE CODE wired to `generateAll()`: pin table (MD + CSV) and clock summary (MD).

New engine API for AGENT-3 (also on the board)
- `E.conflictList` = [{pin, label, num, signals, owners, shorted, text}], `E.issueCount[pid]`,
  `previewAssign(pin, opt)` -> '' | 'pin in use' | 'remap collides on PD6'.
- `setPackage(pkg)` returns the manual pins that are no longer bonded; `mcuModel(name)` returns a parsed,
  inherits-resolved MCU without installing it (the New Project dialog uses it).

Next cycle, in order
1. Undo/redo: a command stack over `S` (`doAction(label, fn)`, `undo()`, `redo()`, `E.undoLabel`), with
   `S` snapshots taken by the same Set-aware clone the project serialiser uses.
2. C codegen into `generateAll()`: GPIO init, AFIO_PCFR1 from the remap indices, RCC from the clock state,
   WCH EVT SDK style. AGENT-4 says there is no gcc on this box, so the compile check is CI-only —
   syntax-check with a stub-header parse in the tests meanwhile.
3. Absorb AGENT-3's `setGpioField` / `selectPeripheral` / `pinModified` / `userLabel` into the engine
   (their 01:00Z handoff), and consume AGENT-1's `exti:` / `dma:` blocks: DMA channel sharing between two
   enabled peripherals is a conflict the engine should report like any other.
