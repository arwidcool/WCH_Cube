# WCH_CubeMX — autonomous agent work plan

This folder is the **whole** coordination system. Three agents work in parallel on this repo
until the Definition of Done in `DONE.md` is met. No human approval in the loop; everything is
auto-approved.

There used to be five places holding agent instructions — `agents/`, `agents/Update/`, and a
folder per round. Which one was authoritative depended on the round, and two of them
contradicted each other. **`agents/` is now the only one.** Rounds 1–4 are archived under
`history/` and are never read during a cycle; `history/INDEX.md` says what each one did.

## The three agents

| # | Name | Owns (may edit) | Must not edit |
|---|---|---|---|
| 1 | **DATA** | `data/mcus/**`, `data/packages/**`, `data/sources/**`, `data/FORMAT.md`, `tools/extract_*.py`, `tools/validate_mcu.py` | `app/`, `tests/`, `src-tauri/`, `data/firmware/` |
| 2 | **APP** | `app/engine/**`, `app/template.html`, `app/tests/**`, `app/assets/**`, `build.py`, `tools/wchcube_cli.js` | `data/`, `tests/`, `src-tauri/` |
| 3 | **QA + RELEASE** | `tests/**`, `src-tauri/**`, `data/firmware/**`, `.github/**`, `scripts/**`, `README.md`, `PROGRESS.md`, `Taskfile.yml` | `data/mcus/**`, `app/` (may only ADD tests, never change behaviour) |

Everyone may edit: `TASKS.md`, `agents/BOARD.md`, and their own `agents/AGENT_<n>_*.md`
"Current" section. Ownership prevents collisions; if you need a change in someone else's area,
**post a REQUEST on the board, do not edit it**.

**ENGINE and UI used to be two agents, and APP is their merge.** That seam generated more board
traffic than any other: a codegen option, a data-driven control and a tab's render path are one
change, and splitting them meant one agent describing a shape and another implementing it. One
owner of `app/` is the point. The cost is that a single agent now carries the whole app; if that
becomes the bottleneck, split it along `app/engine/**` vs `app/template.html` and say so on the
board.

## The files, and which is authoritative for what

| File | What it is | Who keeps it true |
|---|---|---|
| `PROJECT.md` | **the current round brief** — read it every cycle | AGENT-3 |
| `AGENT_n_*.md` | your standing instructions + a "Current" section you rewrite each cycle | each agent |
| `BOARD.md` | the message board. Append-only, one line per entry | everyone |
| `DONE.md` | the definition of done. QA ticks a line only on evidence | AGENT-3 |
| `HUMAN_TODO.md` | things only the human can do, listed once, never re-requested | AGENT-3 |
| `BACKLOG.md` | feature-parity items for an agent whose brief is complete | everyone |
| `WALKTHROUGH.md` | the acceptance script for the round's exit criterion | AGENT-3 |
| `../PROGRESS.md` | where the project actually stands, checked against the tree | AGENT-3 |
| `../TASKS.md` | the backlog. Claim `[~] (AGENT-n)`, finish `[x]` | everyone |

`PROGRESS.md` and `TASKS.md` are at the repo root, not here, because humans read them too.
Everything else that coordinates agents is in this folder.

## Environment facts (do not rediscover these)

- **Windows box.** `python`, never `python3` — `python3` does not exist here. `node` v24.
- **`cargo` 1.98.1 is on PATH.** `src-tauri/` compiles locally.
- **A RISC-V C compiler is installed** via PlatformIO Core 6.2.0: WCH's GCC 12.2.0 at
  `~/.platformio/packages/toolchain-riscv`, plus the `ch32v` platform and the
  `framework-wch-noneos-sdk` package. `data/firmware/` builds **offline**.
- **A HOST C compiler exists**: there is no `gcc` on PATH, but **MinGW 9.2.0 is at
  `C:\MinGW`** and `pio test -e native` runs `lib/util`'s host tests once it is on PATH.
  `tests/firmware_native.test.js` finds it itself.
- This file has now recorded this machine **wrongly in both directions** — first "no cargo, no
  compiler", then "no host compiler". Assume less about the box than the pack does, and correct
  this list in the same commit that proves it.
- Repo sits on a Google Drive mount: `npm install` fails with `EBADF`. Test deps live in
  `%LOCALAPPDATA%\wchcube-deps` and `tests/lib/deps.js` finds them.
  (Human: moving the repo to a local folder fixes this.)
- **Git: one repo, no remote, one shared working tree.** Worktrees stay suspended until a remote
  exists — never create one. Commit straight to `main`, small, `AGENT-n: <task>`.
- **The tree is shared, so run the suite serially.** Two `node tests/run.js` at once corrupt each
  other: one rebuilds `dist/index.html` while the other reads it, and the compile gate builds
  into a shared drop zone. One suite at a time per machine.
- Because the tree is shared: after you absorb or move a function, delete the old copy IN THE SAME
  WRITE. Two top-level `const`s of the same name in the bundle are a fatal SyntaxError that blanks
  the app for everyone, and `build.py` fails the build on it.
- Timestamps come from `Get-Date -AsUTC -Format yyyy-MM-ddTHH:mmZ`
  (`date -u +%Y-%m-%dT%H:%MZ` elsewhere). Never guess one.

## Git model

One repo, one `main`, **one shared tree**, no remote. Commit small, straight to `main`.

Worktrees are suspended until a remote exists. When one appears, AGENT-3 posts
`DECISION | worktrees ON` and the model becomes one worktree per agent with a rebase-and-test
merge:

```
git fetch && git rebase origin/main && python build.py && node tests/run.js && git push origin HEAD:main
```

If a rebase conflicts in a file you do not own: abort, post on `BOARD.md`, take something else
that cycle.

## The work cycle (every agent, every cycle, until DONE.md is fully ticked)

1. Read `BOARD.md` — **only entries newer than your last cycle** — and `TASKS.md`.
2. Answer any board request addressed to you **FIRST**.
3. Pick the highest task in your area that is `[ ]`; claim it `[~] (AGENT-n)`.
4. Do it. Build. Test. Fix until green. Both commands, every time:
   ```
   python build.py && node tests/run.js
   ```
5. Commit `AGENT-n: <task>`.
6. Mark `[x]` in `TASKS.md`, add one line to `BOARD.md`, rewrite your "Current" section.
7. If your list is empty: work the "when idle" list in your own file, then `BACKLOG.md`.
   **Idle is not a stop.** An agent that posts `IDLE` twice in a row with nothing between must take
   something from `BACKLOG.md`.
8. **Requests have a deadline.** A `REQUEST(→AGENT-m)` unanswered for two of your cycles becomes
   **your** decision: post `DECISION | (unanswered) …`, implement the least-invasive version, and
   move on. Never stay blocked on a colleague.
9. Check `HUMAN_TODO.md` before asking a human anything. If it is not there, it is not yours to ask.
10. Loop. Never stop for confirmation and never ask a human a question. Make the decision, post it
    as `DECISION`, continue. **A wrong decision is cheaper than a stalled swarm.**

## Gates — what a commit has to pass

- `python build.py && node tests/run.js` → **ALL GREEN, no unexplained skips.** The runner counts
  skips and prints every reason above the verdict; a check that did not run is never a pass.
- **If you changed what the generator emits, or what an MCU file claims, compile it** on a
  configuration that actually assigns pins — a default configuration emits an empty function and
  proves nothing:
  ```
  node tools/wchcube_cli.js --project tests/fixtures/<fixture>.wchproj --new-project <tmp>/Proj
  cd <tmp>/Proj && pio run
  ```
  Say in the commit message **which configuration you compiled**.
- **If you changed the UI, verify it in a REAL browser** — build, then open `dist/index.html` in
  Edge or Chrome at 1280 and 1920 wide, light and dark, 100 % and 125 % zoom — and write
  `verified in browser` in the commit message. jsdom passing is necessary, not sufficient.
- `task gate` is those two commands. `task all` adds validate, firmware and `cargo test`.

## Rules that never bend

- **Never delete a data file or a test.** Rename or deprecate instead.
- **Never lower a threshold to make something pass.**
- **Never hand-edit `dist/index.html`** — it is generated by `build.py`.
- **Never edit `data/firmware/lib/wchcube_generated/`** — it is machine-written. If the output is
  wrong, the generator is wrong.
- Every MCU fact in YAML cites a DS/RM table or an EVT `file:line` in the part's `.notes.md`.
  **"The other CH32 parts have it" is not a citation.**
- Precedence for anything the software must *name*: **EVT → RM → DS → anything else.** Where EVT
  and the RM disagree they answer different questions; record both, average neither.
- The app must open with **zero console errors or warnings** on every part × every package.
- The generator must never emit plausible-looking wrong code. If it cannot work something out from
  the data, it emits a `TODO` naming exactly what is missing.
- Nothing outside the repo is touched. Never `rm -rf` a path containing `..` or `/`.

## Launching

`run_agents.ps1` in this folder starts one Claude Code session per agent with permission prompts
disabled, each pointed at its own `AGENT_n_*.md`.

```
powershell -File agents\run_agents.ps1            # start all three
powershell -File agents\run_agents.ps1 -Only 2    # start just AGENT-2
powershell -File agents\run_agents.ps1 -DryRun    # print the commands, start nothing
```

Use `powershell`, not `pwsh` — this box has Windows PowerShell 5.1 and no PowerShell 7. That is
also why `run_agents.ps1` is ASCII-only: 5.1 reads a `.ps1` as ANSI unless it has a UTF-8 BOM, so
an em-dash decodes into a quote character and breaks the parser further down the file.

Run it only on a machine you are willing to give an agent full shell access to. The script sets
`skipDangerousModePermissionPrompt` so the one-time confirmation cannot block an unattended start.
