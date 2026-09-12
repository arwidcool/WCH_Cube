# WCH_CubeMX — read this first

You are working in a repository whose whole product is **hardware facts extracted from vendor
documents into `data/mcus/<PART>.yaml`**, and whose recorded failure mode is an agent that ships
a plausible, internally consistent file with pins missing and peripherals that are only a name.
Two rules bind every session here, before anything else you read:

## 1. A part is not done while the coverage ledger has an open row

`docs/COVERAGE.md` is the process. The short form:

```
python tools/coverage.py <PART>      # every OPEN row, with the datasheet line to read; exit 1 while any remain
```

Every function the datasheet puts on a pin, every reference-manual chapter and every SPL instance
is a ledger row. A row is **modelled** by a named signal, **absent** with a `file:line` in
`data/coverage/<PART>.yaml`, or **OPEN**. Take the first open row, open the cited line, model it
or declare it, run the tool again. Zero open rows plus the ordinary gates is the definition of
done; anything else is `status: in_extraction` with an owner, a `TASKS.md` line and an
`open_rows:` count that may only go down. Never report a part as complete while the tool prints an
open row, and never patch `data/mcus/*.yaml` with an ad-hoc script — model it or declare it.

A peripheral that routes nothing must declare `pins: { none: true, source: ... }` (the silicon
gives it no pad; the tool checks that against the datasheet) or `pins: { open: true, owner: ...,
task: ... }`. `validate_mcu.py` rejects silence, and rejects a signal routed to a pin that no
setting's choice can claim.

## 2. A citation is a `file:line` or a table number, never a family

Read `data/sources/<PART>/Datasheets/*.md` first; the PDF is the last resort and only by a script
that says why. EVT headers outrank the reference manual, which outranks the datasheet. Where two
sources disagree, record both, average neither. "The other CH32 parts have it" is not a source.

## The rest, in the order to read it

| Read | For |
|---|---|
| `docs/COVERAGE.md` | the ledger: the seven checks, the two files per part, the loop, the definition of done |
| `agents/README.md` | the working agreement if you are one of the agents: ownership, work cycle, gates |
| `agents/PROJECT.md` | the current round's brief |
| `docs/ADDING-A-PART.md` | the whole process of adding a microcontroller |
| `data/FORMAT.md` | the MCU file schema; `tools/validate_mcu.py` is the authority when they disagree |
| `PROGRESS.md` | where the project actually stands, including each part's open count |

## Gates every commit passes

```
python tools/validate_mcu.py && python tools/verify_sdk_names.py     # data: consistent, and names that exist
python tools/coverage.py --gate                                      # data: complete, or honestly counted
python build.py && node tests/run.js                                 # everything, ALL GREEN, no unexplained skips
```

`python`, never `python3`, on this box. Run the suite serially: two at once corrupt each other.
Never hand-edit `dist/index.html`; never edit `data/firmware/lib/wchcube_generated/`; never delete
a data file or a test; never lower a threshold to make something pass.
