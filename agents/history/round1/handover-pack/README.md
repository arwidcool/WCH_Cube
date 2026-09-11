# WCH_CubeMX — autonomous 4-agent work plan

Four Claude Code agents work in parallel on this repo until the Definition of Done in
`DONE.md` is met. No human approval in the loop. Everything is auto-approved.

## The four agents

| # | Name | Owns (may edit) | Must not edit |
|---|---|---|---|
| 1 | **DATA** | `data/mcus/*`, `data/packages/*`, `data/mcus/*.notes.md`, `tools/extract_*` | `app/`, `src-tauri/` |
| 2 | **ENGINE** | `app/engine/*`, `app/tests/*`, `build.py`, the JS engine section of `app/template.html` (sections 1–3 & 8) | `data/`, CSS/HTML markup, `src-tauri/` |
| 3 | **UI** | CSS/HTML/render sections of `app/template.html` (sections 4–7), `app/assets/*` | `data/`, engine logic, `src-tauri/` |
| 4 | **QA + RELEASE** | `tests/*`, `src-tauri/*`, `.github/*`, `README.md`, `scripts/*` | `data/`, `app/` (may only ADD tests, never change behaviour) |

Everyone may edit: `TASKS.md`, `agents/BOARD.md`, their own `agents/AGENT_<n>_*.md` "current" section.
Ownership prevents merge conflicts. If you need a change in someone else's area, POST A REQUEST on the board, don't edit it.

## Coordination files (the whole communication system)

- `TASKS.md` — the backlog. Claim a task by changing `[ ]` to `[~] (AGENT-n)`. Finish it with `[x]`.
- `agents/BOARD.md` — the message board. Append-only. Requests, handoffs, blockers, decisions.
- `agents/AGENT_n_*.md` — each agent's standing instructions + a "Current" section it rewrites every cycle.
- `DONE.md` — definition of done. When every line is checked by QA, the project is done.

## Environment facts (learned on the first run — do not rediscover them)
- Windows box. `python3` does not exist; use **`python`** (3.12). CI still uses `python3`.
- Repo sits on a Google Drive mount: `npm install` fails with EBADF. Test deps live in
  `%LOCALAPPDATA%\wchcube-deps` and `tests/lib/deps.js` finds them. Human: move the repo off Google Drive when convenient.
- No `cargo`/`rustc`, no `gcc`. Tauri compile and C compile checks are CI-only.
- Git: AGENT-4 ran `git init`; there is **no remote**. Worktrees are SUSPENDED — all four agents share one
  working tree and commit straight to `main` with small commits `AGENT-n: <task>`.
- Because the tree is shared: after you absorb/move a function, delete the old copy IN THE SAME WRITE and
  run `python build.py && node tests/run.js` before your next edit. A duplicate top-level `const` in the
  bundle is a fatal SyntaxError that blanks the app for everyone.
- Timestamps on the board come from `date -u +%Y-%m-%dT%H:%MZ` (PowerShell: `Get-Date -AsUTC -Format yyyy-MM-ddTHH:mmZ`), not guessed.

## Git model

**Suspended until a remote exists** (see Environment facts). When the human adds a remote, AGENT-4 posts
`DECISION | worktrees ON` and the model below applies. Until then: one shared tree, commit to `main` directly.

One repo, one `main`. Each agent works in its own git worktree on its own branch and merges to
`main` itself (auto-approve) once tests pass:

```
git worktree add ../wchcube-data    agent/data
git worktree add ../wchcube-engine  agent/engine
git worktree add ../wchcube-ui      agent/ui
git worktree add ../wchcube-qa      agent/qa
```

Merge rule: `git fetch && git rebase origin/main && python3 build.py && node tests/run.js && git push origin HEAD:main`.
If rebase conflicts in a file you don't own → abort, post on BOARD, wait one cycle.

## The work cycle (every agent, forever, until DONE.md is fully checked)

1. `git pull --rebase` your branch on `main`.
2. Read `agents/BOARD.md` (only entries newer than your last cycle) and `TASKS.md`.
3. Answer any board request addressed to you FIRST.
4. Pick the highest task in your area that is `[ ]`; claim it `[~] (AGENT-n)`.
5. Do it. Build (`python3 build.py`). Run tests (`node tests/run.js`). Fix until green.
6. Commit with message `AGENT-n: <task>`; rebase; push to `main`.
7. Mark `[x]` in TASKS.md, write one line in BOARD.md (`DONE: …`), update your "Current" section.
8. If your area has no `[ ]` tasks left: run the "when idle" list in your agent file, then check `DONE.md`.
   **Idle is not a stop.** If your list is empty, take the highest open request on the board addressed to
   anyone in a *blocked* area that you can legitimately help with (write a test, a fixture, a proposal file
   for them to paste), post it as `HANDOFF(→AGENT-m)`, and keep going. An agent that has posted `IDLE`
   twice in a row with nothing between must pick something from `agents/BACKLOG.md`.
8b. **Requests have a deadline.** A `REQUEST(→AGENT-m)` unanswered for 2 of your cycles becomes YOUR decision:
   post `DECISION | (unanswered) …`, implement the least-invasive version, and move on. Never stay blocked on a colleague.
9. Check `agents/HUMAN_TODO.md`. If a DONE line needs the human, it is listed there once; do not re-request it on the board.
10. Loop. Do not stop for confirmation. Do not ask questions to a human. If a decision is needed, make it, record it in BOARD.md under `DECISION:`, and move on. A wrong decision is cheaper than a stalled swarm.

## Rules that never bend

- Never delete a data file or a test. Rename/deprecate instead.
- Never lower a test threshold to make it pass.
- Every MCU fact that goes into YAML cites DS/RM table in the `.notes.md`.
- The app must always open with zero console errors after every merge (QA enforces).
- `dist/index.html` is generated; never hand-edit it.
- Do not touch anything outside the repo. Never run `rm -rf` on a path containing `..` or `/`.

## Launching (see `run_agents.sh`)

Each agent is a Claude Code session started in its worktree with its agent file as the prompt and
permission prompts disabled:

```
claude --permission-mode bypassPermissions -p "$(cat agents/AGENT_1_DATA.md)" ...
```
`--dangerously-skip-permissions` is the same thing; on first use it shows a one-time confirmation unless
`~/.claude/settings.json` contains `"skipDangerousModePermissionPrompt": true`. `run_agents.sh` sets that.
Run this only on a machine/VM you're fine with an agent having full shell access to.
