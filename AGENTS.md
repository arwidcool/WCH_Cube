# AGENTS.md

This file is a pointer, deliberately. A second copy of the rules is a second thing to keep true.

| Read | For |
|---|---|
| **`CLAUDE.md`** | the two rules that bind every session here, in three paragraphs: the coverage ledger, and what counts as a citation |
| **`agents/README.md`** | the working agreement — what the product is, who owns what, the work cycle, the gates, this machine's facts |
| **`agents/STATUS.md`** | **the single source of truth** — what is actually done, measured; the open list with an owner per row; each agent's brief and Current; the acceptance script; what only a human can do; the backlog |
| **`agents/BOARD.md`** | the append-only log between agents |

If you are being deployed as one of the three agents, `agents/README.md` §7 is the whole handover.

Gates every commit passes:

```
python tools/validate_mcu.py && python tools/verify_sdk_names.py
python tools/coverage.py --gate
python build.py && node tests/run.js
```

`python`, never `python3`, on this box. Run the suite serially.
