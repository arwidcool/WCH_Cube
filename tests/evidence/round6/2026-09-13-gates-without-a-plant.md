# Gates without a planted break — named, with the reason  (round 6, deliverable B)

**Acceptance for B is that this list is EMPTY.** Until it is, every entry is a check nobody has
seen fail on purpose, and the reason is written so the next person can either plant it or say
why it cannot be. Status at 2026-09-13T00:00Z, after cycle 1.

## Seen red for REAL on the runner — better than a plant, and recorded as such

| Check | Where it went red | Why that counts |
|---|---|---|
| `build › dist/index.html is not stale` | run 34714307941 (`14f5a5e`) on `3853b57`'s stale dist; run 34718350387-era on `096daa6`'s | The check rebuilds the tree's own dist and compares, so a plant would have to mutate `app/` or `data/` on a shared tree — refused. It caught two real stale commits in one day; the annotations name them. |
| `ci.yml › dist/index.html is up to date` (workflow step) | the same two runs, Linux job | Blind on Windows until the autocrlf step (`git diff` normalises endings) — that blindness is itself a recorded finding. |

## Covered by a plant in a sibling that runs the SAME harness and assertion

| Check | Covered by |
|---|---|
| `smoke › app boots with a silent console` | `boot › planted break: a page that writes to the console at boot is caught as not silent` — same `boot({html})`, same `problems()`. |
| `codegen › once an MCU file has a codegen: block its C contains no TODO` | its own sibling `a missing codegen: block produces a TODO that says what is missing` — the negative case is a standing test. |
| `generated_project › platformio.ini names the board from the MCU file` | its sibling `a variant with no pio_board is refused by name` — the standing negative. |

## Closed this cycle (AGENT-3, 2026-09-13T20:06Z)

| Check | Closed by |
|---|---|
| `features › arrow keys / Enter / Delete` (keyboard) | `tests/keyboard_ui.test.js` — the real-browser sibling this row said it needed. Dispatches genuine `KeyboardEvent`s at `window` inside a real Chrome/Edge tab (`tests/lib/browser.js`), which the app's `window.addEventListener('keydown', ...)` cannot distinguish from an operator's keypress — the jsdom objection does not apply to a real tab. Two planted breaks, both watched red: emptying `const ARROWS = {...}` (a copy, `withMutantDist`) leaves `U.focus` at `null` after `ArrowDown`; neutering the `Delete`/`Backspace` branch's `resetPin()` call leaves an assigned pin's state at `'set'` after pressing Delete. `node tests/run.js "keyboard_ui"`: 4/4. |

## Not yet planted — the reason, and what a plant would take

| Check | Reason it is not planted yet | What it would take |
|---|---|---|
| `features › a user label set on a pin shows on the chip and in the export` | needs a mutation of the label RENDERER inside the bundled app, not of data; the anchor is engine code, which is AGENT-2's and moves | a `data-test` hook on the label element — **requested from AGENT-2 directly by main, 2026-09-13**; plant against it the moment it lands |
| `legibility`, `layout` (real browser) | already carry breaks (3–4 refs each); listed only to say they were checked, not skipped | — |

## Planted this cycle (twelve, all in `2026-09-12-planted-breaks.md` with the red verbatim)

collision ratchet · reachability · SPL-header guard · fixture freshness · LTDC default pad ·
IN_EXTRACTION expiry (40 cells) · 8080 preset completeness · pinless-USB · boot painted ·
boot silent · New Project catalogue (a variant renamed in a dist copy via `withMutantDist`,
`CH32V003F4P6/TSSOP20` reported missing) · smoke click sweep (the renderer's pin class
renamed in a dist copy — the page boots and draws, `#svg .pin` matches nothing, every
package of CH32V006 reported "nothing drawn (0 pins)"; the first attempt renamed the chip
container and the app threw at boot, which is a different finding and is written beside it). Plus the pre-existing: `--strict` TODO, coverage self-test (21), sdk_names,
source_order, clock_ui (2), data duplicate-key (9 cases), constraints, layout, legibility.
