# AGENT-4 — QA + RELEASE, round 3.

Owns `tests/`, `tests/evidence/`, `.github/`, `src-tauri/`, `README.md`, `scripts/`, and — new this
round — **`data/firmware/**` and `PROGRESS.md`**. May add tests anywhere; may only ADD to `app/`,
never change its behaviour.

You built the firmware project. Round 3 is where it earns its place: **turn "the generated C
compiles" from a sentence into a gate that runs, fails loudly, and cannot be skipped quietly.**

## P0 — the compile gate

1. **`tests/codegen_compile.test.js`.** Generate C from a fixture configuration and build it.
   - Fixtures live in `tests/fixtures/*.wchproj` and must be **configurations that exercise
     something**: pins assigned on several ports, a remap set, params on USART/SPI/TIM, a DMA
     request, an enabled NVIC vector. The check that passed in round 3's setup pass used a default
     TSSOP20 configuration where **no GPIO is assigned and `WCHCube_GPIO_Init()` is empty** — it
     proved the plumbing and nothing about the code. Do not repeat that mistake in a test.
   - Run `node tools/wchcube_cli.js --project <fixture> --format c --pio data/firmware` (AGENT-2 is
     adding `--pio`; until it lands, write both files and move the header yourself), then
     `pio run -e <env>` in `data/firmware`.
   - Matrix: CH32V006 on TSSOP20 (`CH32V006F8P6`) and QFN32 (`CH32V006K8U6`), CH32V005 on TSSOP20.
   - **Skipping rules.** If `pio` is not on PATH, the test **skips with a printed reason**, and the
     run summary says how many compile checks were skipped. A silent skip is worse than a failure —
     it is how "compiles" got asserted for a whole round without anyone compiling.
   - Restore the drop zone afterwards. `data/firmware/lib/wchcube_generated/` is `.gitignore`d, but
     a test must not leave a generated file lying where the next build picks it up.
2. **Both round-3 P0 defects get a regression test**, not just a fix:
   - a generated header that names a file not present in the SDK for that part must fail;
   - a generated `GPIO_Speed_*` macro that is not in that part's `GPIOSpeed_TypeDef` must fail.
   The cleanest way to test both is to compile. The second cleanest is AGENT-1's
   `tools/verify_sdk_names.py` — wire it into `node tests/run.js` the moment they post it, and say
   on the board what you want its exit codes to mean.
3. **`tests/completeness.test.js`** — round-2 item, still open. For every peripheral in every
   non-dummy MCU file: has ≥1 setting with a real effect; has `params`; has DMA requests if the RM
   lists any; has NVIC vectors; and `generateAll()` emits an init block for it when enabled. Report
   every missing cell as `<peripheral>: <cell>` and fail on any.
   AGENT-1's whitelist of deliberate absences is in `CH32V006.notes.md` under *"Round 2: PWR, FLASH
   and EXTI added as real peripherals"* — ESIG (read-only silicon identity), DBG (covered by SYS's
   debug setting), GPIO/AFIO (the pin grid itself), PFIC (the `nvic:` block, not a tree entry).
   Also assert the RM chapter list is covered: read the headings out of
   `data/sources/V006/Datasheets/CH32V00XRM.md` — **note the new path**, the sources were
   reorganised into `<PART>/{Datasheets,Evt}/`.

## P1 — finish round 2's audit, then round 3's

4. **Re-run `../Agents Rounds 2/WALKTHROUGH.md` end to end.** At the last pass: §4 complete and
   passing, §6b complete and failing with the 8 legibility findings, §1 partially covered, and
   §2/3/5/6/7 never run in a real browser. §5b was blocked on DMA/NVIC existing — AGENT-3 is
   building them this round, so it unblocks. Evidence to `tests/evidence/round3/<date>.md`.
5. **`tests/legibility.test.js`** — you have the measurements now, so turn them into a test. For
   every SVG `<text>` in the chip view, its bbox lies inside its pin rectangle or inside the canvas;
   no two label bboxes intersect; every element with `overflow:hidden` in the chrome has
   `scrollHeight ≤ clientHeight` after render. jsdom cannot measure text — use Playwright if it
   installs from `%LOCALAPPDATA%`, otherwise keep that half in the manual evidence file and say so.
6. **A round-3 walkthrough section** covering the new path end to end, added to
   `WALKTHROUGH.md` in this folder: configure → Project Manager tab → preview the C → Generate →
   build in `data/firmware` → (optionally) flash. That is the round's exit criterion the way §1–§7
   was round 2's.
7. **Dead-control sweep, finished.** Round 2's stalled on `#m-open` and `#m-openproj`, which open an
   OS file chooser headless Chrome cannot answer — skip those two by id and say so; they need a
   human or a jsdom stub. AGENT-3 is removing or implementing the `Project Manager` and `Tools`
   placeholder tabs; verify whichever they choose.

## P1b — the desktop shell, which is no longer blocked

8. **`cargo` exists on this box now** (1.98.1). `src-tauri/` has never been compiled; `agents/README.md`
   still says it cannot be. Build it: `cd src-tauri && cargo build`. There is an uncommitted fix in
   `src-tauri/src/main.rs` making `open_project` return `Ok(Some(...))` and an untracked
   `Cargo.lock` — review both, commit or revert deliberately, do not leave them floating.
9. **The Tauri command AGENT-3 will ask for**: write generated files to a chosen folder. It belongs
   next to `save_project`. Agree the signature on the board before they build the button.
10. **Correct `agents/README.md` "Environment facts".** It says there is no `cargo` and no C
    compiler. Both are false now, and four agents are reading it as ground truth.

## P2 — release hygiene

11. Append a **"Round 3"** section to `../agents/DONE.md` from `00_PROJECT.md` and tick only on
    evidence. Re-audit the round-1 and round-2 lines against the current tree while you are there —
    one was already found stale.
12. **Keep `PROGRESS.md` true.** It is yours now and it is the first thing a new agent or a human
    reads. Every cycle: does any statement in it still hold? Especially §6 "Known issues and
    blockers" and §7's honest caveat about what the compile check did and did not prove.
13. `HUMAN_TODO.md`: item 5 is **resolved** (the SDK was on the machine all along), items 2 and 4
    have moved (cargo exists; CH32X035 sources arrived). Still genuinely open: the git remote, and
    the repo living on a Google Drive mount.
14. `.github/workflows/ci.yml` has never run. When a remote appears: push, get it green, add a
    `pio run` job for `data/firmware`, post `DECISION | worktrees ON`.
15. The human's untracked `Taskfile.yml` is a stub (`echo "Hello, world!"`). Either make it the
    real task runner for this repo — `build`, `test`, `firmware`, `validate` — or leave it alone and
    say on the board that you did. Do not half-adopt it.

## Authority (unchanged)
Revert anything that breaks `main`; add tests anywhere; tick DONE lines only on evidence.
When the Round 3 section and every non-human-blocked line are green: post
`DECISION | ROUND 3 DONE` and tag `v1.2.0`.

## The standard you are holding everyone to
Round 3's rule is **"a name nobody compiled is a guess"**, and you are the one who compiles. Two
defects sat in shipped data through a whole round of browser testing because nothing ever fed the
generated C to a compiler. Your gate is what makes that a one-time story.

Equally: **do not overstate your own passes.** The setup pass reported a successful build with
generated code and then said, in the same paragraph, that it proved nothing about GPIO code because
no pin was assigned. Keep writing them that way.

---

## Current — round 3, cycle 1 (2026-09-11T14:37Z)

**Done this cycle.**

- **P0.1 the compile gate — `tests/codegen_compile.test.js`.** Three fixtures in
  `tests/fixtures/`, built by `make_fixtures.js` driving the real engine, each one
  assigning pins: CH32V006 TSSOP20 → `CH32V006F8P6`, CH32V006 QFN32 →
  `CH32V006K8U6`, CH32V005 TSSOP20 → `CH32V005F6P6`. All three compile and link.
  Flash 7 796 → 7 972 B against the old default-config build, so `WCHCube_GPIO_Init()`
  is genuinely not empty. The generator refuses to write a fixture with a pin
  conflict or under 8 assigned pins; `--check` fails when the data moves under them.
- **P0.2 both defects have regression tests, and one result matters more than the
  test.** Planted-break tested, three breaks, three caught. The wrong-case header
  break **still compiles** on Windows — NTFS resolves it — so only the name check
  sees it. Compiling is necessary and not sufficient; that is why the two checks
  sit side by side. Name checks read `data/sources/<PART>/Evt/` first and fall back
  to the PlatformIO package.
- **Skips are first class** (`skip()` / `SkipError` in the harness, counted and
  listed above the verdict by the runner, on green runs too). Verified with
  PlatformIO off PATH.
- **P1b.8 `src-tauri` compiled** — and it never had. The floating `open_project`
  change was required to compile at all; proved by reverting the one line and
  running `cargo check`. Fix and `Cargo.lock` committed.
- **P1b.10 `agents/README.md` environment facts** corrected and committed.
- **P2.12 `PROGRESS.md`** — four false statements fixed, §7 rewritten with an
  explicit "what this does and does not support saying".
- **Round 3 put under git.** `data/firmware/`, `PROGRESS.md`, the pack and the
  reorganised `data/sources/` were all untracked, with the two original datasheets
  showing as deleted and their replacements untracked. Committed. DECISION:
  `data/Pio Source/` gitignored — a 45 MB copy of an installed PlatformIO platform,
  and the brief forbids vendoring the SDK.

**Found, and handed off.** The **EVT packages have landed** for V006 and X035 —
`PROGRESS.md` and `data/sources/README.md` both still said they were empty. They
are **not** the same as the copy PlatformIO installs and the drop is newer
(StdPeriph 0x05 vs 0x04): `GPIO_Remap_LSI_CAL` `0x00200080` → **`0x001A3000`** and
`FLASH_FLAG_OPTERR` `0x00000001` → **`0x80000001`**. The first is the TIM1
CH1-from-LSI remap the MCU file models. On the board for AGENT-1 and AGENT-2.

**Next, in order.** C8 `tests/completeness.test.js` · `tests/legibility.test.js` ·
the round-2 walkthrough re-run with evidence to `tests/evidence/round3/` · the
round-3 walkthrough section · the Round 3 block in `agents/DONE.md` · `Taskfile.yml`
decided either way · the dead-control sweep finished · `lib/util` host tests under
`[env:native]`.

**Not claimed, deliberately.** The gate compiles GPIO, AFIO and RCC. `params:` ride
in the fixtures but codegen does not emit `*_InitTypeDef` yet, and DMA/NVIC are not
in the `.wchproj` format at all — they join the gate the day AGENT-2's P2 lands, and
until then the gate does **not** cover them. Nothing has been flashed. Nothing has
ever been built on Linux, which is the one place the wrong-case header would have
failed loudly.
