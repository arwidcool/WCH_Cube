# AGENT-2 — APP, round 5

Owns `app/engine/**`, `app/template.html`, `app/tests/**`, `app/assets/**`, `build.py`,
`tools/wchcube_cli.js`. Never edits `data/`, `tests/`, `src-tauri/`.

Read `README.md` first and follow the work cycle exactly. You never stop to ask; you decide and
log. Round 5's brief is `PROJECT.md`.

**You are the merge of the old ENGINE and UI agents, and that is deliberate.** The seam between
them produced more board traffic than any other: a data-driven control, a codegen option and a
tab's render path are one change, and splitting them meant one agent describing a shape and the
other implementing it. Both halves now answer to you, so a change that spans
`app/engine/model.js`, `app/template.html` and `app/tests/` is one commit instead of three
handoffs. The obligation that comes with it: **the engine must not gain a DOM dependency and the
page must not contain engine logic.** The two remaining invariants are `tests/no_part_names`
(no part named in `app/`) and the fact that Node imports the same modules the browser bundles.

## P0 — Deliverable A: consume the constraint mechanism

DATA posts the schema on the board before filling it. Do not wait for the whole file — build
against the shape, and if the shape is wrong say so in the same cycle rather than after.

1. **Three consumers, and they must agree.** DATA's `PROJECT.md` §A.2 lists them; in this repo's
   terms:
   - **the GPIO table** — the control is absent, or its option list is reduced, **on that row**.
     A mechanism that greys a whole column when only some pins are affected has not solved it.
   - **the conflict engine** (`app/engine/engine.js`) — a claim that violates a constraint is an
     issue that names the constraint, the way an EXTI or DMA clash does today.
   - **codegen** (`app/engine/codegen.js`) — it never emits a combination the data forbids, and
     if it somehow reaches one it emits a `TODO` naming it rather than plausible-looking bits.
2. **A stored value the part forbids must degrade the way a stored speed already does.** Round 3
   fixed this once already: `gpioSpeedFor()` rewrites a saved speed the part no longer offers,
   falls back to the first legal one, and **reports what it dropped**. A `.wchproj` saved before
   the constraint existed, or one that violates it, must load with no console error and say what
   changed. Reuse that path rather than inventing a second one.
3. **CH32V006 and CH32V005 byte-identical.** Every existing test unchanged, and every generated
   file byte-identical for the same configuration. This is the half that catches a mechanism
   designed against one part, which is how rounds 3 and 4 each shipped a defect.

## P1 — Deliverable B: a clean `--strict`

4. **`codegen.nvic`** (E1) — land it the hour DATA posts the key. Round 4 wrote it as a comment;
   it becomes an `NVIC_Init` call. `NVIC_Init` takes **no handle**, like OPA.
5. **`channel_params.channels`** (E2) — the `TIM_OCInitTypeDef` emitter is written, tested against
   the proposed shape and parked. It needs the channel index from the data, not from reading the
   digit out of `"Channel1"`.
6. **Close every remaining `TODO` in generated C** across all three parts, so
   `--strict` exits 0 for every fixture — it exits 2 today.
7. **DMA and NVIC round-trip through `.wchproj`**, and regenerating after save → close → open is
   **byte-identical including DMA and NVIC**. Round 3 made this a DONE line and it is still open.
8. **USBFS host and device are two peripherals** on CH32X035 (`USBFSD`, `USBFSH`), which is a
   shape the peripheral tree has never had. The tree reads its categories from the file, so this
   may cost nothing — check rather than assume.

## P2 — carried

9. **E8-adjacent:** `window.generateProjectFiles()` and `window.desktopWriteProject` are the only
   two names the Tauri bridge looks for. If you rename either, AGENT-3's
   `tests/desktop.test.js` breaks and the desktop app stops writing projects. Say so on the board
   in the same commit if you must.
10. **The page owns the layout, the shell owns only where the root goes.** That split is what lets
    the browser ship the identical file list as a ZIP. Keep it — a path decision in
    `src-tauri/desktop.js` is a cross-area edit.
11. `app/tests/**` is yours: engine unit tests plus the api coverage floor
    (`tests/features.test.js` requires 90 % of `app/engine` exports to be referenced). A new
    engine export needs a test in the same commit or the floor drops.
12. `tools/wchcube_cli.js` must stay byte-identical to what the app produces for the same
    configuration. `app/tests/cli.test.js` asserts it; if the two ever drift, a generated-output
    diff stops being evidence about the app.

## When idle

- `BACKLOG.md` ENGINE and UI sections — the project diff, the KiCad pin CSV, the A→Z tree toggle,
  the print view, the accessibility pass.
- Read `app/engine/codegen.js` end to end looking for an assumption that only holds for the parts
  that exist today. Both round-3 and round-4 defects were found that way.

## Authority

- `python build.py && node tests/run.js` green before every commit. If you changed what the
  generator emits, **compile it** and say which configuration in the commit message.
- If you change the UI, **verify it in a real browser** at 1280 and 1920, light and dark, 100 %
  and 125 % zoom, and write `verified in browser` in the commit message. jsdom is necessary, not
  sufficient — three of the last two rounds' UI defects were invisible to jsdom.
- Post `DECISION | ROUND 5 APP DONE` when the three consumers agree, `--strict` is clean for
  every fixture, no part is named in `app/`, and CH32V006/CH32V005 are unchanged.

## Current

**Opening round 5.** Round 4 closed with 468 green, all four firmware environments building, the
generated-project gate green in the system temp directory, and `--strict` **failing** on a
`codegen.nvic` comment and a parked `TIM_OCInitTypeDef` emitter (E1, E2).

Also inherited from round 4 and unaddressed: the constraint mechanism does not exist yet, so
CH32X035's GPIO table offers **Pull-down on every row** when the part only supports it on
PA0–PA15 and PC16–PC17, and offers a drive mode on shorted pairs that the datasheet prohibits.
DATA posts the schema; you build the three consumers.
