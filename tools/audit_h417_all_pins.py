#!/usr/bin/env python3
"""Sweep EVERY pin of the CH32H417 pin table against the YAML, and report mismatches.

WHY. The DAC was modelled as "holds no pin on any package" while the datasheet lists
`DAC1_OUT` on PA4 and `DAC2_OUT` on PA5 as the pins' own analog functions - a
peripheral that offers "Output on pin" with no pin to output on. That is the round's
defect class in its purest form: a choice the app offers and the silicon cannot
honour. The question this answers is whether the DAC is the only one.

HOW. It reads the DS pin table INDEPENDENTLY of however the YAML was written - the
row token stream, the same way tools/extract_l103_pins.py reads L103 - and builds
`pin -> [functions]` where a function is either an AF entry (`SPI1_NSS(AF5)`) or a
bare analog function (`ADC_IN4`, `DAC1_OUT`, `OPA3_OUT1`). Then it compares:

  1. every pin the DS gives a function to, against the pins the YAML's peripherals
     claim - a DS function whose peripheral is modelled but whose pin is not in that
     peripheral's `signal_pins`/`remaps` is a MISSING PIN;
  2. every peripheral the YAML says holds no pin, against the DS - if the DS gives it
     any function at all, the "holds no pin" note is false;
  3. every `signal_pins` entry in the YAML, against the DS - a pin the YAML claims
     that the DS does not list for that signal is a WRONG PIN.

It reports; it does not edit. The point is to make the answer checkable rather than
to make the file look right.

Usage:
    python tools/audit_h417_all_pins.py                # the sweep
    python tools/audit_h417_all_pins.py --json         # machine-readable
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DS = ROOT / 'data/sources/H417/Datasheets/CH32H417DS0.md'
YAML = ROOT / 'data/mcus/CH32H417.yaml'

TABLE_START = 'Table 2-1-1'
TABLE_END = 'Table 2-1-2'

# A pin name, possibly with the `I/O` type on a LATER line - the conversion splits
# rows (`PE3` / `I/O/` / `SDP` / `- PE3` / `SERDES_TXP/...`), so the row has to be
# found on the token stream rather than line by line. Matching `Pxx ... I/O` on one
# line (which this did first) silently attached PE3's functions to PE2 and made
# SERDES look like it lived on the wrong pin.
PIN_NAME = re.compile(r'^P[A-F]\d{1,2}$')
AF_ENTRY = re.compile(r'^([A-Za-z][A-Za-z0-9_]*)\s*\(AF(\d+)\)$')
BARE_FUNC = re.compile(r'^[A-Z][A-Z0-9_]*$')

# Tokens that are the table's own furniture rather than a function.
SKIP = {'I/O', 'I/O/A', 'P', 'FT', 'SDP', 'A', '-', 'Pin', 'name', 'type', 'No.'}


def table_lines():
    lines = DS.read_text(encoding='utf-8', errors='replace').splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith(TABLE_START))
    end = next(i for i, l in enumerate(lines) if l.startswith(TABLE_END))
    return lines[start:end]


def is_noise(l):
    s = l.strip()
    return (not s or 'wch-ic.com' in s or s.startswith('CH32H417')
            or re.match(r'^#+\s*V\d', s) or re.match(r'^#+\s*Pin', s))


def tokens():
    out = []
    for raw in table_lines():
        if is_noise(raw):
            continue
        s = raw.strip()[2:].strip() if raw.strip().startswith('##') else raw.strip()
        for t in re.split(r'\s+', s):
            t = t.strip()
            if t:
                out.append(t)
    return out


def parse_pins():
    """pin -> {'af': {signal: af}, 'analog': [function]} from the DS pin table.

    An anchor is a `Pxx` token followed within the next three tokens by an `I/O`
    type token, which is what a datasheet row's name column looks like however the
    conversion split it. Everything up to the next anchor belongs to that pin.

    The type token is matched with `startswith('I/O')`, and both halves of that matter.
    The conversion writes `I/O/` in many rows, and it writes `I/O/A` for every pin that
    can also carry an analog function - which is where DAC1_OUT, ADC_IN<n> and the OPA
    inputs live. Testing for exactly `I/O` (as this did) matched 58 of the 95 pins,
    then 62 after stripping a trailing slash, and in both cases the pins it dropped
    were the ANALOG ones - so the sweep reported that the DAC had no pin, which is the
    very defect it exists to find. 95 is the number to expect: the datasheet's own
    QFN128 I/O count.
    """
    toks = tokens()
    anchors = []
    for i, t in enumerate(toks):
        if not PIN_NAME.match(t):
            continue
        # Look ahead for the type token, but stop at another pin name: that would mean
        # this one is a FUNCTION on the previous row, not a row of its own (every row
        # names its own pin again in the function column).
        for x in toks[i + 1:i + 7]:
            if PIN_NAME.match(x):
                break
            if x.startswith('I/O'):
                anchors.append(i)
                break
    # a pin can appear more than once (a second row for a package-specific function);
    # merge rather than keep the first, which is what the datasheet means by them.
    out = {}
    for k, a in enumerate(anchors):
        end = anchors[k + 1] if k + 1 < len(anchors) else len(toks)
        pin = toks[a]
        rec = out.setdefault(pin, {'af': {}, 'analog': []})
        for t in toks[a + 1:end]:
            for piece in t.split('/'):
                piece = piece.strip()
                if not piece or piece in SKIP or PIN_NAME.match(piece):
                    continue
                m = AF_ENTRY.match(piece)
                if m:
                    rec['af'].setdefault(m.group(1), int(m.group(2)))
                elif BARE_FUNC.match(piece) and '_' in piece and not piece.startswith('P'):
                    if piece not in rec['analog']:
                        rec['analog'].append(piece)
    return out


def main():
    import yaml
    doc = yaml.safe_load(YAML.read_text(encoding='utf-8'))
    pins = parse_pins()
    print('DS Table 2-1-1: %d pins, %d AF assignments, %d bare (analog) functions'
          % (len(pins), sum(len(p['af']) for p in pins.values()),
             sum(len(p['analog']) for p in pins.values())))
    # 95 is the datasheet's own QFN128 I/O count, so the parser can be seen to have
    # read the whole table rather than most of it.
    if len(pins) != 95:
        print('  !! expected 95 pins (the DS QFN128 I/O count), read %d - the parse is '
              'incomplete and the findings below are not trustworthy' % len(pins))

    periphs = doc.get('peripherals') or {}

    # Which YAML peripheral owns a DS function name? Longest prefix wins, and the
    # prefix must end at a boundary (`_` or a unit digit followed by `_`).
    #
    # A purely lexical rule cannot answer this on its own. `DAC1_OUT` belongs to the
    # peripheral called `DAC`; `ADC_IN0` belongs to `ADC1`; and `TIM2_CH1` does NOT
    # belong to `TIM6` even though `TIM6`'s alphabetic stem is `TIM`. The rule that
    # does work is to ask the FILE: if some peripheral already claims the signal, it
    # has an owner and is not a finding; if none does and the name prefix-matches a
    # peripheral that says it holds no pin, that peripheral is the owner and the
    # claim is false.
    names = sorted(periphs, key=len, reverse=True)
    claimed_sigs = set()
    for pid, P in periphs.items():
        for sig in (P.get('signal_pins') or {}):
            claimed_sigs.add('%s_%s' % (pid, sig))
        for r in (P.get('remaps') or []):
            for sig in (r.get('pins') or {}):
                claimed_sigs.add('%s_%s' % (pid, sig))

    def owner_of(func):
        for pid in names:
            if claimed_sigs and any(k.startswith(pid + '_') and k.split('_', 1)[1] == func
                                    for k in claimed_sigs):
                return pid
            stem = pid.rstrip('0123456789')
            if func.startswith(stem):
                rest = func[len(stem):]
                if rest.startswith('_') or re.match(r'^\d+_', rest):
                    # a number here must be THIS peripheral's unit number
                    m = re.match(r'^(\d+)_', rest)
                    if m and pid != stem and m.group(1) != pid[len(stem):]:
                        continue
                    return pid
        return None

    # ---- 2. a peripheral that says it holds no pin, but the DS gives it one -----
    print('\n== peripherals that claim no pin ==')
    for pid, P in sorted(periphs.items()):
        if not P:
            continue
        if 'holds no pin' not in (P.get('notes') or ''):
            continue
        hits = {}
        for pin, d in pins.items():
            for sig in d['af']:
                if owner_of(sig) == pid:
                    hits.setdefault(pin, []).append('%s(AF%d)' % (sig, d['af'][sig]))
            for fn in d['analog']:
                if owner_of(fn) == pid:
                    hits.setdefault(pin, []).append(fn)
        if hits:
            print('  ! %-8s says "holds no pin" but the DS gives it %d pin(s): %s'
                  % (pid, len(hits),
                     ', '.join('%s %s' % (k, v) for k, v in sorted(hits.items())[:5])))
        else:
            print('    %-8s confirmed: nothing in the DS pin table is its%s'
                  % (pid, '' if any(k.startswith(pid + '_') for k in claimed_sigs)
                     else ' (and it claims nothing)'))

    # ---- 1. a signal the DS routes but the YAML does not claim ----------------
    print('\n== DS signals the YAML does not route ==')
    claimed = {}
    for pid, P in periphs.items():
        for sig, rows in (P.get('signal_pins') or {}).items():
            for r in rows or []:
                if isinstance(r, dict) and r.get('pin'):
                    claimed.setdefault('%s_%s' % (pid, sig), set()).add(r['pin'])
        for r in (P.get('remaps') or []):
            for sig, pin in (r.get('pins') or {}).items():
                claimed.setdefault('%s_%s' % (pid, sig), set()).add(pin)
    missing = {}
    for pin, d in pins.items():
        for sig in d['af']:
            if sig in claimed:
                if pin not in claimed[sig]:
                    missing.setdefault(sig, []).append(pin)
    for sig in sorted(missing):
        print('  - %-24s DS also routes to %s' % (sig, ', '.join(sorted(missing[sig]))))

    # ---- 3. a pin the YAML claims that the DS does not -----------------------
    print('\n== pins the YAML claims that the DS pin table does not ==')
    wrong = 0
    for key, pin_set in sorted(claimed.items()):
        d = {}
        for pin, info in pins.items():
            if key.split('_', 1)[-1] in info['af']:
                d[pin] = True
        if not d:
            continue
        extra = sorted(p for p in pin_set if p not in d)
        if extra:
            wrong += 1
            print('  - %-24s YAML has %s; DS lists %s' % (key, ', '.join(extra), ', '.join(sorted(d))))
    if not wrong:
        print('  none')
    return 0


if __name__ == '__main__':
    sys.exit(main())
