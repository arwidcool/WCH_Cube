# WCHCube

STM32CubeMX-style pinout, peripheral and clock configurator for WCH MCUs.

```
wchcube/
├── TASKS.md                 ← task tracker: what's done / in progress / next
├── build.py                 ← inlines the YAML into dist/index.html
├── app/template.html        ← the app (CSS + HTML + JS, one file)
├── dist/index.html          ← BUILT app — open in any browser, no server needed
└── data/
    ├── packages/packages.yaml   ← package geometries (SOP, TSSOP, QFN, LQFP…)
    └── mcus/*.yaml              ← one file per MCU (currently a dummy part)
```

## Run
Open `dist/index.html` in a browser. That's it.

## Projects
**New project** → pick the MCU, then the exact part number / package (I/O count, flash, SRAM, temp grade shown), name it.
**Save project** (Ctrl+S) downloads `<name>.wchproj` — a readable YAML with MCU, variant, package and every setting.
**Open project…** restores it; the matching MCU file must be bundled or loaded first. One project = one MCU + one package.

## Edit an MCU
Edit `data/mcus/<part>.yaml` then run `python3 build.py`, or use **Open MCU file…** in the app to load a YAML straight from disk without rebuilding.

The file format is documented in the header of `data/mcus/WCH-DUMMY32-C8.yaml`. Key idea: pin
alternate functions live only in each peripheral's `remaps` table; the app derives the per-pin
signal list and all conflicts from that.

## Stack
Plain JS + SVG, YAML data (js-yaml). No framework, no build tooling beyond the tiny inliner.
Planned desktop wrapper: Tauri (Rust) — see TASKS.md Phase 4.
