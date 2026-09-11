# Definition of Done — QA (AGENT-4) checks each line; project is DONE when all are [x].

## Data
- [ ] CH32V006.yaml spot-checked: every remap table re-derived from RM by a second pass and diffed (0 differences)
- [ ] EXTI line mapping and DMA channel table added for CH32V006
- [ ] CH32V005 variant file (no TKEY/TIM3, same pinout) generated from V006 with an `inherits:` field
- [ ] CH32V003 extracted (DS + RM present in `data/sources/` or requested via BOARD → HUMAN and skipped if absent)
- [ ] Every MCU file passes `tools/validate_mcu.py` (schema + pin-existence + remap-consistency + package I/O counts vs model table)

## Engine
- [ ] Engine split out of template.html into `app/engine/*.js` modules with unit tests (≥ 90% of functions covered)
- [ ] Conflict engine: shorted pins, exposed pad, remap collision preview, package switch re-check — all covered by tests
- [x] Project save/load (`.wchproj` YAML) round-trips 100% of state (browser download/upload; AGENT-4 wires native dialogs in Tauri)
- [ ] Undo/redo for pin and mode changes
- [ ] Pin table export (Markdown + CSV) and clock summary export (Markdown) — the Generate button's first real output
- [ ] C code generation for GPIO + AFIO remap + RCC (WCH EVT SDK style), compiles with `riscv-none-elf-gcc` if present, else syntax-checked with `gcc -fsyntax-only` using stub headers

## UI
- [ ] Pinout view matches CubeMX layout at 1280×720 and 1920×1080 (screenshot compared by QA)
- [ ] Right-click pin → user label; labels show on chip and in export
- [ ] "Show only modified pins" filter; keyboard navigation between pins
- [ ] Clock tab drawn as a real tree (boxes + connectors) with all V006 taps, live values, red when out of spec
- [ ] System view (block diagram of enabled peripherals)
- [ ] No layout overflow on any package from QFN12 to LQFP144 (dummy part covers the large ones)

## Release
- [ ] Tauri shell builds on Linux (CI) and packages the `data/` folder; app reads YAML from disk with hot-reload
- [ ] `npm test` / `node tests/run.js` green; GitHub Actions workflow runs build + tests on every push
- [ ] README documents: run in browser, run desktop, add an MCU, file format, agent workflow
- [ ] Zero console errors/warnings on load for every MCU × every package (automated check)
- [ ] TASKS.md has no `[~]` left and no `[ ]` in Phase 1–4
