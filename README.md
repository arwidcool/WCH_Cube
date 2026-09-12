# WCHCube

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![no dependencies](https://img.shields.io/badge/runtime%20dependencies-none-brightgreen.svg)](#stack)
[![one file](https://img.shields.io/badge/app-one%20offline%20HTML%20file-informational.svg)](#run-it-in-a-browser)

An STM32CubeMX-style pinout, peripheral and clock configurator for WCH RISC-V microcontrollers.

Pick a part, click a pin, choose a signal. The app shows you which peripherals can reach
which pins on that exact package, colours the conflicts orange, and tells you *before* you
click when a choice would collide with something you have already set.

![The pinout view: CH32V006 on TSSOP20 with USART1 and SPI1 assigned](docs/images/app-pinout.png)

> ### Read this before you trust it
>
> **This project is mostly vibe-coded.** The application was written by AI coding agents under
> a written working agreement, with a human setting direction. It is fast and internally
> consistent, and it has one specific, well-documented blind spot: an AI will confidently write
> plausible-looking code for a chip it has never seen. It has shipped exactly that bug three
> times — a wrong SDK header, a GPIO speed macro that does not exist, and a drive mode the
> silicon cannot do. All three were caught by *building something*, never by reading code.
>
> **And nothing here has ever been flashed.** Every green result in this repository is a
> **compile**. No board has been attached. Hardware behaviour is unverified.
>
> → **[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)** explains both in detail, and is worth ten
> minutes before you rely on anything below.

## Documentation

| Document | Read it when |
|---|---|
| **[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)** | You want to understand the design and **exactly how much of it to trust**. Start here. |
| **[docs/ADDING-A-PART.md](docs/ADDING-A-PART.md)** | Your microcontroller is not supported. The whole process: drop the vendor files in, let an AI extract them, verify. |
| **[docs/COVERAGE.md](docs/COVERAGE.md)** | You are extracting a part, or asking whether one is finished. The coverage ledger: every function on every pin the datasheet lists is modelled, declared absent with a citation, or **open** — and a part is not done while a row is open. |
| **[data/FORMAT.md](data/FORMAT.md)** | You are writing or editing an MCU file. The field-by-field schema. |
| **[PROGRESS.md](PROGRESS.md)** | What is actually done, broken, and never tested. |
| **[docs/](docs/)** | Index of all of the above. |

Supported parts — the list is `data/mcus/`, and adding to it does not require touching `app/`:
**CH32V006**, **CH32V005** (defined as a delta on CH32V006), **CH32V003** and **CH32X035** — a
second, deliberately different family (24-bit ports, no HSE, named remap macros) that exists to
prove the engine is data-driven rather than shaped around one chip.

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
│   ├── sources/<PART>/      the DS, the RM and the EVT package
│   └── firmware/            PlatformIO project - compiles the generated C for real silicon
├── docs/                    how it works, and how to add a part (with pictures)
├── build.py                 inlines the engine and the YAML into dist/index.html
├── tests/                   QA suites + the runner (npm test)
├── tools/validate_mcu.py    checks an MCU file before you trust it
├── src-tauri/               desktop shell (Tauri 2)
├── PROGRESS.md              where the project stands - read this first
├── TASKS.md                 what is done, in progress and next
└── agents/                  the three-agent working agreement (see "How this repo is built")
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

1. Start from `data/mcus/CH32V006.yaml` — a complete real part with datasheet citations
   on every block — and read `data/FORMAT.md` for the schema. (`data/mcus/` holds real
   silicon only; the synthetic layout fixture lives in `tests/fixtures/mcus/`.)
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

5. Close the coverage ledger — `python tools/coverage.py YOUR_PART` lists every function
   the datasheet puts on a pin that the file does not model, every RM chapter and every SDK
   instance it does not account for, and exits 1 while any remain. Zero open rows is what
   "done" means here; [`docs/COVERAGE.md`](docs/COVERAGE.md) is the loop.

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

Three Claude Code agents work on it in parallel — **DATA**, **APP** and **QA + RELEASE** —
each owning a part of the tree so they never edit the same file. They coordinate only through
`agents/BOARD.md` (append-only) and claim work in `TASKS.md`. `agents/` is the single agent
working directory: `README.md` has the rules, `PROJECT.md` is the current round brief,
`DONE.md` is the definition of done, and QA is the only agent that ticks it. Rounds 1–4 are
archived under `agents/history/`. If you are picking the project up by hand, read `TASKS.md`
first.

## Contributing

The two things that would help most, in order:

1. **Flash one generated project and report what happened.** It is a five-minute job with any
   CH32V006/CH32V005/CH32X035 board and a WCH-Link, and it is the only claim in this repository
   that nobody here can close. See [`agents/HUMAN_TODO.md`](agents/HUMAN_TODO.md).
2. **Add a part.** If your microcontroller is missing, [`docs/ADDING-A-PART.md`](docs/ADDING-A-PART.md)
   is the whole process — it is a data job, not a programming job, and it does not require
   understanding the engine.

**Before opening a PR**, the gate is two commands and both must be green:

```bash
python build.py && node tests/run.js
```

Beyond that, the rules that matter and the reasons for them are in
[`agents/README.md`](agents/README.md). The short version:

- **A hardware fact needs a citation** — a datasheet table, an RM section, or an EVT `file:line`.
  Precedence is **EVT → Reference Manual → Datasheet**. *"The other CH32 parts have it" is not a
  citation*, and it is precisely how all three of the shipped data defects happened.
- **If you changed what the generator emits, compile it** on a configuration that assigns pins.
  A default configuration generates an empty function and proves nothing.
- **If you changed the UI, look at it in a real browser.** jsdom has no layout engine and cannot
  see clipped text; it is necessary, not sufficient.
- **Never delete a data file or a test, and never lower a threshold to make something pass.**
- **`dist/index.html` is generated** — never hand-edit it.
- **Nothing in `app/` may name a part.** If behaviour differs between parts, it belongs in the data.

The [PR template](.github/PULL_REQUEST_TEMPLATE.md) walks through these. Answering *"I did not
run that"* is much more useful here than a guess.

## Stack

Plain JavaScript, SVG and YAML. No framework and no bundler — `build.py` concatenates the
engine modules and inlines the data, which is why the result is one file you can email to
someone. The desktop wrapper is Tauri 2 (Rust), and it loads the very same file.
