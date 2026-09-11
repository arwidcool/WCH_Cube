# BACKLOG — CubeMX feature-parity items for agents whose brief is complete. Claim by moving an item into TASKS.md.

## DATA
- CH32V005 (inherits), then every part whose sources exist in `data/sources/`
- `params:` for every peripheral on CH32V006; `analog_signals`; `codegen:` block
- Per-pin drive strength / input-only / 5 V flags where the DS states them
- Interrupt vector table per MCU (for a future NVIC tab)

## ENGINE
- Headless CLI (`tools/wchcube_cli.js`) for CI diffs
- Baud/prescaler maths: actual USART baud + error %, TIM period → frequency, ADC sample time → µs
- `.wchproj` version field + migration path
- Project diff (two `.wchproj` → changed pins/settings)
- Exports: KiCad symbol pin CSV; Markdown list of used peripherals with their pins

## UI
- Parameter Settings tab; NVIC tab (enable / priority)
- Categories / A→Z toggle; expand/collapse all; show-enabled-only
- Chip rotate/flip; export pinout SVG; print view
- Project Manager tab (project name, MCU, paths, generate options) — placeholder until codegen options exist
- Keyboard shortcut overlay (?)

## QA / RELEASE
- Playwright in CI: real-browser screenshots of pinout + clock tab per MCU × package as artifacts
- Windows/macOS Tauri jobs once Linux is green
- `tests/perf.test.js`: compute() < 5 ms, full render < 100 ms on the 144-pin fixture
- Release workflow on tag: build installers, attach to a GitHub release
