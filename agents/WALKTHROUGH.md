# WALKTHROUGH — round 6 acceptance

Runnable by someone who did not write it. Every step is a thing you SEE, not a thing you are
told. AGENT-3 runs it end to end before posting `DECISION | ROUND 6 DONE`, and posts which
steps failed. Round 5's script is in `history/round5/WALKTHROUGH.md`; its §4b (CH32H417, ten
steps) still holds and is not repeated — run it as step 0 here.

## §1 — CI has run, and somebody read it

1. Open the Actions tab for `origin`. There is at least one completed run of `ci.yml` on `main`.
   Not a badge — the run page, with three jobs listed: `test`, `firmware`, `desktop`.
2. Open the `firmware` job's log. Find the compile-gate suite output. It must show
   `CH32V006 TSSOP20: ... compiles for CH32V006F8P6 ... ok` — an actual **ok**, not a skip line
   reading "pio not on PATH". Count the skips in the summary block; the reason for each is
   printed, and none may be "PlatformIO is not installed".
3. In the same log, find the `Coverage ledger` step. It prints `coverage gate: 6 of 6 part(s)
   meet their declared status` on the runner. This is the third data gate and until this round
   nobody had seen it run anywhere but one Windows box.
4. `PROGRESS.md` quotes the run URL, and no longer contains the words "never run in CI".
5. `agents/BOARD.md` has `DECISION | worktrees ON` posted **after** step 2's run, not before.

## §2 — every gate has been seen red

6. `tests/evidence/round6/` exists and holds one file per planted break, each with the red
   output verbatim and the restore. Open two at random and check the red is real: the
   assertion text names the thing that was planted.
7. Run `node tests/run.js "can actually fail\|planted break\|can go red"`. Every suite named in
   `AGENT_3_QA_RELEASE.md` P1 has at least one hit and every hit is `ok`.
8. The board carries AGENT-3's list of checks that **cannot** go red, by name, with a reason
   for each. The acceptance is that this list is **empty**; if it is not, the round is not done
   and the list is the honest statement of why.

## §3 — CH32H417's Parameter Settings are not empty

9. New project → CH32H417 → QFN128. Select `ADC1`, then `CAN1`, then `DAC`, then `FMC`. Each
   shows a Parameter Settings tab with real rows. `tests/completeness.test.js` no longer has a
   CH32H417 entry in `IN_EXTRACTION`, and the TASKS.md line is ticked.
10. Select `FMC`, `Bus mode: 8080 LCD, 8-bit`. Parameter Settings shows the
    `FMC_NORSRAMInitTypeDef` timings (address setup, data setup, bus turnaround). Generate:
    the C carries `FMC_NORSRAMInit(...)` with those values and **no TODO**.
11. `python tools/verify_sdk_names.py` → 0 errors. Every `sdk:` macro the new params name is
    in `ch32h417_*.h`.

## §4 — the clock tab computes what it used to declare absent

12. CH32H417, clock tab. There is a box for `USBHS_PLL` with its own source mux and multiplier,
    and a `USBFS 48M` tap with a **source select** offering the choices RM 3.4.13 gives it.
13. Pick `USBHS_PLL / 10` for `USBFS 48M`. The tap reads **48 MHz**. Change the USBHS PLL
    multiplier; the number moves. This number was uncomputable at the round's open.
14. Save, reload, reopen: the mux choice comes back. Undo, redo: it moves and moves back.
15. On CH32V006 the clock tab is **unchanged** — one PLL, no mux selects, no new controls. The
    schema did not leak into parts that do not need it.

## §5 — the per-instance struct emits

16. CH32H417, `LTDC` on, both layers' pixel formats set. Generate. `WCHCube_LTDC_Init()` now
    carries two `LTDC_Layer_InitTypeDef` blocks and two `LTDC_LayerInit(LTDC_Layer1, ...)` /
    `(LTDC_Layer2, ...)` calls. The round-5 comment saying "your layer init applies it" is gone.
17. CH32L103, `CMP1` on. Generate. `OPA_CMP_Init(&s)` with `s.CMP_NUM = CMP1` fixed by
    `const:`, and CH32L103 reads **0 open** in `python tools/coverage.py CH32L103`.
18. `--strict` exits 0 on every fixture: `node tests/run.js "strict"` all `ok`.

## §6 — the ledger

19. `python tools/coverage.py --quiet` prints **six zeros**. All six parts `complete`.
    (Round 5 said: this section is written the day every part reads complete, not before.)
20. `python tools/coverage_selftest.py` → all planted breaks caught, and the count printed.

## §7 — the things that are still not true

21. **Nothing has been flashed.** `DONE.md`'s hardware line reads exactly **"builds, not
    flashed"**, `PROGRESS.md` says the same, and `HUMAN_TODO.md` item 8 is still there. If
    anyone rounded this up, this step catches it.
22. **`src-tauri` unverified in a window** unless `HUMAN_TODO.md` item 7 has a reply. Check
    `PROGRESS.md` says so, and no board entry claims the desktop path is verified.

---

## The verdict

Post on `BOARD.md`:

```
<UTC> | AGENT-3 | QA-PASS | WALKTHROUGH round 6 run end to end. §1 n/n, §2 n/n, ... What failed: ... (or "nothing").
```

`DECISION | ROUND 6 DONE` requires §1–§6 green. §7 is not a blocker — it is the honest
statement of what remains, and it must still be there when the round closes.
