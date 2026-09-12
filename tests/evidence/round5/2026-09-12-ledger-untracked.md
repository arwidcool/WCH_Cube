# Round 5 — the coverage ledger is untracked, so the ratchet has no history

**Date:** 2026-09-12 · **By:** AGENT-3 · **Found while:** P0.1 of `PROMPT_AGENT_3_COVERAGE.txt`,
whose first instruction is to read `git log -p -- data/coverage/`.

## What P0.1 asks for, and why it could not be done

> Every cycle, read `git log -p -- data/coverage/` since your last cycle. A diff that RAISES any
> `open_rows:` is a defect.

That command returns **nothing**, and it is not because the ledger is unchanged:

```
$ git log --oneline -12 -- data/coverage/
$                                   # empty

$ git status --short data/coverage/
?? data/coverage/

$ git ls-files data/coverage/
$                                   # empty - not one file is tracked

$ git cat-file -e HEAD:data/coverage/CH32V006.yaml
fatal: path 'data/coverage/CH32V006.yaml' exists on disk, but not in 'HEAD'
```

The six coverage files and the six generated ledgers exist on disk and are **not in git**, and
they are **not gitignored** (`.gitignore` holds `data/Pio Source/` and nothing else). So:

* the ratchet has **no history** — `open_rows:` can be raised by anyone, at any time, and no diff
  records it. That is the one thing P0 exists to prevent.
* the review instruction ("a diff that raises the number is a defect") is **unrunnable**.
* every other agent's cycle instruction to read `docs/COVERAGE.md` first leads to a file that a
  fresh clone does not have.

## What a fresh clone therefore sees

`git clone` produces a tree with no `data/coverage/` at all. Simulated by moving one coverage
file aside and running the gate, then restoring it:

```
$ mv data/coverage/CH32V006.yaml aside && python tools/coverage.py --gate --json
exit code: 2
errors reported:
   CH32V006: no coverage file at data/coverage/CH32V006.yaml - every real part needs one
             (docs/COVERAGE.md says what goes in it)
parts present: ['CH32H417', 'CH32L103', 'CH32V003', 'CH32V005', 'CH32X035']

$ python tools/coverage.py --gate          # the human-readable form, i.e. the CI step
exit code: 2
coverage: CH32V006: CANNOT READ - CH32V006: no coverage file at data/coverage/CH32V006.yaml
  PASS  CH32H417   in_extraction (AGENT-1), 113 open, tracked
  PASS  CH32L103   in_extraction (AGENT-1), 33 open, tracked
  PASS  CH32V003   in_extraction (AGENT-1), 3 open, tracked
  PASS  CH32V005   complete, 0 open
  PASS  CH32X035   complete, 0 open
```

Two things to read from that, and the second is the good news:

1. **Exit 2, named, no green tick.** The tool does exactly what `docs/COVERAGE.md` says it does
   with a missing coverage file — "exit 2, named, never a green tick". So this is not a tool bug.
   It is the gate refusing to pass on silence, which is the behaviour we want.
2. **It fires per part, and the others still report.** A clone missing every coverage file gets
   six `CANNOT READ` lines; the failure names the part rather than collapsing into one blanket
   message (`P0.4`'s requirement, holding under a failure the tool was not designed around).

The consequence on CI: `.github/workflows/ci.yml` line 82 runs exactly that command as the
**"Coverage ledger - every part meets its declared status"** step, on `ubuntu-latest`, from a
fresh `actions/checkout@v4`. On a clone with no `data/coverage/`, that step exits 2 and the
`build + tests` job fails. `tests/coverage.test.js`'s first test would fail with it, and every
per-part test would fail on `git ls-files`-less data.

## The fix, and the guard that keeps it fixed

**Committed `data/coverage/`** (the six `*.yaml`, the six ledgers, `README.md`). That is an
addition, not an edit: not one byte of a coverage file changed.

**And a test, because a convention is not a ratchet.** `tests/coverage.test.js` now asserts that
every shipped part's coverage file and its generated ledger are **tracked by git**, and that the
directory is not ignored. Proven red by moving a coverage file out of the index (not off disk) —
see the second half of this file.

## Why this is the first thing in the cycle rather than a footnote

`PROMPT_AGENT_3_COVERAGE.txt` P0 is titled *"the ratchet cannot be talked down"*, and the
instructions that follow all assume the ratchet is written down somewhere that can be compared.
It was not. An untracked ledger is not a weaker ratchet than a tracked one — it is **no ratchet**,
wearing a `status: complete` badge, with a gate that would have caught the problem on the first
CI run and had not yet been given the chance.

That is the same shape as the defect class this whole round is about: silence that reads exactly
like a working thing. `CH32H417`'s 207 dead pads passed every gate because nothing read the
datasheet. This passed every gate because nothing read **git**.
