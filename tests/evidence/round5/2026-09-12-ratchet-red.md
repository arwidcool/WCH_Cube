# Round 5 — `node tests/run.js coverage` seen red, four ways

**Date:** 2026-09-12 · **By:** AGENT-3 · **Command under test:**
`node tests/run.js coverage` → `tests/coverage.test.js`, the gate that holds every part to the
status its `data/coverage/<PART>.yaml` declares.

P0.3 of the round-5 coverage brief: *"Show the gate red once yourself: raise `open_rows:` on one
part by hand, run `node tests/run.js coverage`, watch it fail with the part named and the sentence
'lower it' / 'REGRESSION', restore the file."* A gate nobody has seen go red is not a gate.

Planted on **`data/coverage/CH32V003.yaml`** — `status: in_extraction`, `owner: AGENT-1`,
`open_rows: 3` — one edit at a time, each restored from a byte copy in a `finally` block, with a
final unmutated run confirming the tree went back to green.

## 1. Raise the recorded count (the ratchet's own reason to exist)

`open_rows: 3` → `open_rows: 4`.

```
$ node tests/run.js coverage
FAIL  coverage ledger › CH32V003: meets the coverage status its ledger declares
      CH32V003 (in_extraction, AGENT-1): 3 open rows but open_rows: 4 - lower it to 3 (the
      count may only go down, and it must be current)
            run: python tools/coverage.py CH32V003
1 FAILED, 10 passed, 579 filtered out
x tests/coverage.test.js  coverage ledger › CH32V003: meets the coverage status its ledger declares
```

**The part is named** (`CH32V003`, with its owner and status), the tool's own sentence is quoted
verbatim, and the recovery command is printed. Note which direction raised the failure: `open_rows:`
above what the tool counts is reported as *"lower it"*, and it is the **most damaging** shape —
`REGRESSION:` is reserved for the case below, which is the direction that means the count is being
held up by an edit that was never made.

## 2. Lower the recorded count below what the tool counts

`open_rows: 3` → `open_rows: 1`. This is the regression the ratchet exists to catch: rows opened
or re-opened since the number was written.

```
$ node tests/run.js coverage
FAIL  coverage ledger › CH32V003: meets the coverage status its ledger declares
      CH32V003 (in_extraction, AGENT-1): REGRESSION: 3 open rows, 1 recorded - 2 new gap(s) were
      introduced; close them, do not raise the number
            run: python tools/coverage.py CH32V003
1 FAILED, 10 passed, 579 filtered out
```

Both directions fail, and the two sentences are distinct — a gate that used one message for both
would let a reviewer read "count changed" as "no problem".

## 3. Flip `status: in_extraction` → `status: complete` with rows still open

This is the second half of P0.1: *"A diff that flips `status: in_extraction` to `complete` must come
with the tool printing 0 for that part — run it, quote it."*

```
$ node tests/run.js coverage
FAIL  coverage ledger › CH32V003: meets the coverage status its ledger declares
      CH32V003 (complete, AGENT-1): declared complete but 3 row(s) are OPEN
            run: python tools/coverage.py CH32V003
```

Read literally: **the tool printed 3, not 0, and the claim was refused by name.** That is the
sentence a reviewer should expect in the diff message of anyone flipping that field.

## 4. The gate's own summary — "5 of 6"

In the same session the working tree went red once for a reason that was **not** a plant:
`coverage gate: 5 of 6 part(s) meet their declared status`, with `CH32L103` listed as failing and
its open rows printed (`CMP2_N0`, `CMP3_N0`, `CMP3_OUT0` …). That is AGENT-1 mid-extraction on
their own declared part, on a shared tree, and it is recorded here because it is the honest
baseline this evidence was captured against: a green run is not always available, and the failure
that is present must be attributable.

## What the four runs establish

| Shape of the lie | Caught | Named part | Sentence |
|---|---|---|---|
| `open_rows:` raised above the truth | yes | yes | *"lower it to N (the count may only go down, and it must be current)"* |
| `open_rows:` lowered below the truth | yes | yes | *"REGRESSION: N open rows, M recorded — X new gap(s) were introduced; close them, do not raise the number"* |
| `complete` claimed with rows open | yes | yes | *"declared complete but N row(s) are OPEN"* |
| a part failing the gate legitimately | yes | yes | the open rows are printed with the command to read them |

Every one names the part in the **summary line** as well as the detail, which is P0.4's
requirement — the per-part test name *is* the summary, so a reader who sees only the last three
lines still sees which part failed.

## The gap this evidence does NOT close

None of the four is a test. They are a record that the machinery behind `tests/coverage.test.js`
fails in the right direction. The **planted-break test** covering the same ground as a standing
assertion is `tools/coverage_selftest.py` (21 breaks, 21 caught, run on every suite), and it is
named in the brief as the half that must stay honest. What this file adds is the part a self-test
cannot show: that the *suite* — not just the library — reports it, in the wording a reader will
actually see.
