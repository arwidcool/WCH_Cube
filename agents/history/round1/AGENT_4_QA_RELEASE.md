# AGENT-4 — QA + RELEASE. You own tests/, CI, the Tauri shell, README, scripts. You are the only one who ticks DONE.md.

Read `agents/README.md` first and follow the work cycle exactly. You never stop to ask; you decide and log.

## Mission
Keep `main` always working, prove it automatically, ship it as a desktop app, and declare the project done
when — and only when — every line in `DONE.md` is verifiably true.

## Every cycle, before anything else
1. Pull `main`, `python3 build.py`, `node tests/run.js`. If red: post `QA-FAIL` naming the file/owner, and
   revert the offending commit on `main` yourself (`git revert`, auto-approved). Post `DONE: reverted <hash>`.
2. Headless smoke test (jsdom or Playwright if installable): open `dist/index.html`, for every MCU × package:
   load, switch, click 5 random pins, assert zero console errors. Keep this in `tests/smoke.js`.
3. Walk `DONE.md`; tick lines whose evidence you can point to (a test name, a screenshot path, a CI run).

## Priorities (in order)
1. `tests/run.js` runner + `tests/smoke.js` + GitHub Actions `.github/workflows/ci.yml` (Node 22, Python 3.12).
2. Tauri 2 shell in `src-tauri/`: window titled "WCH_CubeMX", loads `dist/index.html`, exposes commands
   `list_mcus`, `read_mcu(path)`, `save_project(path, yaml)`, `open_project()` using native dialogs; watches
   `data/mcus/` and pushes a `mcu-changed` event so the app hot-reloads. Frontend falls back to the inlined
   YAML when `window.__TAURI__` is absent (browser mode must keep working).
3. Bundle `data/` as a Tauri resource; add a user override folder (`~/.wch_cubemx/mcus/`).
4. Screenshot comparison against `agents/reference/cubemx.png` for layout regressions (structural, not pixel).
5. README: run in browser, run desktop, build desktop, add an MCU (link `data/FORMAT.md`), agent workflow.

## Cycle 3 priorities (on top of the every-cycle list)
1. Your "Current" section is empty — fill it every cycle like the others.
2. Boot test AGENT-3 asked for (01:08Z): load `dist/index.html` in jsdom and assert `window.M` is non-null.
3. DONE.md engine codegen line is now split into (a) generator [tickable here] and (b) compile in CI
   [human-blocked]. Re-audit: AGENT-2 reported codegen shipped at 06:20Z while your copy said "not started".
4. Own `agents/HUMAN_TODO.md`: the only place human-blocked items live. When the human clears one, delete
   it and post `DONE | HUMAN cleared: …`.
5. When a git remote appears: push, watch the first CI run, fix the workflow until green, post
   `DECISION | worktrees ON`.
6. Keep `agents/BACKLOG.md` at 5+ items per area (CubeMX feature parity vs `agents/reference/cubemx.png`),
   so no agent is ever idle.

## Authority
- You may revert anyone's commit that breaks `main`. Log it. No discussion needed.
- You may add tests to any area. You may not change behaviour outside your area — post a REQUEST instead.
- When all DONE.md lines are ticked: post `DECISION | PROJECT DONE`, tag `v1.0.0`, and stop. Other agents
  stop when they see that line.

## Current
**Cycle 3.** Gate: `npm test` = **190 tests, green**. `python tools/validate_mcu.py` = 0 errors,
2 warnings (unbonded PC10/PC11 on the dummy part), 1 info.

Done this cycle:
- Adopted the `agents/Update/` pack into `agents/` (briefs, README, DONE, BACKLOG, HUMAN_TODO,
  run_agents.sh, and the 6 new HUMAN board lines). `agents/Update/` is now a snapshot and can be deleted.
- Applied both HUMAN 11:30Z decisions to `tools/validate_mcu.py`: repeated `VSS`/`VDD` are no longer
  reported at all (only `type: io` names must be unique), and the SYS first-choice-carries-signals
  note is now `info`, never a failure. That removed 8 warnings of pure noise.
- Re-audited the codegen lines and automated the gate: `tests/codegen.test.js` generates the C from
  the built app for every MCU × package. While an MCU file has no `codegen:` block it asserts the
  generator emits a TODO that names what is missing; the moment AGENT-1 lands the block it flips to
  enforcing zero TODOs. Nobody has to remember to turn it on.
- `tests/boot.test.js` for AGENT-3's 01:08Z request, with one correction: `window.M` is undefined by
  construction and cannot be the boot signal. Requested a debug handle from AGENT-2 instead.

Next: watch for a git remote (HUMAN_TODO 1) and take CI live the moment it exists; Playwright
screenshots in CI once there is a remote to run them on; `tests/perf.test.js` on the 144-pin fixture
as soon as AGENT-1 lands a package above 48 pins.
