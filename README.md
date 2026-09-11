# WCHCube

An STM32CubeMX-style pinout, peripheral and clock configurator for WCH RISC-V microcontrollers.

Pick a part, click a pin, choose a signal. The app shows you which peripherals can reach
which pins on that exact package, colours the conflicts orange, and tells you *before* you
click when a choice would collide with something you have already set.

```
WCH_CubeMX/
├── dist/index.html          BUILT app - open it in any browser, no server, no network
├── app/
│   ├── template.html        the page: CSS, markup, and the render/UI script
│   ├── engine/*.js          the engine as ES modules (model, conflicts, clock, project, export)
│   └── vendor/js-yaml.js    bundled YAML parser (MIT), so the app works offline
├── data/
│   ├── mcus/*.yaml          one file per MCU - the whole part definition
│   ├── packages/packages.yaml   package geometries (SOP, TSSOP, QFN, LQFP...)
│   ├── sources/<PART>/      the DS, the RM and (when provided) the EVT package
│   └── firmware/            PlatformIO project - compiles the generated C for real silicon
├── build.py                 inlines the engine and the YAML into dist/index.html
├── tests/                   QA suites + the runner (npm test)
├── tools/validate_mcu.py    checks an MCU file before you trust it
├── src-tauri/               desktop shell (Tauri 2)
├── PROGRESS.md              where the project stands - read this first
├── TASKS.md                 what is done, in progress and next
└── agents/                  the four-agent working agreement (see "How this repo is built")
```

## Run it in a browser

Open `dist/index.html`. That is the whole instruction — it is a single self-contained
file with no external requests, so it works from a USB stick or an offline machine.

After changing anything in `app/` or `data/`, rebuild:

```bash
python build.py
```

(`python3` on macOS and Linux. Never edit `dist/index.html` by hand — it is generated.)

## Run it as a desktop app

The desktop build is the same page in a native window, plus the things a browser cannot
do: it reads the MCU folder from disk, uses native file dialogs, and reloads a part the
moment you save its YAML in another editor.

```bash
cd src-tauri
cargo run              # development
cargo tauri build      # installers in src-tauri/target/release/bundle/
```

You need [Rust](https://rustup.rs) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS. `build.py` runs
automatically before a release build.

MCU files are read from two places, and the second wins:

| Folder | What it is |
|---|---|
| the app's bundled `data/mcus/` | the parts that ship with the release |
| `~/.wch_cubemx/mcus/` | your own parts and overrides |

Drop a YAML in the second folder and it appears in the MCU list. Edit one while the app is
open and the part reloads in place, keeping your package selection.

## Projects

**New project** — pick the MCU, then the exact part number and package. The dialog shows
flash, SRAM, I/O count and temperature grade for each variant.

**Save project** (Ctrl+S) writes `<name>.wchproj`: readable YAML holding the MCU, variant,
package and every setting, remap and pin. In the browser it downloads; on the desktop you
get a native save dialog.

**Open project** restores all of it. One project is one MCU on one package. The matching
MCU file has to be loaded first — bundled, in your override folder, or via **Open MCU file…**.

## Add an MCU

1. Copy `data/mcus/WCH-DUMMY32-C8.yaml`. Its header documents the format, and
   `data/mcus/CH32V006.yaml` is a complete real example with datasheet citations.
2. Fill in `mcu:`, the `packages:` pin tables, the `pins:` list and the `peripherals:`.
3. Check it:

   ```bash
   python tools/validate_mcu.py data/mcus/YOUR_PART.yaml
   ```

4. `python build.py`, then reload the page. Or skip the rebuild entirely and use
   **Open MCU file…** to load the YAML straight from disk.

The one idea worth knowing: **alternate functions are never listed per pin.** Each
peripheral carries a `remaps:` table saying which pin each signal lands on for each value
of the AFIO remap field. The app derives every pin's signal list, and every conflict, from
those tables. One place to edit, and the conflicts are computed rather than maintained.

`tools/validate_mcu.py` checks schema, that every package has a geometry to draw it with,
that pin numbers run 1..N with no gaps, that every signal a mode can request is actually
routed somewhere, that remap indices are in range, and that each variant's datasheet I/O
count matches the pin table. Use `--strict` to treat warnings as errors.

## Running the tests

```bash
npm install     # jsdom + js-yaml, test-only
npm test        # builds, then runs every suite
```

`npm test` runs `node tests/run.js`, which executes the engine unit tests in `app/tests/`
and the QA suites in `tests/`:

| Suite | What it protects |
|---|---|
| `app/tests/*` | the engine: model, conflicts, clock, project, export, undo |
| `tests/data.test.js` | every MCU file is valid, drawable and loadable |
| `tests/build.test.js` | `dist/index.html` is complete, current, offline, and has no duplicate declarations |
| `tests/layout.test.js` | the CubeMX layout and the chip fitting its canvas at 1280x720 and 1920x1080 |
| `tests/desktop.test.js` | the Tauri config and bridge — including that it does nothing at all in a browser |
| `tests/smoke.js` | every MCU on every package: load, switch, click, assign, zero console output |

Filter with `node tests/run.js <text>`, e.g. `node tests/run.js smoke`.

If `npm install` cannot write to this folder — a known npm failure on Google Drive and
network shares (`EBADF`) — install the two test dependencies anywhere and the tests will
find them:

```bash
npm install --prefix "%LOCALAPPDATA%\wchcube-deps" jsdom@25 js-yaml@4
```

Set `WCHCUBE_DEPS` to point somewhere else. The Rust in `src-tauri/` is compiled by CI;
`tests/desktop.test.js` covers everything about the shell that does not need a toolchain.

## Build the firmware

`data/firmware/` is a PlatformIO project that compiles for real CH32V006 / CH32V005 /
CH32X035 silicon with the WCH EVT NoneOS SDK. It is where the configurator's generated
`wchcube_init.c/.h` becomes an ELF — and the only place the claim "the generated C
compiles" can be checked instead of asserted.

```bash
cd data/firmware
pio run                     # default environment: CH32V006F8P6 (TSSOP20)
pio run -t upload           # over WCH-Link
```

In VS Code, open `data/firmware` as the folder (PlatformIO needs `platformio.ini` at the
workspace root), or open `data/firmware/wchcube-firmware.code-workspace` to get the repo
and the firmware side by side.

Feed it a configuration from the repo root:

```bash
node tools/wchcube_cli.js CH32V006 --package TSSOP20 --format c      --out data/firmware/lib/wchcube_generated/src
```

`src/main.c` picks it up through `__has_include` and calls `WCHCube_Init()`; with the drop
zone empty the firmware still builds and says so at startup. `data/firmware/README.md` has
the details and `data/firmware/ARCHITECTURE.md` has the layering and ownership rules.

## How this repo is built

Four Claude Code agents work on it in parallel — **DATA**, **ENGINE**, **UI** and
**QA + RELEASE** — each owning a part of the tree so they never edit the same file.
They coordinate only through `agents/BOARD.md` (append-only) and claim work in `TASKS.md`.
`agents/README.md` has the rules, `agents/DONE.md` is the definition of done, and QA is the
only agent that ticks it. If you are picking the project up by hand, read `TASKS.md` first.

## Stack

Plain JavaScript, SVG and YAML. No framework and no bundler — `build.py` concatenates the
engine modules and inlines the data, which is why the result is one file you can email to
someone. The desktop wrapper is Tauri 2 (Rust), and it loads the very same file.
