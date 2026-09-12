#!/usr/bin/env python3
"""coverage_selftest.py -- plant a break in every coverage check and require it to be caught.

    python tools/coverage_selftest.py            # exit 0 = every planted break caught

A check that cannot fail is worth nothing, and this repository has found that three times
(a validator that passed `ch32v00x.h`, a compile gate nobody compiled, a constraint schema
two halves of the tree spelled differently). So: the unmutated CH32V006 must come out CLEAN
first - 0 validator errors, 0 open ledger rows - and then each break below is planted in a
deep copy and the exact row or error it must produce is asserted by name. A self-test that
fires on everything would fail the clean run, and one that fires on nothing fails a plant.

The breaks cover the two validator checks added for the ledger (docs/COVERAGE.md), every
row kind the ledger reports, and the gate's three ways of saying no.

Output is ASCII only: the Windows console here is cp1252.
"""
from __future__ import annotations

import copy
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import coverage_lib as C  # noqa: E402
import validate_mcu as V  # noqa: E402

PART = "CH32V006"


def validator_errors(doc: dict) -> list[str]:
    r = V.Report(pathlib.Path("selftest.yaml"))
    V.check_peripherals(doc, r)
    return r.errors


def open_rows(doc: dict, cov: dict) -> list[C.Row]:
    return C.build(PART, cov=cov, doc=doc).open


def main() -> int:
    doc0 = C.load_mcu(PART)
    cov0 = C.load_coverage(PART)

    # ---- the clean run first
    errs = validator_errors(doc0)
    if errs:
        print("SELFTEST INVALID: the unmutated part has validator errors:\n  " + "\n  ".join(errs[:5]))
        return 2
    res0 = C.build(PART, cov=cov0, doc=doc0)
    if res0.open:
        print(f"SELFTEST INVALID: the unmutated part has {len(res0.open)} open ledger row(s):")
        for r in res0.open[:5]:
            print(C.safe(f"  {r.kind} {r.key}: {r.detail}"))
        return 2
    ok0, _ = C.verdict(res0)
    if not ok0:
        print("SELFTEST INVALID: the unmutated part does not pass the gate")
        return 2
    print(f"  clean: {PART} validates and has 0 open rows, {res0.count('modelled')} modelled")

    plants: list[tuple[str, callable]] = []

    # ---------------------------------------------------------------- validator
    def p_dead_pin():
        d = copy.deepcopy(doc0)
        for s in d["peripherals"]["USART1"]["settings"]:
            for c in s["choices"]:
                if "signals" in c:
                    c["signals"] = [x for x in c["signals"] if x != "TX"]
        return any("dead pin" in e and "`TX`" in e for e in validator_errors(d))
    plants.append(("validator: a routed signal no choice claims", p_dead_pin))

    def p_silent_periph():
        d = copy.deepcopy(doc0)
        del d["peripherals"]["IWDG"]["pins"]
        return any("declares nothing" in e and "IWDG" in e for e in validator_errors(d))
    plants.append(("validator: a routing-less peripheral with no `pins:` declaration", p_silent_periph))

    def p_none_without_source():
        d = copy.deepcopy(doc0)
        d["peripherals"]["IWDG"]["pins"] = {"none": True}
        return any("needs a `source:`" in e for e in validator_errors(d))
    plants.append(("validator: `pins: none` with no source", p_none_without_source))

    def p_open_without_owner():
        d = copy.deepcopy(doc0)
        d["peripherals"]["IWDG"]["pins"] = {"open": True}
        return any("needs `owner:` and `task:`" in e for e in validator_errors(d))
    plants.append(("validator: `pins: open` with no owner or task", p_open_without_owner))

    def p_decl_on_routed():
        d = copy.deepcopy(doc0)
        d["peripherals"]["USART1"]["pins"] = {"none": True, "source": "x"}
        return any("this peripheral routes signals" in e for e in validator_errors(d))
    plants.append(("validator: a `pins:` declaration on a peripheral that routes", p_decl_on_routed))

    # ---------------------------------------------------------------- ledger rows
    def p_ds_function_unrouted():
        d = copy.deepcopy(doc0)
        del d["peripherals"]["SPI1"]
        rows = open_rows(d, cov0)
        return any(r.kind == "pin" and "SPI_MISO" in r.key for r in rows) \
            and any(r.kind == "chapter" and r.key.startswith("16 ") for r in rows)
    plants.append(("ledger: a DS function the file stops routing, and its chapter", p_ds_function_unrouted))

    def p_wrong_pin():
        d = copy.deepcopy(doc0)
        rm = d["peripherals"]["I2C1"]["remaps"][0]["pins"]
        rm["SCL"], rm["SDA"] = rm["SDA"], rm["SCL"]          # swap the two pins
        rows = open_rows(d, cov0)
        return any(r.kind == "routing" and r.key.startswith("I2C1_SCL") for r in rows)
    plants.append(("ledger: a signal routed to the wrong pin", p_wrong_pin))

    def p_none_contradicted():
        d = copy.deepcopy(doc0)
        P = d["peripherals"]["I2C1"]
        P.pop("remaps", None)
        for s in P.get("settings") or []:
            for c in s["choices"]:
                c.pop("signals", None)
        P["pins"] = {"none": True, "source": "a claim the datasheet contradicts"}
        rows = open_rows(d, cov0)
        return any(r.kind == "periph" and r.key == "I2C1" and "declares `pins: none` but the DS lists" in r.detail
                   for r in rows)
    plants.append(("ledger: `pins: none` on a peripheral the datasheet gives pads", p_none_contradicted))

    def p_open_declared():
        d = copy.deepcopy(doc0)
        d["peripherals"]["IWDG"]["pins"] = {"open": True, "owner": "AGENT-1", "task": "x"}
        rows = open_rows(d, cov0)
        return any(r.kind == "periph" and r.key == "IWDG" and "declared `pins: open`" in r.detail for r in rows)
    plants.append(("ledger: a `pins: open` declaration is an open row", p_open_declared))

    def p_alias_removed():
        cv = copy.deepcopy(cov0)
        del cv["aliases"]["SWDIO"]
        rows = open_rows(doc0, cv)
        return any(r.kind == "pin" and r.key == "PD1 SWDIO" for r in rows)
    plants.append(("ledger: an alias removed leaves the DS token unresolved", p_alias_removed))

    def p_chapter_unmapped():
        cv = copy.deepcopy(cov0)
        del cv["chapters"][15]
        rows = open_rows(doc0, cv)
        return any(r.kind == "chapter" and r.key.startswith("15 ") for r in rows)
    plants.append(("ledger: an RM chapter mapped to nothing", p_chapter_unmapped))

    def p_chapter_misnamed():
        cv = copy.deepcopy(cov0)
        cv["chapters"][15] = ["I2C9"]
        rows = open_rows(doc0, cv)
        return any(r.kind == "chapter" and "I2C9" in r.detail for r in rows)
    plants.append(("ledger: a chapter mapped to a peripheral the file lacks", p_chapter_misnamed))

    def p_instance_unmapped():
        cv = copy.deepcopy(cov0)
        del cv["instances"]["OPA"]
        rows = open_rows(doc0, cv)
        return any(r.kind == "instance" and r.key == "OPA" for r in rows)
    plants.append(("ledger: an SPL instance mapped to nothing", p_instance_unmapped))

    def p_dead_declaration():
        cv = copy.deepcopy(cov0)
        cv["absent"] = list(cv.get("absent") or []) + [
            {"token": "NOSUCHTOKEN", "reason": "a declaration nothing matches", "source": "x"}]
        rows = open_rows(doc0, cv)
        return any(r.kind == "declaration" and "NOSUCHTOKEN" in r.key for r in rows)
    plants.append(("ledger: an `absent:` entry nothing matches is dead, and reported", p_dead_declaration))

    def p_resource_count():
        cv = copy.deepcopy(cov0)
        cv["resources"] = [{"name": "USART", "count": 3, "match": r"^USART\d+$", "source": "x"}]
        rows = open_rows(doc0, cv)
        return any(r.kind == "resource" and "the DS says 3" in r.detail for r in rows)
    plants.append(("ledger: a declared resource count the file does not match", p_resource_count))

    def p_unread_source():
        cv = copy.deepcopy(cov0)
        cv["sources"]["ds"] = "data/sources/V006/Datasheets/does-not-exist.md"
        try:
            C.build(PART, cov=cv, doc=doc0)
        except C.CoverageError as e:
            return "is not a file" in str(e)
        return False
    plants.append(("ledger: a source that cannot be read is an error, never a pass", p_unread_source))

    def p_parse_misses_pins():
        cv = copy.deepcopy(cov0)
        cv["pin_tables"] = cv["pin_tables"][:1]
        cv["pin_tables"][0] = dict(cv["pin_tables"][0], end="## - - - 17 3 PA6")   # cut the table short
        try:
            C.build(PART, cov=cv, doc=doc0)
        except C.CoverageError as e:
            return "found no row for" in str(e)
        return False
    plants.append(("ledger: a parse that cannot see a bonded pin refuses to report", p_parse_misses_pins))

    def p_torn_name_cell():
        # The shape CH32H417's conversion produced for `PC13(4)-RTC` and
        # `PC15(4)-OSC32_OUT`: the pin-NAME cell wrapped mid-name, and the type column
        # (`I/O`, `I/O/A`) landed on the line after it. Read token by token that is the
        # functions `C`, `I`, `O`, `A`, `OSC32_OU` and `T` - half a torn name plus the
        # type column spelled out - and 13 such rows sat open on CH32H417. Read as one
        # cell it is RTC and OSC32_OUT, which is what the silicon has. The dictionary is
        # EMPTY here on purpose: the join must come from the cell boundary, not from
        # `_glue` recognising a name it has seen elsewhere.
        text = "\n".join([
            "Table Z Pin definitions",
            "## - - 8", "## PA1", "## (4)", "## -RT", "## C", "## I/O - PA1", "## (5)", "",
            "## RTC(AF1)", "",
            "## - - 9", "## PA2", "## (4)", "## -", "## OSC32_OU", "## T",
            "## I/O/A - PA2", "## (5)", "",
            "## OSC32_OUT", "",
            "Table Z-end",
        ])
        cfg = {"start": "Table Z Pin definitions", "end": "Table Z-end"}
        rows = C.parse_pin_table(text, cfg, {}, set(), {"PA1", "PA2"}, [])
        got = {r.pin: sorted({f[0] for f in r.funcs}) for r in rows}
        return got == {"PA1": ["RTC"], "PA2": ["OSC32_OUT"]}
    plants.append(("parser: a name cell torn across lines is one name, never the type column",
                   p_torn_name_cell))

    def p_signal_row_no_underscore():
        # The signal-first tables 2-2-x do not put an underscore in every name, and the
        # parser used to require one. A skipped row does not merely go missing: it leaves
        # the reader on the PREVIOUS signal, so its pins are filed under that one. On
        # CH32H417 `SWCLK PB8` and `SWDIO/SWIO PB9` (Table 2-2-10) landed on USART8_CTS,
        # `CC1`/`CC2` (2-2-17) on UHSIF_CLK and `MCO PB0` (2-2-30) on DFSDM_CKOUT - a
        # phantom pad where each one landed AND a missing row where it came from.
        text = "\n".join([
            "Table 2-2-9 USART Pin functions",
            "USART8 function Optional pins",
            "## USART8_CTS PE10(AF11), PF9(AF7)",
            "## Table 2-2-10 Debug Pin Functions",
            "Debug pin function Default pin",
            "## SWCLK PB8",
            "## SWDIO/SWIO PB9",
            "## Chapter 3",
        ])
        got = C.parse_signal_rows(text, {"start": "Table 2-2-9 USART Pin functions",
                                         "end": "## Chapter 3"})
        return (got.get("PB8") == {("SWCLK", None)}
                and got.get("PB9") == {("SWDIO", None), ("SWIO", None)}
                and got.get("PE10") == {("USART8_CTS", 11)}
                and got.get("PF9") == {("USART8_CTS", 7)})
    plants.append(("parser: a signal-first row whose name has no underscore is still a row",
                   p_signal_row_no_underscore))

    def p_disagreement_closes_pin_row():
        # ONE declaration answers BOTH rows a difference between the two readings produces:
        # "the DS puts this function here and the file does not route it there" and "the
        # two readings differ". Closing them separately would need an `absent:` entry
        # beside every `disagreements:` one - and `absent:` wins, so the conflict would be
        # recorded in a file and never printed. The row must come back as `disagreement`,
        # never as `modelled` and never silent.
        d = copy.deepcopy(doc0)
        del d["peripherals"]["SPI1"]
        # `PA1 SPI_SCK_5`: the row KEY carries the remap index the DS writes on the token,
        # the declaration is keyed by the token itself. Naming both here is the point -
        # a declaration keyed by the printed row would never match anything.
        pin, tok, key = "PA1", "SPI_SCK", "PA1 SPI_SCK_5"
        first = next((r for r in open_rows(d, cov0) if r.kind == "pin" and r.key == key), None)
        if first is None:
            return False
        cv = copy.deepcopy(cov0)
        cv["disagreements"] = [{"pin": pin, "token": tok,
                                "reason": "the two readings differ here", "source": "x"}]
        res = C.build(PART, cov=cv, doc=d)
        closed = not any(r.kind == "pin" and r.key == first.key for r in res.open)
        named = any(r.kind == "pin" and r.key == first.key and r.status == "disagreement"
                    for r in res.rows)
        return closed and named
    plants.append(("ledger: a declared disagreement closes the pin row it explains",
                   p_disagreement_closes_pin_row))

    def p_dead_disagreement():
        # ...and one that explains nothing is dead, and reported - the same guard the
        # `absent:` declarations have, now that a disagreement can close a row on its own.
        cv = copy.deepcopy(cov0)
        cv["disagreements"] = [{"pin": "PA0", "token": "NOSUCHTOKEN",
                                "reason": "nothing matches this", "source": "x"}]
        return any(r.kind == "declaration" and "NOSUCHTOKEN" in r.key
                   for r in open_rows(doc0, cv))
    plants.append(("ledger: a `disagreements:` entry nothing matches is dead, and reported",
                   p_dead_disagreement))

    # ---------------------------------------------------------------- the gate
    def p_gate_complete_with_open():
        cv = copy.deepcopy(cov0)
        del cv["aliases"]["SWDIO"]
        ok, msg = C.verdict(C.build(PART, cov=cv, doc=doc0))
        return not ok and "declared complete" in msg
    plants.append(("gate: a `complete` part with an open row fails", p_gate_complete_with_open))

    def p_gate_stale_count():
        cv = copy.deepcopy(cov0)
        cv.update({"status": "in_extraction", "owner": "AGENT-1", "open_rows": 5,
                   "task": "CH32L103: close the coverage ledger"})
        ok, msg = C.verdict(C.build(PART, cov=cv, doc=doc0))
        return not ok and "lower it" in msg
    plants.append(("gate: an in_extraction count above what the tool finds must be lowered", p_gate_stale_count))

    def p_gate_regression():
        cv = copy.deepcopy(cov0)
        del cv["aliases"]["SWDIO"]
        cv.update({"status": "in_extraction", "owner": "AGENT-1", "open_rows": 0,
                   "task": "CH32L103: close the coverage ledger"})
        ok, msg = C.verdict(C.build(PART, cov=cv, doc=doc0))
        return not ok and "REGRESSION" in msg
    plants.append(("gate: new open rows above the recorded count are a regression", p_gate_regression))

    def p_gate_no_task():
        cv = copy.deepcopy(cov0)
        cv.update({"status": "in_extraction", "owner": "AGENT-1", "open_rows": 0,
                   "task": "a task line that is in nobody's backlog"})
        ok, msg = C.verdict(C.build(PART, cov=cv, doc=doc0))
        return not ok and "TASKS.md" in msg
    plants.append(("gate: an in_extraction part whose task is not in TASKS.md fails", p_gate_no_task))

    # ---------------------------------------------------------------- run them
    caught = 0
    for name, fn in plants:
        try:
            hit = bool(fn())
        except Exception as e:          # a crash is not a catch
            hit = False
            print(C.safe(f"  CRASH {name}: {e!r}"))
        print(C.safe(f"  {'OK  ' if hit else 'MISS'} {name}"))
        caught += hit
    print(f"\n{caught}/{len(plants)} planted breaks caught")
    return 0 if caught == len(plants) else 1


if __name__ == "__main__":
    sys.exit(main())
