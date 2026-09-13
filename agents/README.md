# WCH_CubeMX — the agent pack

**This folder is the whole coordination system, and it is three files.**

| File | What it is | When you read it |
|---|---|---|
| **`README.md`** (this) | the working agreement — what the product is, who owns what, the cycle, the gates, the box | **once, at the start of a session** |
| **`STATUS.md`** | **the single source of truth** — what is actually done, measured; the open list with an owner per row; each agent's standing brief and Current; the acceptance script; what only a human can do; the backlog | **every cycle, first** |
| **`BOARD.md`** | the append-only message log between agents, one line per entry | **every cycle** — only entries newer than your last one |

Nothing else in this folder is live. `history/` is closed rounds (never read in a cycle;
`history/INDEX.md` says what each produced), `proposals/` and `reference/` are cited by files in
`data/` and `tests/` and stay where they are.

Two files at the repo root are read by tools as well as by people, which is why they are not in
here: **`TASKS.md`** (the claim/tick tracker — `tests/completeness.test.js` and
`tests/codegen_compile.test.js` read it by path, so its line text is load-bearing) and
**`PROGRESS.md`** (the public record, linked from the issue templates). `STATUS.md` is the
authority for *state*; those two are the tracker and the public write-up of it.

---

## 1. What this repository is

A CubeMX-style pin/clock/peripheral configurator for WCH's CH32 RISC-V microcontrollers, and the
product is **hardware facts extracted from vendor documents**:

```
data/sources/<PART>/       vendor DS + RM (markdown conversions) and the EVT SDK
        │                  extract, cite a file:line
        ▼
data/mcus/<PART>.yaml      pins, packages, peripherals, settings, params, clock, codegen
        │                  validate_mcu.py · verify_sdk_names.py · coverage.py
        ▼
app/engine/*.js            model, conflict engine, clock tree, params, codegen
app/template.html          ─ build.py ─▶  dist/index.html   (one self-contained file)
        │
        ▼
generated PlatformIO project   ─ pio run ─▶  an ELF that compiles and links
```

The recorded failure mode of this repo is an agent shipping a plausible, internally consistent
file with pins missing and peripherals that are only a name. Everything below exists because of
that.

### The whole tree, in one table

You are expected to know what every one of these is before you change anything.

| Path | What it is | Owner |
|---|---|---|
| `data/sources/<PART>/` | the vendor drop: DS + RM as **markdown conversions** with the PDFs beside them, and the EVT SDK. The only place a hardware fact may come from | DATA |
| `data/mcus/<PART>.yaml` | the part: pins, packages, peripherals, settings, `params:`, `constraints:`, clock, `codegen:`. **The product** | DATA |
| `data/mcus/<PART>.notes.md` | the citation trail for that part — every fact's DS table, RM section or EVT `file:line`, plus the open questions | DATA |
| `data/coverage/<PART>.yaml` | the part's ledger **declarations**: aliases, `absent:` with citations, `disagreements:`, status and `open_rows:` | DATA |
| `data/coverage/ledger/<PART>.yaml` | the **generated** inventory of every function/chapter/instance. Nobody hand-edits it — `python tools/ledger.py --write` | generated |
| `data/packages/packages.yaml` | package geometries (QFN68, LQFP64, …), shared across parts | DATA |
| `data/FORMAT.md` | the MCU-file schema — the DATA↔APP contract. `validate_mcu.py` wins where they disagree | DATA |
| `data/firmware/` | a real PlatformIO project that compiles the generated C for every supported part. `lib/wchcube_generated/` is **machine-written**; never edit it | QA |
| `app/engine/*.js` | the engine: model, conflict engine, clock, params, codegen, export, history, project. **No part number may appear here** | APP |
| `app/template.html` | the UI. `build.py` inlines the engine into it | APP |
| `app/tests/` | engine unit tests (fast, no browser) | APP |
| `tests/` | the integration + gate suite: data gates, compile gates, real-browser layout/legibility, completeness, coverage, release plumbing | QA |
| `tests/fixtures/` | `.wchproj` projects the compile gates build, plus the synthetic part `mcus/WCH-DUMMY32-C8.yaml` | QA |
| `tests/evidence/round<N>/` | the artefacts behind claims — planted-break output verbatim, audits, CI post-mortems. **A claim on the board with no artefact here is what this folder exists to prevent** | QA |
| `tools/` | `validate_mcu.py`, `verify_sdk_names.py`, `coverage.py`, `ledger.py`, the `extract_*`/`gen_*` extractors, and `wchcube_cli.js` (the whole engine without a browser) | DATA / APP |
| `src-tauri/` | the desktop shell (Tauri 2): native file dialogs, bundled `data/` | QA |
| `dist/index.html` | the built app, one offline file. **Generated — never hand-edit** | generated |
| `docs/` | HOW-IT-WORKS (what the project is and how far to trust it), ADDING-A-PART, COVERAGE (the ledger rule) | QA |
| `agents/` | this pack: README, STATUS, BOARD. `history/` is closed rounds | QA |
| `TASKS.md`, `PROGRESS.md` | the claim tracker and the long-form public record, both at the root | everyone / QA |

### The two rules that bind before anything else

1. **A part is not done while the coverage ledger has an open row.** `python tools/coverage.py
   <PART>` prints every function the datasheet puts on a pin, every RM chapter and every SPL
   instance the MCU file does not account for, and exits 1 while any row is open. A row is
   *modelled* by a named signal, *absent* with a `file:line` in `data/coverage/<PART>.yaml`, or
   **OPEN**. Zero open rows plus the ordinary gates is the definition of done; anything else is
   `status: in_extraction` with an owner, a `TASKS.md` line and an `open_rows:` count that may
   only go down. Never report a part complete while the tool prints an open row, and never patch
   `data/mcus/*.yaml` with an ad-hoc script — model the row or declare it. Full rule:
   `docs/COVERAGE.md`.
2. **A citation is a `file:line` or a table number, never a family.** *"The other CH32 parts have
   it"* is not a source. Where two sources disagree, record both and average neither.

### The reading order for sources

**Markdown first, PDF last.** Read `data/sources/<PART>/Datasheets/*.md`; the PDF is the last
resort and only through a script that prints a `PDF FALLBACK:` line saying what the conversion
could not answer, recovers by script, and writes the recovered cells back so it is read **once**.
`data/sources/README.md` is the full protocol and `tests/source_order.test.js` enforces it.
Precedence for anything the software must *name*: **EVT → RM → DS → anything else.**

---

## 2. The three agents

| # | Name | Owns (may edit) | Must not edit |
|---|---|---|---|
| 1 | **DATA** | `data/mcus/**`, `data/packages/**`, `data/sources/**`, `data/coverage/**`, `data/FORMAT.md`, `tools/extract_*.py`, `tools/gen_*.py`, `tools/validate_mcu.py`, `tools/coverage*.py`, `tools/ledger.py` | `app/`, `tests/`, `src-tauri/`, `data/firmware/` |
| 2 | **APP** | `app/engine/**`, `app/template.html`, `app/tests/**`, `app/assets/**`, `build.py`, `tools/wchcube_cli.js` | `data/`, `tests/`, `src-tauri/` |
| 3 | **QA + RELEASE** | `tests/**`, `tests/evidence/**`, `src-tauri/**`, `data/firmware/**`, `.github/**`, `scripts/**`, `README.md`, `PROGRESS.md`, `Taskfile.yml`, `agents/**` (the pack) | `data/mcus/**`, `app/` (may only ADD tests, never change behaviour) |

Everyone may edit `TASKS.md`, `agents/BOARD.md`, and **their own block in `agents/STATUS.md`**.
Ownership prevents collisions; if you need a change in someone else's area, **post a REQUEST on
the board, do not edit it**.

> ENGINE and UI used to be two agents and APP is their merge. That seam generated more board
> traffic than any other: a codegen option, a data-driven control and a tab's render path are one
> change. If APP becomes the bottleneck, split it along `app/engine/**` vs `app/template.html`
> and say so on the board.

### Editing STATUS.md without colliding

Three agents share one working tree. `STATUS.md` is one file, so:

- **Write only inside your own `<!-- AGENT-n -->` block** and the deliverable rows you own.
- **§1 Measured now** is AGENT-3's; anyone may correct a number that a command they ran
  disagrees with, and must name the command.
- Never reformat someone else's block, and never rewrite the file wholesale.
- After you absorb or move something, delete the old copy **in the same write**.

---

## 2a. The handoff record — how a session picks up where another stopped

A session can end at any moment: the human closes it, the context runs out, a tool call hangs.
Whatever is in your head is gone; whatever is in `STATUS.md` is what the next agent has. So
**`STATUS.md` §4 is written as you work, not when you finish.** Each agent's block has two parts
and they have different rhythms:

```
**IN FLIGHT** - <one line: the task, or "nothing">
- TASKS.md line: <the exact text of the line you claimed `[~]`>
- Doing: <what you have actually done so far, not what you intend>
- Files touched: <paths, so the next agent can `git diff` them>
- Next step if I stop here: <the single next action, concrete enough to act on cold>
- Gates last run: <which, with the result and the SHA they ran at>

**Current** - <rewritten at the END of a cycle: what landed, what is red and who owns it,
the numbers>
```

**The rules, and each one is there because of a way this has gone wrong:**

1. **Write the IN FLIGHT block before you touch a file**, in the same edit as claiming the
   `TASKS.md` line. A claim with no in-flight block is a task nobody can resume.
2. **Update `Doing:` and `Files touched:` as you go** — at least every time you finish a file.
   "Intend to model UHSIF" and "modelled 12 of 49 UHSIF signals, `peripheral_extras.yaml` lines
   2100-2260" are different handovers.
3. **`Next step if I stop here` is written for a stranger**, not for you. Name the file, the
   line and the command. "Continue" is not a next step.
4. **Clear IN FLIGHT to `nothing` in the commit that finishes the work**, and move what
   happened into `Current`. An IN FLIGHT block that outlives its commit sends the next agent
   to redo work that is already in the tree.
5. **If you find another agent's IN FLIGHT block stale** — its files are committed, or its
   `TASKS.md` line is ticked — do not silently clear it. Post a `NOTE(→AGENT-n)` on the board
   and leave it for one cycle; if that cycle passes, clear it and say so in the entry.
6. **Uncommitted work is not a handoff.** The tree is shared, so an agent that stops with
   half-saved files leaves everyone red. Commit what compiles, even as a `[~]` still in flight,
   and say in `Doing:` what is partial. A commit that says "half of UHSIF, the rest is listed in
   STATUS §4" is worth more than a perfect uncommitted branch nobody else can see.

**What this is not.** It is not a second status file, a log, or a diary. The board carries the
decisions and the findings, `TASKS.md` carries the claims, `STATUS.md` §1-§3 carries the
project's state. §4 carries exactly one thing: *what is in somebody's hands right now, and how
to pick it up.*

---

## 3. The work cycle — every agent, every cycle

1. **Read `STATUS.md` — all of §1–§3, and every agent's §4 block, not only your own.** The
   other two blocks tell you what is in someone else's hands right now, which is how you avoid
   taking a task that is already half-done. Then `BOARD.md` from your last cycle on, then
   `TASKS.md`.
2. Answer any board request addressed to you **FIRST**.
3. Pick the highest open item in your area. In **one** edit: claim it `[~] (AGENT-n)` in
   `TASKS.md` **and** fill in your **IN FLIGHT** block in `STATUS.md` §4 (§2a above). A claim
   with no in-flight block is a task nobody can resume.
4. Do it. Keep `Doing:`, `Files touched:` and `Next step if I stop here:` current as you go —
   they are the handover, and you do not get told when the session is about to end. Build.
   Test. Fix until green:
   ```
   python build.py && node tests/run.js
   ```
5. Commit `AGENT-n: <task>`, and push. Commit what compiles even if the task is still in
   flight — uncommitted work is invisible to everyone else and leaves the shared tree red.
6. Tick `[x]` in `TASKS.md`, add one line to `BOARD.md`, clear **IN FLIGHT** back to `nothing`
   and rewrite **Current** in your `STATUS.md` block.
7. If your list is empty: work your "when idle" list, then `STATUS.md` §7 Backlog. **Idle is not
   a stop.** An agent that posts `IDLE` twice in a row with nothing between must take a backlog
   item.
8. **Requests have a deadline.** A `REQUEST(→AGENT-m)` unanswered for two of your cycles becomes
   **your** decision: post `DECISION | (unanswered) …`, implement the least-invasive version,
   move on. Never stay blocked on a colleague.
9. Check `STATUS.md` §6 before asking a human anything. If it is not there, it is not yours to ask.
10. Loop. Never stop for confirmation. Post the decision as `DECISION` and continue. **A wrong
    decision is cheaper than a stalled swarm.**

Board entries are `<UTC> | AGENT-n | KIND | text`, one line, append-only. Kinds in use:
`DONE`, `FINDING(→AGENT-n)`, `REQUEST(→AGENT-n)`, `QA-PASS`, `QA-FAIL`, `DECISION`, `NOTE`, `IDLE`.
Timestamps come from `date -u +%Y-%m-%dT%H:%MZ` — never guess one. (The pack said
`Get-Date -AsUTC -Format ...` for five rounds; **`-AsUTC` does not exist in PowerShell 5.1**,
which is what this box has. In PowerShell use
`(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mmZ')`.)

---

## 4. Gates — what a commit has to pass

```
python tools/validate_mcu.py && python tools/verify_sdk_names.py     # consistent, and names that exist
python tools/coverage.py --gate                                      # complete, or honestly counted
python build.py && node tests/run.js                                 # ALL GREEN, no unexplained skips
```

`python`, never `python3`, on this box. **Run the suite serially** — two at once corrupt each
other. `task gate` is the last two commands; `task all` adds validate, firmware and `cargo test`.

- **A check that did not run is never a pass.** The runner counts skips and prints every reason
  above the verdict.
- **If you changed what the generator emits, or what an MCU file claims, compile it** on a
  configuration that actually assigns pins — a default configuration emits an empty function and
  proves nothing:
  ```
  node tools/wchcube_cli.js --project tests/fixtures/<fixture>.wchproj --new-project <tmp>/Proj
  cd <tmp>/Proj && pio run
  ```
  Say in the commit message **which configuration you compiled**.
- **If you changed the UI, verify it in a REAL browser** — build, open `dist/index.html` in Edge
  or Chrome at 1280 and 1920 wide, light and dark, 100 % and 125 % zoom — and write `verified in
  browser` in the commit message. jsdom passing is necessary, not sufficient.
- **A gate nobody has watched go red is a guess.** Plant the break, watch it fail, restore, and
  put the verbatim red output in `tests/evidence/round<N>/`.

## 5. Rules that never bend

- **Never delete a data file or a test.** Rename, archive or deprecate instead.
- **Never lower a threshold to make something pass.** Never raise `open_rows:` or a ceiling.
- **Never hand-edit `dist/index.html`** — `build.py` generates it.
- **Never edit `data/firmware/lib/wchcube_generated/`** — it is machine-written. If the output is
  wrong, the generator is wrong.
- Every MCU fact in YAML cites a DS/RM table or an EVT `file:line` in the part's `.notes.md`.
- **A peripheral that routes no pin says so** — `pins: { none: true, source: ... }` when the
  silicon gives it no pad (the ledger checks the claim against the datasheet), `pins: { open:
  true, owner: ..., task: ... }` while its pads are unextracted. A routed signal no choice can
  claim is a dead pad and a validator ERROR. Silence in either direction is the defect that
  shipped 207 dead pads and four name-only USB controllers on one part.
- The app must open with **zero console errors or warnings** on every part × every package.
- The generator must never emit plausible-looking wrong code. If it cannot work something out
  from the data, it emits a `TODO` naming exactly what is missing.
- Nothing outside the repo is touched. Never `rm -rf` a path containing `..` or `/`.

## 6. Environment facts — do not rediscover these

- **Windows box.** `python`, never `python3` — `python3` does not exist here. `node` v24.
  PowerShell 5.1, no PowerShell 7: use `powershell`, not `pwsh`.
- **`cargo` 1.98.1 is on PATH.** `src-tauri/` compiles locally.
- **A RISC-V C compiler is installed** via PlatformIO Core 6.2.0 — WCH's GCC 12.2.0 at
  `~/.platformio/packages/toolchain-riscv`, plus the `ch32v` platform and
  `framework-wch-noneos-sdk`. `data/firmware/` builds **offline**.
- **A HOST C compiler exists**: no `gcc` on PATH, but **MinGW 9.2.0 at `C:\MinGW`**;
  `tests/firmware_native.test.js` finds it itself.
- This list has been **wrong in both directions** — first "no cargo, no compiler", then "no host
  compiler". Assume less about the box than the pack does, and correct this list in the same
  commit that proves it.
- Repo sits on a Google Drive mount: `npm install` fails with `EBADF`. Test deps live in
  `%LOCALAPPDATA%\wchcube-deps` and `tests/lib/deps.js` finds them. (Human: moving the repo to a
  local folder fixes this — `STATUS.md` §6.)
- **One repo, one `main`, one shared working tree**, remote `origin`
  `https://github.com/arwidcool/WCH_Cube.git`. Commit small, straight to `main`, push.
- Because the tree is shared: a half-saved engine module takes everyone's CLI down
  (`tools/wchcube_cli.js` reads `app/engine/*` off disk), and two top-level `const`s of the same
  name in the bundle are a fatal SyntaxError that blanks the app for everyone — `build.py` fails
  the build on it. **A staged-but-uncommitted file becomes the next agent's commit**: never
  `git add -A`; stage the paths you touched.

### Git model — worktrees

Worktrees are **suspended**. The condition for turning them on is not "a remote exists"; it is
`STATUS.md` deliverable A's list: pushed, CI green on three consecutive commits from different
agents, and `pio run` present for `data/firmware` **and** the generated-project gate. When it
flips it is one worktree per agent with a rebase-and-test merge:

```
git fetch && git rebase origin/main && python build.py && node tests/run.js && git push origin HEAD:main
```

If a rebase conflicts in a file you do not own: abort, post on `BOARD.md`, take something else.

---

## 7. Deploying an agent

Start a Claude Code session per agent, pointed at this repo, with this prompt:

```
You are AGENT-<n> on WCH_CubeMX. Read agents/README.md, then agents/STATUS.md (§1-§3 and your
own block), then agents/BOARD.md from the last entry you have not seen. Follow the work cycle in
README §3 exactly. Never stop to ask a human: decide, post the DECISION on the board, continue.
```

That is the whole handover. Everything an agent needs to know where the project stands is in
`STATUS.md`; everything it needs to know how to work here is in this file.
