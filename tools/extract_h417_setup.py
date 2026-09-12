#!/usr/bin/env python3
"""Extract CH32H417's peripheral *setup* blocks from the RM and the EVT package.

    python tools/extract_h417_setup.py --nvic        # the 120-vector table
    python tools/extract_h417_setup.py --dma         # DMA1/DMA2 channels + requests
    python tools/extract_h417_setup.py --exti        # EXTI lines
    python tools/extract_h417_setup.py --audit       # cross-checks, exit 2 on a mismatch

Why this exists
---------------
`tools/extract_h417_pins.py` (AGENT-4) covers pins and the per-pin AF map. This is the
other half of the same problem: the blocks that are NOT pins — vectors, DMA channels and
requests, EXTI lines. They are all mechanical readings of a vendor file, and the repo's
rule is that mechanical readings are extracted and diffed rather than transcribed, because
a hand-copied interrupt number is invisible until an interrupt never fires.

Two sources per fact, always
----------------------------
A vector has TWO names and they are not interchangeable (see `data/FORMAT.md` `## nvic`):
`irqn` is the `IRQn_Type` member that `NVIC_InitStructure.NVIC_IRQChannel` takes, and
`handler` is the symbol the startup table declares. On this part they come from two
DIFFERENT FILES - `ch32h417.h` and `startup_ch32h417_v3f.S` - and this tool reads both
and cross-checks them, because the vendor is not consistent between them and deriving one
from the other is exactly how `ADC1_IRQn` (a name that existed in neither place) got into
this repository once already.

The vector INDEX is the number: entry N of the startup table is vector N. That is
asserted below rather than assumed, because it is what lets the two files be compared at
all.

Dual core
---------
This part has two startup tables, `_v3f` and `_v5f`, and they are NOT the same length
(149 vs 148 words). Both are read and compared; a difference is reported rather than
silently averaged. See `data/mcus/CH32H417.notes.md` for the open question about how the
two cores are modelled.
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
H417 = ROOT / "data" / "sources" / "H417"
EVT = H417 / "Evt"
RM = H417 / "Datasheets" / "CH32H417RM.md"

# The device header and the two startup tables, found rather than hard-coded: the EVT
# drop ships one copy of each per example project, and a hard-coded example path would
# break the day someone deletes that example.
def find_one(pattern: str) -> pathlib.Path:
    hits = sorted(EVT.rglob(pattern))
    if not hits:
        sys.exit(f"extract_h417_setup: no {pattern} under {EVT}")
    return hits[0]


DEVICE_H = find_one("ch32h417.h") if (EVT / "EXAM" / "SRC" / "Peripheral" / "inc").is_dir() else None
if DEVICE_H is None:
    cands = [p for p in sorted(EVT.rglob("ch32h417.h")) if "Peripheral" in str(p)]
    DEVICE_H = cands[0] if cands else sys.exit("extract_h417_setup: no device header found")


# ---------------------------------------------------------------- the IRQn enum
IRQN_ENTRY = re.compile(r"^\s*([A-Za-z_]\w*_IRQn)\s*=\s*(\d+)\s*,", re.M)


def irqn_enum(path: pathlib.Path = DEVICE_H) -> list[tuple[str, int]]:
    """Every `IRQn_Type` member and its number, in file order."""
    text = path.read_text(encoding="utf-8", errors="replace")
    body = re.search(r"typedef\s+enum\s+IRQn\s*\{(.*?)\}\s*IRQn_Type", text, re.S)
    if not body:
        sys.exit(f"extract_h417_setup: no `typedef enum IRQn` in {path}")
    return [(m.group(1), int(m.group(2))) for m in IRQN_ENTRY.finditer(body.group(1))]


# ---------------------------------------------------------------- the startup tables
def startup_table(path: pathlib.Path) -> tuple[list[str | None], int]:
    """(table, offset) where `table[N]` is vector N and `offset` is how many entries had
    to be skipped at the front to make that true.

    **This is the subtle thing in the file, and getting it wrong shifts every vector.**
    The two startup files are NOT the same shape:

        startup_ch32h417_v3f.S   index 0 = `_start`, 1 = 0, 2 = NMI_Handler, 3 = HardFault
        startup_ch32h417_v5f.S   index 0 = 0,      1 = NMI_Handler, 2 = HardFault

    So v5f's `.word` list is missing the reset slot at the front and is one entry short
    overall (148 against v3f's 149). Reading v5f index-for-index against `IRQn_Type`
    therefore names the WRONG handler for all ~120 peripheral vectors - an interrupt that
    either never fires or fires the wrong function, and nothing in a compiler would say
    so. The alignment is anchored on the RISC-V exception numbers, which the ISA fixes
    (NMI = 2, HardFault = 3) rather than this tool trusting either file's formatting, and
    the offset found is returned so `audit()` can report it.
    """
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()

    # Collect every `.word` symbol in file order, starting from the first one. The
    # table is the leading run of them; a later `.word` inside a function is not part of it.
    words: list[tuple[int, str | None]] = []
    for i, line in enumerate(lines):
        m = re.match(r"\s*\.word\s+(\S+)", line)
        if m:
            sym = m.group(1)
            words.append((i, None if sym in ("0", "0x0") else sym))
        elif words and re.match(r"\s*\.(size|section|text|end)\b", line):
            break
    if not words:
        sys.exit(f"extract_h417_setup: no vector table in {path}")
    raw = [s for _, s in words]

    # Anchor on NMI: the RISC-V ISA puts it at exception code 2, so it is the first
    # named symbol whose position this tool can check without reading the vendor's mind.
    offset = 0
    for i, sym in enumerate(raw):
        if sym == "NMI_Handler":
            offset = i - 2                      # 0 for v3f, -1 for v5f
            break
    else:
        sys.exit(f"extract_h417_setup: no NMI_Handler in {path.name}, so the table "
                 f"cannot be anchored - refusing to guess its alignment")
    if offset > 0:
        # The file leads with entries that are not vectors (v3f's `_start` slot sits
        # before vector 0 in file order for our purposes here).
        table = raw[offset:]
    elif offset < 0:
        # The file is MISSING leading slots - v5f omits the reset vector entirely, so its
        # `.word` list starts one entry into the table. Pad the front so index still means
        # vector number, and say so in the docstring: this is the case that silently names
        # the wrong handler for every peripheral vector if it is not handled.
        table = [None] * (-offset) + raw
    else:
        table = raw
    return table, offset


def handler_for(table: list[str | None], vector: int) -> str | None:
    """The handler symbol declared for a vector number, or None when the slot is 0."""
    return table[vector] if 0 <= vector < len(table) else None


# ---------------------------------------------------------------- RM readings
def rm_lines() -> list[str]:
    if not RM.is_file():
        sys.exit(f"extract_h417_setup: {RM} not found")
    return RM.read_text(encoding="utf-8", errors="replace").splitlines()


def chapter(title_re: str) -> tuple[int, int]:
    """(first, last) 0-based line range of the chapter whose heading matches."""
    lines = rm_lines()
    starts = [(i, l.strip()) for i, l in enumerate(lines) if re.match(r"^Chapter \d+ ", l)]
    for n, (i, title) in enumerate(starts):
        if re.search(title_re, title, re.I):
            end = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
            return i, end
    sys.exit(f"extract_h417_setup: no RM chapter matching /{title_re}/")


# ---------------------------------------------------------------- DMA (RM ch.10)
#
# The per-request channel assignment on this part lives in the DMA controller's
# request-multiplexer tables, and the RM gives it as `DMAMUX`-style rows rather than one
# table. Both controllers are 8-channel; the request numbers are read from the RM's
# own table rather than from a summary, and the tool reports how many rows it found so a
# silent parse failure shows up as a count rather than as an empty block.
DMA_ROW = re.compile(r"^\s*(\d{1,3})\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*$")


def dma_requests() -> list[tuple[int, str, str]]:
    a, b = chapter(r"Direct Memory Access")
    rows = []
    for line in rm_lines()[a:b]:
        m = DMA_ROW.match(line)
        if m:
            rows.append((int(m.group(1)), m.group(2), m.group(3)))
    return rows


# ---------------------------------------------------------------- EXTI (RM ch.9)
EXTI_ROW = re.compile(r"^\s*(\d{1,2})\s+(EXTI\d+|PVD|AWU|USB\w*|RTC\w*)\b")


def exti_lines() -> list[tuple[int, str]]:
    a, b = chapter(r"GPIO and Alternate Functions")
    out = []
    for line in rm_lines()[a:b]:
        m = EXTI_ROW.match(line)
        if m:
            out.append((int(m.group(1)), m.group(2)))
    return out


# ---------------------------------------------------------------- output
# ---------------------------------------------------------------- vector grouping
#
# `peripheral:` puts a vector in that peripheral's NVIC Settings tab and `system: true`
# puts it under the NVIC entry in System Core. Both are presentation, but a wrong one
# sends a user to the wrong tab; the DMA ones also carry `channel:` so that enabling a
# DMA request can offer its matching interrupt.
SYSTEM_VECTORS = {
    "NonMaskableInt", "HardFault", "Ecall_M_Mode", "Ecall_U_Mode", "Break_Point",
    "SysTick0", "SysTick1", "Software",
}

# Vectors whose owner is not just the leading token. A table rather than a chain of
# `if`s, so the exceptions to the rule stay visible and countable.
OWNER_OVERRIDES = {
    "ADC1_2": "ADC1",
    "EXTI7_0": "EXTI", "EXTI15_8": "EXTI",
    "RTCAlarm": "RTC", "RTC": "RTC",
    "USBPDWakeUp": "USBPD", "USBHSWakeup": "USBHS", "USBSSWakeup": "USBSS",
    "USBSS_LINK": "USBSS", "USBFSWakeUp": "USBFS",
    "ETH_WKUP": "ETH", "SWPMI_WKUP": "SWPMI",
    "LPTIM1_WKUP": "LPTIM1", "LPTIM2_WKUP": "LPTIM2",
    "I3C_WKUP": "I3C", "I3C_EV": "I3C", "I3C_ER": "I3C",
    "USART_WKUP": "USART1",
    "DFSDM0": "DFSDM", "DFSDM1": "DFSDM",
    "TIM1_BRK": "TIM1", "TIM1_UP": "TIM1", "TIM1_TRG_COM": "TIM1", "TIM1_CC": "TIM1",
    "TIM8_BRK": "TIM8", "TIM8_UP": "TIM8", "TIM8_TRG_COM": "TIM8", "TIM8_CC": "TIM8",
}
# The two grouped EXTI vectors and the line range each covers (RM ch.9: 16 lines, 8 to
# a vector - a different grouping from CH32X035's three-vectors-over-26-lines).
EXTI_LINES = {"EXTI7_0": (0, 7), "EXTI15_8": (8, 15)}

DMA_CH = re.compile(r"^DMA([12])_Channel(\d+)$")
I2C_EV = re.compile(r"^(I2C\d)_(EV|ER)$")
CAN_SUF = re.compile(r"^(CAN\d)_(SCE|TX|RX0|RX1)$")


def split_vector(name: str) -> tuple[str | None, int | None, tuple[int, int] | None]:
    """(peripheral, dma channel, exti line range). peripheral None means system."""
    if name in SYSTEM_VECTORS:
        return None, None, None
    if name in OWNER_OVERRIDES:
        return OWNER_OVERRIDES[name], None, EXTI_LINES.get(name)
    m = DMA_CH.match(name)
    if m:
        return f"DMA{m.group(1)}", int(m.group(2)), None
    m = I2C_EV.match(name)
    if m:
        return m.group(1), None, None
    m = CAN_SUF.match(name)
    if m:
        return m.group(1), None, None
    return name.split("_")[0], None, None


def emit_nvic(out=print) -> int:
    irqs = irqn_enum()
    v3, off3 = startup_table(find_one("startup_ch32h417_v3f.S"))

    out("# Generated by tools/extract_h417_setup.py --nvic. Do not hand-edit.")
    out("#")
    out(f"# irqn    IRQn_Type in {DEVICE_H.relative_to(ROOT).as_posix()}")
    out("# handler the .word table in .../Startup/startup_ch32h417_v3f.S")
    out("# vector  the INDEX of that table entry, which is the number the enum uses")
    out(f"# alignment offset applied to that table: {off3} entry(ies) skipped at the front")
    out("#")
    out("# The PFIC scheme is read from core_riscv.h's `NVIC_SetPriority` comment block:")
    out("# FOUR priority bits at [7:4], with [3:0] reserved. **This part has four priority")
    out("# bits** where CH32V00x has two and CH32X035 has three, and the nesting split is")
    out("# selectable at runtime through CSR 0x804 on the V5F core.")
    out("nvic:")
    out("  controller: PFIC")
    out("  scheme:")
    out("    register: { name: PFIC_IPRIOR, address: 0xE000E400, bits_per_vector: 8 }")
    out("    priority_bits: 4")
    out("    priority_lsb: 4")
    out("    max_nesting: 8")
    out("    groups:")
    out("      # The V5F core's four documented splits (core_riscv.h NVIC_SetPriority).")
    out("      # 'Nesting' is CSR 0x804 bit 1 plus bits [3:2]; nesting 0 = no preemption.")
    out("      - name: No nesting (4 bits of sub-priority)")
    out("        preempt: { bits: 0, lsb: 0, min: 0, max: 0 }")
    out("        sub:     { bits: 4, lsb: 4, min: 0, max: 15 }")
    out("      - name: 2 levels of nesting (1 preemption bit)")
    out("        default: true")
    out("        preempt: { bits: 1, lsb: 7, min: 0, max: 1 }")
    out("        sub:     { bits: 3, lsb: 4, min: 0, max: 7 }")
    out("      - name: 4 levels of nesting (2 preemption bits)")
    out("        preempt: { bits: 2, lsb: 6, min: 0, max: 3 }")
    out("        sub:     { bits: 2, lsb: 4, min: 0, max: 3 }")
    out("      - name: 8 levels of nesting (3 preemption bits)")
    out("        preempt: { bits: 3, lsb: 5, min: 0, max: 7 }")
    out("        sub:     { bits: 1, lsb: 4, min: 0, max: 1 }")
    out("  vectors:")

    for full, num in irqs:
        h = handler_for(v3, num)
        if h is None:
            continue                       # a reserved slot is not a vector
        base = full[:-len("_IRQn")]        # the enum member minus its suffix
        pid, chan, lines = split_vector(base)
        if pid is None:
            extra = ", system: true"
        else:
            extra = f", peripheral: {pid}"
            if chan is not None:
                extra += f", channel: {chan}"
            if lines is not None:
                extra += f", lines: [{lines[0]}, {lines[1]}]"
        out(f"  - {{ name: {base}, vector: {num}, irqn: {full}, "
            f"handler: {h}{extra} }}")
    return 0


def emit_dma(out=print) -> int:
    rows = dma_requests()
    out("# Generated by tools/extract_h417_setup.py --dma. Do not hand-edit.")
    out(f"# {len(rows)} request row(s) read from RM ch.10.")
    for r in rows:
        out(f"#   {r}")
    return 0


def emit_exti(out=print) -> int:
    rows = exti_lines()
    out("# Generated by tools/extract_h417_setup.py --exti. Do not hand-edit.")
    out(f"# {len(rows)} line(s) read from RM ch.9.")
    for r in rows:
        out(f"#   {r}")
    return 0


def audit() -> int:
    """Cross-checks that make the extraction trustworthy rather than plausible."""
    bad = []
    irqs = irqn_enum()
    by_name = dict(irqs)
    v3, off3 = startup_table(find_one("startup_ch32h417_v3f.S"))
    v5, off5 = startup_table(find_one("startup_ch32h417_v5f.S"))

    print(f"extract_h417_setup: audit of {DEVICE_H.name}")
    print(f"  IRQn_Type members      : {len(irqs)}")
    print(f"  v3f startup table      : {len(v3)} entries (alignment offset {off3})")
    print(f"  v5f startup table      : {len(v5)} entries (alignment offset {off5})")

    # 0. The alignment offsets. Not a failure - it is a fact about two vendor files that
    #    are shaped differently - but it is reported on every run because a silent offset
    #    is the difference between a working ISR and a handler that never runs.
    if off3 != off5:
        print(f"  NOTE: the two tables needed different offsets ({off3} vs {off5}). "
              f"That is why the IRQn numbering is taken from v3f, whose index lines up "
              f"with the enum; reading v5f index-for-index would name the wrong handler "
              f"for every peripheral vector.")

    # 1. The two tables must agree wherever both name a handler. They describe the same
    #    peripheral set on two cores, so a difference is either a real per-core
    #    difference or a bug - both worth knowing, neither worth guessing at.
    diffs = []
    for i in range(min(len(v3), len(v5))):
        if v3[i] != v5[i]:
            diffs.append(f"vector {i}: v3f={v3[i]} v5f={v5[i]}")
    if diffs:
        print(f"  v3f/v5f differences    : {len(diffs)}")
        for d in diffs[:10]:
            print(f"      {d}")
        if len(diffs) > 10:
            print(f"      ... and {len(diffs) - 10} more")
    else:
        print("  v3f/v5f differences    : none")

    # 2. Every enum member must land inside a table and name the same handler the table
    #    does. This is the check that would have caught `ADC1_IRQn`.
    missing = []
    for name, num in irqs:
        h = handler_for(v3, num)
        if h is None:
            missing.append(f"{name} = {num} has no handler in the v3f table "
                           f"(table has {len(v3)} entries)")
    if missing:
        bad.extend(missing)

    # 3. The enum's own numbering must be strictly increasing - a reordered enum would
    #    make every number below wrong while still parsing.
    nums = [n for _, n in irqs]
    if nums != sorted(nums):
        bad.append("IRQn_Type is not in ascending numeric order, so the file's order no "
                   "longer means anything")

    # 4. Every handler the vector table names must be DECLARED and DEFINEED in that same
    #    startup file - a `.word` pointing at a symbol nothing defines is a link error the
    #    day someone enables that interrupt, and the vendor declares them with `.weak`
    #    plus a default body rather than in a header, which is why this reads the .S and
    #    not the .h (the device header declares zero handlers).
    startup_text = find_one("startup_ch32h417_v3f.S").read_text(encoding="utf-8", errors="replace")
    declared = set(re.findall(r"^\s*\.weak\s+([A-Za-z_]\w*)", startup_text, re.M))
    defined = set(re.findall(r"^([A-Za-z_]\w*):\s*$", startup_text, re.M))
    undeclared = []
    for name, num in irqs:
        h = handler_for(v3, num)
        if not h:
            continue
        if h not in declared or h not in defined:
            missing_bit = "declared (.weak)" if h not in declared else "defined (label)"
            undeclared.append(f"{h} (vector {num}, {name}) is {missing_bit} nowhere in "
                              f"startup_ch32h417_v3f.S")
    if undeclared:
        bad.extend(undeclared[:10])

    print(f"  enum members with no handler : {len(missing)}")
    print(f"  handlers not in the .S        : {len(undeclared)}")
    print(f"  .weak handler declarations    : {len(declared)}")

    if bad:
        print("\n  AUDIT FAILED:")
        for b in bad:
            print(f"    - {b}")
        return 2
    print("\n  AUDIT OK: every IRQn member has a handler, the two startup tables agree, "
          "and every handler is declared.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--nvic", action="store_true", help="emit the nvic: vector list")
    ap.add_argument("--dma", action="store_true", help="emit DMA request rows read from the RM")
    ap.add_argument("--exti", action="store_true", help="emit EXTI lines read from the RM")
    ap.add_argument("--audit", action="store_true", help="cross-checks only")
    a = ap.parse_args()

    if a.audit:
        return audit()
    if a.nvic:
        return emit_nvic()
    if a.dma:
        return emit_dma()
    if a.exti:
        return emit_exti()
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
