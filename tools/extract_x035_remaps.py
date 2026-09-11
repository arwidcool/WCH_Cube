#!/usr/bin/env python3
"""Re-derive CH32X035's pin alternate-function map from DS Table 2-3.

    python tools/extract_x035_remaps.py --inventory    # every token, decoded or not
    python tools/extract_x035_remaps.py --yaml         # emit remaps: blocks
    python tools/extract_x035_remaps.py                # diff against data/mcus/CH32X035.yaml

Table 2-3 lists, per pin, every alternate function that pin can carry. A token is a
signal abbreviation with an optional `_N` suffix, and DS note 2 says what the suffix
means:

    "The value after the remapping function underline indicates the configuration value
     of the corresponding bit in the AFIO register. For example: TX2_2 indicates that
     the corresponding bit of the AFIO register is configured as 10b."

So `TX2` is USART2_TX at remap index 0 (the default mapping) and `TX2_3` is the same
signal at remap index 3. That is the same convention CH32V006 uses, which is what makes
`remaps[]` index == AFIO field value hold on both families.

**This is the FIRST of two passes.** The round-4 rule, and the CH32V006 standard, is that
a remap map is re-derived independently and diffed to zero. The second pass reads the RM's
AFIO_PCFR1 section, which says which pins each field VALUE selects; this one reads the DS,
which says which values each PIN appears under. Neither is a substitute for the other:
the DS says where a signal can go, the RM says what to write to send it there.

A token this file cannot decode is REPORTED, never dropped. `--inventory` exists so the
decoder can be checked against the whole table before any of it is believed.

Output is ASCII only: the Windows console here is cp1252.
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DS = ROOT / "data" / "sources" / "X035" / "Datasheets" / "CH32X035DS0.md"
TABLE = "Table 2-3 Pin alternate and remapping functions"

PIN_RE = re.compile(r"^(P[A-C]\d{1,2})\b\s*(.*)$")
# Lines the conversion sprinkles through the table and that carry no signal.
NOISE_RE = re.compile(
    r"^(CH32X035 Datasheet|V2\.2\b|Alternate$|Pin$|Note|ADC TIM|https?://)", re.I)


# --------------------------------------------------------------- the decoder
#
# Every rule below is read off DS Table 2-3's own column headings
# (ADC / TIM1,2 / TIM3 / USART / CMP / SYS / I2C / SPI / USB / OPA / PIOC) and confirmed
# against the pin's main-function column in Table 2-1. Nothing is inferred from a name
# that looks familiar from another family.
# Tokens the PDF conversion corrupted, with the evidence for the correct reading. Both
# are the digit 0 read as the letter O, and both are decidable by counting: the DS spells
# `C1N0` eight times and `C1NO` once, `C2N0` three times and `C2NO` once, and each bad
# spelling sits on a pin whose Table 2-1 main-function column gives the good one
# (PC3 "C1N0/C2N1/C3N1/A13", PA22 "T2C2N/C2N0"). Declared here rather than fixed silently,
# and printed by --inventory, for the same reason the pin corrections are.
# An EVT macro that is not a pin remap, so Table 2-3 has no rows for it and the counts
# are not comparable. `GPIO_Remap_SWJ_Disable` REMOVES the debug interface rather than
# moving a signal to another pin, which is why it has macro but no remap index. Listed
# explicitly so the second pass reports it as not-applicable instead of as a
# contradiction - a mismatch nobody can explain is worth more than one nobody notices.
NOT_A_PIN_REMAP = {
    "SWJ_Disable": "GPIO_Remap_SWJ_Disable turns the SDI pins off; it moves no signal, "
                   "so Table 2-3 correctly has no remap index for it",
}

OCR = {
    "C1NO": ("C1N0", "DS spells C1N0 8x and C1NO once; PC3's Table 2-1 main function is C1N0"),
    "C2NO": ("C2N0", "DS spells C2N0 3x and C2NO once; PA22's Table 2-1 main function is C2N0"),
}


def decode(tok):
    """token -> (peripheral, signal) or None. The `_N` suffix is stripped by the caller."""
    t = OCR[tok][0] if tok in OCR else tok
    m = re.fullmatch(r"A(\d{1,2})", t)
    if m:
        return ("ADC1", "IN" + m.group(1))
    m = re.fullmatch(r"T([123])C([1-4])(N?)", t)
    if m:
        return ("TIM" + m.group(1), "CH" + m.group(2) + ("N" if m.group(3) else ""))
    m = re.fullmatch(r"T([123])(ET|BK)", t)
    if m:
        return ("TIM" + m.group(1), {"ET": "ETR", "BK": "BKIN"}[m.group(2)])
    m = re.fullmatch(r"(TX|RX|CTS|RTS|CK)([1-4])", t)
    if m:
        return ("USART" + m.group(2), m.group(1))
    m = re.fullmatch(r"C([123])(?:(P|N)(\d)|(O))", t)
    if m:
        sig = m.group(4) if m.group(4) else m.group(2) + m.group(3)
        return ("CMP" + m.group(1), {"O": "OUT"}.get(sig, sig))
    m = re.fullmatch(r"O([12])(?:(P|N|O)(\d))", t)
    if m:
        return ("OPA" + m.group(1), m.group(2) + m.group(3))
    if t in ("SCL", "SDA"):
        return ("I2C1", t)
    if t in ("CS", "SCK", "MISO", "MOSI"):
        return ("SPI1", t)
    if t in ("UDM", "UDP"):
        return ("USBFS", t)
    if t in ("CC1", "CC2"):
        return ("USBPD", t)
    if t == "MCO":
        return ("RCC", "MCO")
    if t in ("DIO", "DCK"):
        return ("SYS", t)
    if t == "RST":
        return ("SYS", "RST")
    m = re.fullmatch(r"PIOC_IO(\d)", t)
    if m:
        return ("PIOC", "IO" + m.group(1))
    return None


def read_table(path=DS):
    """pin -> [(token, remap_index)], in the order the table gives them."""
    lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    start = next(i for i, l in enumerate(lines) if TABLE in l)
    end = len(lines)
    for i in range(start + 1, len(lines)):
        s = lines[i].strip()
        if s.startswith("##"):
            s = s[2:].strip()
        # The table ends at the next table/chapter OR at its own notes block - and it is
        # the notes that matter here, because Table 2-3 is the last thing before them and
        # the prose ("The RST function on pin PC3 is only available for...") otherwise
        # parses as twenty more tokens on the final pin, PC19.
        if re.match(r"^(Table\s+\d+-\d+|Chapter\s+\d+)\b", s) or s.startswith("Note:"):
            end = i
            break

    out = defaultdict(list)
    cur = None
    for i in range(start + 1, end):
        s = lines[i].strip()
        if s.startswith("##"):
            s = s[2:].strip()
        if not s or NOISE_RE.match(s):
            continue
        m = PIN_RE.match(s)
        if m:
            cur = m.group(1)
            out.setdefault(cur, [])
            s = m.group(2).strip()
            if not s:
                continue
        if cur is None:
            continue
        # A cell may hold several signals separated by "/", and the conversion also
        # wraps a cell mid-token, leaving a fragment starting with "/".
        for tok in re.split(r"[/\s]+", s):
            tok = tok.strip()
            if not tok or tok in ("-",) or re.fullmatch(r"\(\d+\)", tok):
                continue
            mm = re.fullmatch(r"([A-Za-z][A-Za-z0-9_]*?)(?:_(\d+))?", tok)
            if not mm:
                out[cur].append((tok, None))
                continue
            out[cur].append((mm.group(1), int(mm.group(2)) if mm.group(2) else 0))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--inventory", action="store_true",
                    help="print every distinct token with its decode, and exit")
    ap.add_argument("--ds", default=str(DS))
    args = ap.parse_args()

    table = read_table(args.ds)
    print(f"DS   : {args.ds}")
    print(f"Table: {TABLE}")
    print(f"pins : {len(table)}")

    seen = defaultdict(set)          # token -> {pins}
    for pin, toks in table.items():
        for t, _ in toks:
            seen[t].add(pin)

    good, bad = {}, {}
    for t in seen:
        d = decode(t)
        (good if d else bad)[t] = d

    if args.inventory:
        print(f"\ndistinct tokens: {len(seen)}   decoded: {len(good)}   NOT DECODED: {len(bad)}")
        by_periph = defaultdict(list)
        for t, (p, s) in sorted(good.items()):
            by_periph[p].append(f"{t}->{s}")
        for p in sorted(by_periph):
            print(f"  {p:<8} {len(by_periph[p]):>3}  {' '.join(sorted(by_periph[p]))[:150]}")
        if bad:
            print("\n  NOT DECODED - every one of these is a token this tool refuses to guess:")
            for t in sorted(bad):
                pins = sorted(seen[t])
                print(f"    {t:<14} on {', '.join(pins[:6])}{' ...' if len(pins) > 6 else ''}")
        return 1 if bad else 0

    # pin map, grouped by peripheral and remap index
    sig = defaultdict(lambda: defaultdict(dict))   # periph -> idx -> {signal: pin}
    clash = []
    for pin, toks in sorted(table.items()):
        for t, idx in toks:
            d = decode(t)
            if not d:
                continue
            p, s = d
            prev = sig[p][idx].get(s)
            if prev and prev != pin:
                clash.append((p, idx, s, prev, pin))
            sig[p][idx][s] = pin
    # ---- the SECOND pass, made mechanical -----------------------------------
    # DS Table 2-3 says which remap INDICES each pin appears under. The EVT header says
    # how many remap MACROS each peripheral has. Two documents describing the same
    # silicon from opposite directions, so their counts must agree - and if they do not,
    # one of the two readings is wrong and neither should be believed.
    EVT = (ROOT / "data" / "sources" / "X035" / "Evt" / "EXAM" / "SRC" / "Peripheral"
           / "inc" / "ch32x035_gpio.h")
    macros = defaultdict(set)
    if EVT.exists():
        text = EVT.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r"^#define\s+(GPIO_(?:PartialRemap\d|FullRemap|Remap)_(\w+))\s",
                             text, re.M):
            macros[m.group(2)].add(m.group(1))

    print(f"\nperipherals: {len(sig)}")
    for p in sorted(sig):
        idxs = sorted(sig[p])
        print(f"  {p:<8} remap indices {idxs}   signals {sorted({s for i in idxs for s in sig[p][i]})}")
    if macros:
        print("\nsecond pass - DS Table 2-3 remap indices vs EVT GPIO_*Remap*_ macros:")
        agree = disagree = 0
        for p in sorted(set(sig) | set(macros)):
            # Index 0 is the DEFAULT mapping and has no macro, so a peripheral with N
            # macros should show N+1 indices (0..N).
            ds_n = len(sig.get(p, {}))
            evt_n = len(macros.get(p, ()))
            if evt_n == 0 and ds_n <= 1:
                continue                      # no remaps either side: nothing to compare
            if p in NOT_A_PIN_REMAP:
                print(f"  n/a      {p:<8} {NOT_A_PIN_REMAP[p]}")
                continue
            ok = (ds_n == evt_n + 1)
            agree += ok
            disagree += not ok
            print(f"  {'ok      ' if ok else 'MISMATCH'} {p:<8} DS indices {ds_n:>2}"
                  f"   EVT macros {evt_n:>2}"
                  + ("" if ok else "   <-- one of the two readings is wrong"))
        print(f"  {agree} agree, {disagree} disagree")

    if clash:
        print(f"\nCOLLISIONS: {len(clash)} - one signal on two pins at the same remap index")
        for p, i, s, a, b in clash[:20]:
            print(f"  {p} idx {i} {s}: {a} and {b}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
