# AGENT-4 — QA + RELEASE, round 4.

Owns `tests/`, `tests/evidence/`, `.github/`, `src-tauri/`, `README.md`, `scripts/`,
`data/firmware/**`, `PROGRESS.md`. May add tests anywhere; may only ADD to `app/`.

Round 3 you built the compile gate. Round 4 it gets a second family to prove and a new artefact to
prove: **a generated project folder that a human could flash.**

## P0 — carried over from round 3
1. **D5** The Tauri command AGENT-3 needs: write a set of generated files to a chosen folder. It
   belongs next to `save_project`. In round 4 it writes a **whole project tree**, not two files, so
   agree the signature on the board before they build the button — it takes a list of
   `{ path, text }` and a root, refuses a non-empty directory unless confirmed, and never overwrites
   a file the generator did not write.
2. **D6** Host-side unit tests for `lib/util` under `[env:native]`.
3. **D7** `agents/README.md` "Environment facts"; the round-3 section in `agents/DONE.md`.
4. **D9** `#m-open` / `#m-openproj` dead-control sweep; `Taskfile.yml` adopt-or-leave.

## P0b — the gates, with a second family in them

5. **`tests/generated_project.test.js` — the round's new gate.** Generate a **whole project** to a
   scratch directory and build it standalone:
   ```
   node tools/wchcube_cli.js --project <fixture> --new-project <tmp>/Proj
   cd <tmp>/Proj && pio run
   ```
   - Exit 0, for **CH32V006 TSSOP20 and CH32X035** once the part lands.
   - Assert the folder is actually self-contained: `platformio.ini`, `src/main.c`, `README.md`,
     `lib/wchcube_generated/include/wchcube_init.h`, `.../src/wchcube_init.c`, and **no reference to
     anything outside the folder**. The whole point is that a user can move it anywhere.
   - Assert `platformio.ini` names the board from `variants[*].pio_board` and that generating for a
     variant with **no** `pio_board` (CH32V006F4U6, D8U7) is refused by name rather than silently
     substituting a neighbour.
   - Build in the system temp directory, not in the repo, and clean up.
   - **Skips with a printed reason** when `pio` is absent, and the run summary says how many compile
     checks were skipped. A silent skip is how "compiles" got asserted for a whole round without
     anyone compiling.
6. **Extend every existing suite to CH32X035 × every package**: `smoke.js`, `layout.test.js`,
   `legibility.test.js`, `completeness.test.js`, `codegen_compile.test.js`, `data.test.js`.
   LQFP64 with 60 I/O and names like `USBPD_CC1` is the first real stress the legibility test has
   had — the dummy part was built to be well-behaved.
7. **A fixture for X035**, in `tests/fixtures/`, built by `make_fixtures.js` the way the other three
   are: pins on more than one port, a remap, params, a DMA request, an NVIC vector. Add
   `CH32X035G8U6` to the compile matrix in `codegen_compile.test.js`.
8. **`tests/no_part_names.test.js`** — the cheapest test in the round and it guards a DONE line:
   `grep -ri "x035\|ch32v006\|ch32v005" app/engine/ app/template.html` comes back empty except for
   comments. A part named in code is a part the next one will not work like.
9. **The regression half.** Every X035 change gets CH32V006 and CH32V005 run against it. Your
   suites already do this by construction — make sure the *compile* matrix does too, because that is
   the one where a shared codegen change is most likely to break the part nobody is looking at.

## P1 — the firmware project, and the hardware question

10. **`data/firmware` gains an X035 story.** The `[env:CH32X035G8U6]` environment has existed since
    round 3 and builds with no generated code in it. Once AGENT-1's part lands, it should build
    **with** generated code, and `data/firmware/README.md`'s note that "the configurator has no
    CH32X035 data yet" becomes false — fix it the day it does.
11. **The hardware claim nobody here has ever made.** Every green result in this repo is a
    *compile*. `pio run -t upload` onto real silicon is a different and much stronger claim.
    - If a human has a CH32V006 or CH32X035 board and a WCH-Link, the generated project is the
      easiest thing they have ever been asked to flash: open the folder, press Upload, watch the
      SDI output. Put that in `agents/HUMAN_TODO.md` as a **specific, one-paragraph request with the
      exact commands**, not a vague ask.
    - If it happens, the result goes in `tests/evidence/round4/` and it is the first hardware
      result this project has.
    - If it does not, **the DONE line says "builds, not flashed", in those words.** Do not let
      anyone round that up.
12. **`WALKTHROUGH.md` in this folder** — §13 onward covers the new path: configure CH32X035 →
    Project Manager → Generate PlatformIO project → open the folder → `pio run` → (optionally)
    `pio run -t upload` → read the SDI banner. That is the round's exit criterion.

## P2 — the stale-documentation sweep

13. **Both EVT packages have landed** — `data/sources/V006/Evt/` (988 files) and
    `data/sources/X035/Evt/` (2 239 files). Every "until the EVT package arrives" sentence in the
    repo is now false. They are in `PROGRESS.md`, `data/firmware/ARCHITECTURE.md`, the round-3 pack
    and `data/sources/README.md` (AGENT-1 owns that last one). Fix yours and post the list.
14. **Keep `PROGRESS.md` true.** It is the first thing a new agent or a human reads. Round 4 changes
    §5 (hardware status: a second family), §6 (blockers), §7 (what the firmware and the gates now
    prove) and §9 (next steps). Especially: it currently says the compile check "proved the plumbing
    and nothing about the code" — when that stops being true, change it, and when a new caveat
    applies, add it.
15. `.github/workflows/ci.yml` still has never run — no remote. When one appears: push, get it
    green, add `pio run` for `data/firmware` **and** the generated-project gate, post
    `DECISION | worktrees ON`.

## Authority (unchanged)
Revert anything that breaks `main`; add tests anywhere; tick DONE lines only on evidence.
When the Round 4 section and every non-human-blocked line are green: post
`DECISION | ROUND 4 DONE` and tag `v1.3.0`.

## The standard you are holding everyone to
Round 3's rule was *"a name nobody compiled is a guess"* and it found two real defects. Round 4's is
its sibling: **a part nobody generated a project for is a part nobody has actually used.** The gap
between "the C compiles" and "I can flash this and see a light blink" is where the remaining
unknowns live, and closing it is what this round is for.

And keep writing your passes the way you have been. The round-3 setup pass reported a successful
build with generated code and said, in the same paragraph, that it proved nothing about GPIO code
because no pin was assigned. That paragraph is why the gate exists.

---

## Current — round 4, cycle 1 (2026-09-11T17:12Z)

**Answered first, because it was addressed to me.** AGENT-1's QA-FAIL: both
`completeness.test.js` reds were my tables, not their data. Verified both against
the EVT headers rather than taking them, and one came out stronger than offered —
`ch32v00X.h:438` puts EXTEN at `HBPERIPH_BASE + 0x3800`, so the HB membership is
provable from the header rather than inferred from a macro's absence.

**Done.**
- **D5** `write_project(name, files, overwrite)`. Validates every path BEFORE
  creating anything — there is a test on that *ordering*, because a bad entry
  halfway down a list must not leave a half-written tree. `safe_relative()` unit
  tested over 5 real paths and 9 escapes. **`cargo test` runs in the suite now.**
- **D6** 10 host-side Unity tests for `lib/util`, in the suite via
  `tests/firmware_native.test.js`.
- **D7** environment facts and the stale round pointer.
- **D9 half** `Taskfile.yml` ADOPTED, not half-adopted.
- **CH32X035 through the compile gate** — `pio run -e CH32X035G8U6` exits 0 from a
  fixture whose `build()` contains no part-specific code.
- **`tests/no_part_names.test.js`**, **`tests/generated_project.test.js`** (nine
  checks, skipping loudly on `projectFiles()`), the GPIO enum check generalised
  from speeds to modes, per-part exemption keys, `PROGRESS.md`, the Round 4 DONE
  section, and `HUMAN_TODO` 6.

**Found, all verified against EVT before reporting.** X035 has **no open-drain
GPIO modes** and `gpio.modes` gives it two (round 3's speed defect, one field
over) · `USBFS_DEVICE` does not exist · the UI's `MODES` list is hardcoded, so
fixing the data alone would not stop the table offering them · `GPIO_Mode_IPD` is
per-pin on this part · a third variant with no `pio_board`.

**Three numbers of MINE in the round-4 brief were wrong** — 47 vectors (45), 40
remap macros (38), and the EXTI framing. AGENT-1 caught the first two by applying
the round's rule to the round's own pack. Corrected, and worth remembering: I
wrote a table telling everyone to check rather than assume.

**Next.** The X035 packages into `layout`/`legibility` (LQFP64M with `USBPD_CC1`
is the first real stress that test has had) · the walkthrough §13 onward ·
confirm AGENT-3's dead-control result and close D9 · `pio check` for X035 ·
the CI job when a remote appears.

**Not claimed.** `projectFiles()` does not exist, so deliverable B is nine
skipping checks and not a feature. Nothing has been **flashed** — every green
result here is a compile, the DONE line says "builds, not flashed" in those
words, and `HUMAN_TODO` 6 is the specific ask.
