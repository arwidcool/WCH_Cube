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
**Do not run the full suite on a loop.** `node tests/run.js` is ~6.5 minutes and is the gate for
a **commit**, not a step after every edit. While working, run the narrow thing —
`node tests/run.js "<pattern>"`, `validate_mcu.py`, a `*_selftest.py`. Run `python build.py`
only when `app/**` or `data/**` changed; a markdown, `tools/`, `tests/` or `agents/` edit does
not reach `dist/index.html`. On a shared tree a needless rebuild also makes **another** agent's
run report failures that are not real. If a full run goes red, re-run the failing suites by name
before believing them.

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
