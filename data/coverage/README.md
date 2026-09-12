# `data/coverage/` — the coverage ledger, one file per part

`docs/COVERAGE.md` is the rule, the schema and the loop. This folder holds:

| File | What it is | Who edits it |
|---|---|---|
| `<PART>.yaml` | the part's **declarations**: where its sources are, how the datasheet's vocabulary maps onto the file's signal names (`aliases:`), what the silicon has that the file will never model and why (`absent:`), where the datasheet's two readings differ (`disagreements:`), what the conversion tore (`corrections:`), and the part's status with its open-row count | a person or an agent, every entry with a `file:line` |
| `ledger/<PART>.yaml` | the **generated inventory**: every function on every pin, every RM chapter, every SPL instance, each with the line it was read from | nobody — `python tools/ledger.py --write` |

```
python tools/coverage.py CH32L103      # the open rows for one part; exit 1 while any remain
python tools/coverage.py --gate        # every part against its declared status (what the suite runs)
python tools/ledger.py --write         # regenerate ledger/*.yaml after a parser or datasheet change
```

A part with no file here fails `tests/coverage.test.js`. A part whose file says `complete` must
have zero open rows; one that says `in_extraction` must record exactly the count the tool finds,
and that count may only go down.
