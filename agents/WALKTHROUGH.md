# WALKTHROUGH — round 5 acceptance

Run this end to end before `DECISION | ROUND 5 DONE`. It is written to be runnable by someone who
did not write any of it. Every step says what to do, what you should see, and what a failure means.

The app's acceptance script from rounds 2–4 still applies — configure a part, switch packages,
check the tree, the clock tab, the export. It is archived in `history/`. This file covers what
round 5 adds and what it must not break.

Prerequisites: `python build.py` has been run. `pio` is installed. A real browser is available.

---

## §1 — the constraint mechanism, on the part that has constraints

1. Open `dist/index.html`. Load **CH32X035** and select the **QFN28** package.
2. In **Pinout & Configuration**, pick a pin **inside** the pull-down allow-list — PA3, say — and
   set it to an input. **Expected:** the **Pull-down** option is offered.
3. Pick a pin **outside** it. On QFN28, `PC0`–`PC7` and `PC10`–`PC11` are outside (the allow-list
   is PA0–PA15 and PC16–PC17). **Expected:** Pull-down is **not offered** — absent from the
   control, not greyed, and the reason is available.
   *A failure here in the "offered anyway" direction is the round's whole point. A failure in the
   "not offered anywhere" direction is a worse bug: a mechanism that hides the control everywhere
   passes a one-sided check, which is why step 2 exists.*
4. Configure a **shorted pair** as an output. **Expected:** refused, and the message names the
   reason (the datasheet prohibits output functions on shorted pins). Find a shorted pair from
   the pin tooltip — it shows both names, e.g. `PC17/PC10`.
5. Switch to **USBFS** and enable it as a device. Then go back to the GPIO table and try to drive
   **PC10** or **PC11**. **Expected:** refused while USBFS is on; allowed again when it is
   switched off. This is the conditional case and it is the one most likely to be missing.
6. Console must be **silent** through all of the above. Open the browser console and confirm.

## §2 — the mechanism does not touch parts that have no constraints

7. Load **CH32V006** on **TSSOP20**. The GPIO table offers exactly the modes and pulls it offered
   before round 5 — read them, do not assume.
8. Load **CH32V005**. Same answer, and it is `inherits: CH32V006`, so this also proves the
   constraint block survives or is correctly absent through inheritance.
9. `git stash`-free check: for a configuration you saved before the round, the generated C is
   **byte-identical**. The cheapest way is to generate C for a `tests/fixtures/*.wchproj` and
   confirm `tests/codegen_compile.test.js`'s "the checked-in fixtures still match what the engine
   produces" is green without regenerating them.

## §3 — a clean `--strict`

10. For **every** fixture in `tests/fixtures/`:
    ```
    node tools/wchcube_cli.js --project tests/fixtures/<fixture>.wchproj --strict
    ```
    **Expected:** exit **0**, no output about TODO or `#error`.
    At the start of the round this exits **2**. A fixture that exits 2 at the end of the round is
    an open E1/E2/params line, not a pass.
11. Confirm the generated C still **compiles** on a configuration that assigns pins:
    ```
    node tools/wchcube_cli.js --project tests/fixtures/CH32X035_QFN28_full.wchproj --new-project "$env:TEMP\R5Proj"
    cd "$env:TEMP\R5Proj"; pio run
    ```
    **Expected:** SUCCESS. *A default configuration generates an empty function and proves
    nothing — use a fixture that assigns pins.*

## §4 — the gates

13. `python build.py && node tests/run.js` → **ALL GREEN.** Read the last block: any skip is
    printed with its reason and counted. A skip you cannot explain is a failure.
14. `tasks=` no `[~]` left in `TASKS.md` that the round was supposed to close.
15. `python tools/validate_mcu.py` → exit 0, and `python tools/verify_sdk_names.py` → exit 0 with
    no part reported NOT CHECKED for a reason that no longer applies.
16. `node tools/wchcube_cli.js --list` names **three real parts** — CH32V005, CH32V006, CH32X035.
    No synthetic fixture may appear; `tests/data.test.js` guards this.
17. `grep -ri "x035\|ch32v006\|ch32v005\|x033" app/engine/ app/template.html` → comments only.

## §5 — the browser, properly

18. Reload the app at **1280×720** and **1920×1080**, at **100 %** and **125 %** zoom, **light and
    dark**. The New Project dialog, the GPIO table and the clock tab must all fit with nothing
    clipped. A round-5 change to the GPIO table's per-row controls is exactly the kind of thing
    that breaks the 125 % case and nothing else.
19. Open the **Project Manager**. Generate. **Expected in a browser:** one `<Name>.zip`; **on the
    desktop:** a native folder picker, then `<folder>/<Name>/`. Either way the file list is the
    whole project and the panel says where it went before you click. Unzip and confirm the folder
    builds: `cd <Name> && pio run`.

## §6 — the things that are still not true

20. **Nothing has been flashed.** Confirm `agents/HUMAN_TODO.md` item 8 is present, that the
    `DONE.md` hardware line reads exactly **"builds, not flashed"**, and that `PROGRESS.md` says
    the same. If anyone has rounded that up, this is the step that catches it.
21. **`src-tauri` may still be unverified in a window.** Check whether `PROGRESS.md` records that
    the relink status is unknown, and that no board entry claims the desktop path is verified.

---

## The verdict

Post on `BOARD.md`:

```
<UTC> | AGENT-3 | QA-PASS | WALKTHROUGH round 5 run end to end. §1 n/n, §2 n/n, ... What failed: ... (or "nothing").
```

`DECISION | ROUND 5 DONE` requires §1–§5 green. §6 is not a blocker — it is the honest statement
of what remains, and it must still be there when the round closes.
