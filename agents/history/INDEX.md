# History — rounds 1 to 5, archived

**Do not read this during a work cycle.** It is here so a decision can be looked up
when it is genuinely in question, and so nothing was thrown away. The live pack is
three files: `../README.md` (the agreement), `../STATUS.md` (the single source of
truth) and `../BOARD.md` (the log). `round6-pack/` holds the eight files they replaced
on 2026-09-13, including `DONE.md`'s rounds 1-5 evidence record.

This folder replaced four top-level directories — `agents/`, `Agents Rounds 2/`,
`Agents Rounds 3/`, `Agents Rounds 4/` — which had grown to five parallel copies of
the same instructions with a different one being authoritative depending on the
round. `agents/` is now the single working directory; the rounds live here.

| Folder | The round | Its rule | What it actually produced |
|---|---|---|---|
| `round1/` | 1 — the machinery | (none stated) | The app skeleton: `app/engine/*.js` split out of the template, the CubeMX frame and chip renderer, the conflict engine, the clock tab, `.wchproj` save/load, the dummy part. Ended with **15 of 24** DONE lines ticked. |
| `round2/` | 2 — correctness of what you can click | (none stated) | The imported-design correctness pass: shorted pins, exposed pad, per-package reset, remap-collision preview, HSE coupling, the 8 legibility findings, DMA/NVIC data. Open lines carried to round 3 as **C1–C8**. |
| `round3/` | 3 — the generated code is the product | **"a name nobody compiled is a guess"** | `data/firmware/` as a real PlatformIO project, the **compile gate**, `tools/verify_sdk_names.py`, and two shipped defects found by compiling — `codegen.header: ch32v00x.h` (the CH32V003 header, masked by NTFS case-insensitivity) and `GPIO_Speed_50MHz` (does not exist on CH32V006). Carried to round 4 as **D1–D9**. |
| `round4/` | 4 — a second family, and a project you can flash | **"a part nobody generated a project for is a part nobody has actually used"** | CH32X035 extracted end to end from its own DS/RM/EVT, `projectFiles()` + `app/engine/zip.js`, `tests/generated_project.test.js`, the New Project dialog rewritten as one flat searchable part catalogue, the Output folder choice. Carried to round 5 as **E1–E9**. |
| `round5/` | 5 — every choice the app offers must be one the silicon can honour, and the coverage ledger | **"consistent is not the same as complete"** | The constraint mechanism (per-pin pull-down/shorted-pair/USBFS rules, CH32X035 first); the **coverage ledger** — `tools/coverage.py`, `data/coverage/`, `docs/COVERAGE.md`, seven checks read from the datasheet at gate time, which found **207 dead pads and four name-only USB controllers** on CH32H417 with every gate green; CH32H417 to **0 open rows** (113 → 0 in one day) and CH32L103 to 12; the **CH32H417 push** — clock sweep on five parts, a second package under the compile gate, `tests/h417_packages.test.js` (every pin reachable, every peripheral configurable, no default collides: 26/20/17 found, 4/0/0 left), the LTDC pixel format and the FMC 8080 `Bus mode` on direct human requests; and the **duplicate-key hole** — three green Python gates over a file js-yaml refused. Ended at **721 tests, all green**. Carried to round 6 as deliverables **A–F**. |

## What each folder holds

```
round1/  AGENT_1..4, BOARD.md, run_agents.sh, handover-pack/
round2/  00_PROJECT.md, AGENT_1..4, BOARD.md, WALKTHROUGH.md
round3/  00_PROJECT.md, AGENT_1..4, BOARD.md, WALKTHROUGH.md, run_round3.ps1
round4/  00_PROJECT.md, AGENT_1..4, BOARD.md, WALKTHROUGH.md, run_round4.ps1
round5/  PROJECT.md, AGENT_1..3, BOARD.md (222 KB - the whole decision record), WALKTHROUGH.md,
         PROMPT_AGENT_1..3_COVERAGE.txt (the ledger cycle), PROMPT_AGENT_1..3_H417.txt (the H417 push)
```

`round1/handover-pack/` is the snapshot the human dropped over `agents/` mid-round-2,
kept only because `ADOPTED.md` in it says the live copy is `agents/` — it is a strict
subset of what is now in `round1/` and is safe to ignore.

The boards are the decision record and are worth grepping rather than reading. A few
things in them are load-bearing and are *not* repeated anywhere else:

- **The environment corrections.** `agents/` claimed for a round that there was no
  `cargo` and no C compiler on this box; both were false, and four agents were reading
  it as ground truth. Then it claimed there was no *host* compiler either, and MinGW
  9.2.0 turned up at `C:\MinGW`. `../README.md` now carries the corrected facts. Two
  wrong-in-the-pessimistic-direction facts cost exactly as much as optimistic ones.
- **CH32X035's shape, ten ways** — round 4's 20:05Z and 16:25Z entries and the two
  QA-FAILs that corrected them. Port C has **two** holes (8–9 and 12–13), not one; the
  part has **45** vectors, not 47, and **no `RCC_IRQn` at all**; the ports are 24-bit;
  there is no HSE; the remaps are 40 named SDK macros; `GPIOMode_TypeDef` has **six**
  members and **no open-drain**.
- **The `_dma_requests` derivation** — `../proposals/CH32X035_dma_requests.yaml` and
  `../proposals/x035_dma_requests.py`. The RM's markdown conversion destroyed Table 9-2
  (rows kept, columns lost); the map was recovered from the original PDF by word
  x-position, cross-checked three ways, all three agreeing on all 27 requests.
- **`WCH-DUMMY32-C8`'s reason to exist** — it was moved out of `data/mcus/` in round 5.
  It is still the only fixture that reaches LQFP100/LQFP144, has three GPIO speeds, uses
  a different NVIC priority scheme, and spells the HSE pins `OSC_IN`/`OSC_OUT`.
