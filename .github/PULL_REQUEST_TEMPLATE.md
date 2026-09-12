# Pull request

Thanks for the contribution. This project has unusually strict gates, and they are strict
because each one was earned by a defect that shipped — three of which were an AI agent
confidently writing plausible code for a chip it had never seen. Please fill this in honestly;
"I did not run that" is a perfectly good answer and much better than a guess.

## What does this change?

<!-- One paragraph. If it fixes a bug, say which one and link the issue. -->

## Which of these does it touch?

- [ ] **Data** — `data/mcus/*.yaml`, `data/packages/`, `data/sources/`
- [ ] **Engine** — `app/engine/*.js`, `app/tests/`
- [ ] **UI** — `app/template.html`, `app/assets/`
- [ ] **Tests / CI / release** — `tests/`, `src-tauri/`, `data/firmware/`, `.github/`
- [ ] **Docs only** — no code changed

## The gates

Tick what you actually ran. If you did not run one, leave it and say why below.

- [ ] `python build.py` — the app built
- [ ] `node tests/run.js` — **ALL GREEN**, no unexplained skips
- [ ] `python tools/validate_mcu.py` — no errors (if you changed any MCU file)
- [ ] `python tools/verify_sdk_names.py` — no errors (if you changed any MCU file)
- [ ] **Compiled the generated C**, if what the generator emits changed:
      `node tools/wchcube_cli.js --project tests/fixtures/<f>.wchproj --new-project <tmp>/Proj && cd <tmp>/Proj && pio run`
- [ ] **Verified in a real browser**, if the UI changed — 1280 and 1920 wide, light and dark, 100% and 125% zoom
- [ ] No part number added to `app/` — if a behaviour differs between parts, it came from the data

<!-- Which configuration did you compile, if you compiled one? "A default configuration
     generates an empty function and proves nothing." -->

## If this changes a hardware fact

Every claim needs a source, and the precedence for *which document wins* is
**EVT → Reference Manual → Datasheet**. For *which copy of a document you read*, it is the
other way round on cost: the **markdown conversion first**, the original PDF only as a last
resort — missing, unreadable or demonstrably incomplete — read by a script that says why
(`PDF FALLBACK:`) and writes the recovered cells back into the repo.

- Datasheet table / RM section / EVT `file:line`:
- Was the fact re-derived by a second pass (`tools/extract_pins.py`, `tools/extract_remaps.py`)
  and diffed? If yes, what was the difference count?

## If this changes the UI

<!-- The app is required to open and run with a completely silent console, on every part and
     every package. Any console output at all is a bug in itself. -->

- Console output: <!-- "silent" is the expected answer -->
- Anything you know is still clipped, overlapped or unreadable:

## Anything you did not do, or are unsure about

<!-- This is the most useful box on the form. -->
