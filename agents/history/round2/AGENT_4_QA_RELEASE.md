# AGENT-4 — QA + RELEASE, round 2. Owns tests/, .github/, src-tauri/, README.md, scripts/, tests/evidence/.

## P0 — prove the clock fix, then everything else
1. Reproduce the human's bug first: in a real browser (Edge/Chrome on this Windows box — you can drive it
   with Playwright if it installs from %LOCALAPPDATA%, else by hand) open dist/index.html → Clock
   Configuration → try to select HSE. Post `QA-FAIL` with the exact symptom (option missing? disabled?
   selection reverts? value stays HSI?) so AGENT-2/3 fix the real cause, not a guess.
2. Add `tests/clock_ui.test.js`: after clicking the Clock tab, the SYSCLK and PLL-source selects contain every
   option from the data, none disabled; selecting HSE changes `S.clock.sys` and the RCC setting; the chip
   shows RCC_XI/RCC_XO. This is the regression guard for the reported bug.
3. Run `agents_round2/WALKTHROUGH.md` end to end in a real browser on every MCU × package. Write results to
   `tests/evidence/round2/<date>.md` with screenshots. Every failing step → `QA-FAIL(→owner)` on the board.
   Re-run after each fix until §1–§7 all pass. That report is the round-2 exit criterion.
3b. Text legibility audit (human-reported): screenshot every view (pinout per package, clock, system, New
   Project dialog, picker open, GPIO table with 10+ rows, conflict banner with 3+ conflicts, toast, dark
   theme) at 1280×720 and 1920×1080, at browser zoom 100 % and 125 %. Flag every clipped, overflowing,
   overlapping or low-contrast text as `QA-FAIL(→AGENT-3)` with the screenshot path. Add
   `tests/legibility.test.js`: for every SVG `<text>` in the chip view, its bbox lies inside its pin
   rectangle or inside the canvas; no two label bboxes intersect; every element with `overflow:hidden` in the
   chrome has scrollHeight ≤ clientHeight after render (jsdom can't measure text — do this part with
   Playwright if it installs, otherwise keep it in the manual evidence file).
3c. `tests/completeness.test.js` (human: "every MCU needs to be FULLY FEATURED"): for every peripheral in
    every non-dummy MCU file — has ≥1 setting with a real effect, has `params` (once the schema exists), has
    DMA requests if the RM lists any for it (cross-check `dma.requests` mentions the peripheral), has NVIC
    vectors, and `generateAll()` emits an init block for it when enabled. Report every missing cell as
    `<peripheral>: <cell>`; the test fails on any. Also assert the RM chapter list is covered: read
    `data/sources/CH32V00XRM.md` headings, extract peripheral chapter names, and fail on any that has no YAML
    entry and is not on an explicit `data/mcus/CH32V006.notes.md` "intentionally not modelled" list.
4. Dead-control audit: script or by hand, click every button, select every option, toggle every checkbox and
   menu item; anything with no effect is a `QA-FAIL(→AGENT-3)`.

## P1
5. Append a "Round 2" section to ../agents/DONE.md (copy the list from 00_PROJECT.md) and tick with evidence.
6. Boot test: `window.M` non-null after loading dist in jsdom (round-1 request still open).
7. Re-audit round-1 DONE.md lines against the current tree (codegen line was stale).
8. Keep `../agents/HUMAN_TODO.md` current. Still open: git remote (CI never ran), Rust toolchain (Tauri never
   compiled), repo on Google Drive, next MCU sources, SDK clock-enable spelling.
9. If a git remote appears: push, get CI green, post `DECISION | worktrees ON`.
10. Fill your "Current" section every cycle — it was empty all of round 1.

## Authority (unchanged)
Revert anything that breaks main; add tests anywhere; tick DONE lines only on evidence. When the Round 2
section and every non-human-blocked round-1 line are green: post `DECISION | ROUND 2 DONE`, tag `v1.1.0`.
