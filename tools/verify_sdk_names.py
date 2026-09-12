#!/usr/bin/env python3
"""Check that every SPL name an MCU file claims exists in THAT part's SDK headers.

    python tools/verify_sdk_names.py                    # every bundled MCU
    python tools/verify_sdk_names.py data/mcus/X.yaml   # just one
    python tools/verify_sdk_names.py --list-sources     # which SDK each part resolves to
    python tools/verify_sdk_names.py --strict           # warnings count as failures

Exit code 0 = clean.  1 = at least one ERROR (or a WARN under --strict).

Why this exists
---------------
`validate_mcu.py` checks that an MCU file is consistent WITH ITSELF: that a remap
names a pin that exists, that a DMA default names a real option. It cannot see the
error that shipped in round 2, because that error was internally consistent:

    codegen.header:  ch32v00x.h                          the CH32V003 header
    codegen.speeds:  GPIO_Speed_2MHz / 10MHz / 50MHz     the CH32V10x/20x/30x spelling

Every one of those is a real, correctly spelled SPL identifier. Every one belongs to
a different chip. 267 tests, a validator with fourteen planted breaks and a browser
all passed; only a compiler disagreed. So: a name nobody compiled is a guess, and
this is what checks the names without waiting for a compiler.

What it checks, per part
  codegen.header            the file exists in that part's include dir, CASE-SENSITIVELY
  codegen.sdk               the series and EVT drop it claims actually exist
  codegen.gpio_clock        .fn is a declared function, .port/.afio are defined macros
                            ($PORT is expanded to every GPIO port the part really has)
  gpio.speeds[].macro       a member of GPIOSpeed_TypeDef
  codegen.speeds            every value is a member of GPIOSpeed_TypeDef
  codegen.periph_clock      every domain's .fn is declared, and .prefix + each bit key
                            is a defined macro
  codegen.remap             with style: macro, .fn and .enable exist
  peripherals.*.remaps[]    every .macro is a defined macro (CH32X035 has 44 of them)
  codegen.init_structs      the struct is a type the SDK defines and .fn is a declared
                            function that could apply it
  codegen.periph_handle     each peripheral's register block is a defined macro
  dma.channel_params        .sdk_field is a field of DMA_InitTypeDef; every option's
                            .sdk is a defined macro or enum member
  peripherals.*.params      .struct is a known type, .sdk_field is one of its members,
                            .sdk_call is a declared function, .sdk_enabled/.sdk_disabled
                            are real macros, and every option's .sdk exists
  nvic.vectors[].irqn       a member of IRQn_Type, or a handler symbol the startup file
                            actually declares

On a miss it says what it searched and suggests the closest match, the way GCC does.
A name that differs only in CASE is called out separately: that is the round-2 defect,
and on NTFS it is invisible until CI runs on Linux.

Where the names come from
  1. data/sources/<evt>/Evt/**/Peripheral/inc      the EVT package  - TOP AUTHORITY
  2. ~/.platformio/packages/framework-wch-noneos-sdk/Peripheral/<series>/inc
     plus Core/, System/, Startup/, Debug/         the same vendor code as a package
See data/sources/README.md for the precedence rule.

Silence is not a pass. A part with no `codegen.sdk` block, or one whose SDK is not
installed, is reported as NOT CHECKED with the reason and the tool still exits 0 --
but it never counts as verified.

Output is deliberately ASCII only: the Windows console here is cp1252.
"""
from __future__ import annotations

import argparse
import difflib
import glob
import os
import pathlib
import re
import sys

try:
    import yaml
except ImportError:
    sys.exit("verify_sdk_names: PyYAML is required.  pip install pyyaml")

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

# `mcu.inherits:` resolution already exists and is tested; do not write a second one.
from validate_mcu import Report, resolve_inherits  # noqa: E402

PIO_SDK = pathlib.Path(
    os.environ.get("WCHCUBE_SDK")
    or (pathlib.Path.home() / ".platformio" / "packages" / "framework-wch-noneos-sdk")
)

# ---------------------------------------------------------------- header parsing
#
# A real C parser is overkill and would need a preprocessor to get the conditionals
# right. What is needed is the set of names the SDK DEFINES, split by kind, so that a
# miss can say "not a macro" rather than "not found anywhere".

COMMENT_RE = re.compile(r"/\*.*?\*/|//[^\n]*", re.S)
DEFINE_RE = re.compile(r"^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)", re.M)
ENUM_RE = re.compile(r"\benum\b[^{;]*\{(.*?)\}\s*([A-Za-z_]\w*)?\s*;", re.S)
# Members are comma separated, but a member may sit behind a `#if` - CH32V006's
# USART2_IRQn and OPCM_IRQn are inside `#if defined(CH32V005) || defined(CH32V006)`.
# Preprocessor lines are dropped first, so a guarded member is still a member; taking
# the union over every branch is deliberate, because this asks "does the SDK spell it
# this way", not "is it compiled in for these -D flags".
CPP_LINE_RE = re.compile(r"^[ \t]*#.*$", re.M)
ENUM_MEMBER_RE = re.compile(r"^\s*([A-Za-z_]\w*)")
TYPEDEF_TAIL_RE = re.compile(r"\}\s*([A-Za-z_]\w*)\s*;")
STRUCT_RE = re.compile(r"\btypedef\s+struct\b[^{;]*\{(.*?)\}\s*([A-Za-z_]\w*)\s*;", re.S)
FIELD_RE = re.compile(r"([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*(?:,|$)")
FUNC_RE = re.compile(
    r"^[ \t]*(?:extern[ \t]+)?[A-Za-z_][\w \t\*]*?\b([A-Za-z_]\w*)[ \t]*\([^;{]*\)[ \t]*;",
    re.M,
)
# Startup is assembly: `.weak NAME` and `.word NAME` are the vector symbols.
ASM_SYM_RE = re.compile(r"^\s*\.(?:weak|word|globl|global)\s+([A-Za-z_]\w*)", re.M)


def strip_comments(text: str) -> str:
    return COMMENT_RE.sub(" ", text)


class Index:
    """Every name one part's SDK defines, by kind."""

    def __init__(self, label: str):
        self.label = label                     # what to print as "searched ..."
        self.macros: set[str] = set()
        self.enum_members: set[str] = set()
        self.enums: dict[str, set[str]] = {}   # IRQn_Type -> its members
        self.functions: set[str] = set()
        self.types: set[str] = set()
        self.fields: dict[str, set[str]] = {}  # DMA_InitTypeDef -> its fields
        self.asm_symbols: set[str] = set()
        self.header_files: set[str] = set()    # exact spelling, as the filesystem has it
        self.files_read = 0

    @property
    def everything(self) -> set[str]:
        return (self.macros | self.enum_members | self.functions
                | self.types | self.asm_symbols)

    def add_header(self, path: pathlib.Path) -> None:
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        self.files_read += 1
        text = strip_comments(raw)
        self.macros.update(DEFINE_RE.findall(text))
        self.functions.update(FUNC_RE.findall(text))
        for body, tail in ENUM_RE.findall(text):
            body = CPP_LINE_RE.sub("", body)
            members = set()
            for chunk in body.split(","):
                m = ENUM_MEMBER_RE.match(chunk)
                if m:
                    members.add(m.group(1))
            self.enum_members.update(members)
            if tail:
                self.types.add(tail)
                self.enums.setdefault(tail, set()).update(members)
        for body, name in STRUCT_RE.findall(text):
            self.types.add(name)
            fields: set[str] = set()
            for decl in body.split(";"):
                decl = decl.strip()
                if not decl or "(" in decl:
                    continue
                parts = decl.split(None, 1)
                if len(parts) < 2:
                    continue
                # "uint16_t GPIO_Pin" -> GPIO_Pin ; "uint32_t a, b" -> a, b
                for m in FIELD_RE.findall(parts[1]):
                    fields.add(m.lstrip("*"))
            self.fields.setdefault(name, set()).update(fields)
        self.types.update(TYPEDEF_TAIL_RE.findall(text))

    def add_asm(self, path: pathlib.Path) -> None:
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        self.files_read += 1
        self.asm_symbols.update(ASM_SYM_RE.findall(raw))

    def suggest(self, name: str, pool: set[str]) -> str:
        """The half of this tool that earns its keep: say what they probably meant."""
        if not pool:
            return ""
        ci = {n.lower(): n for n in pool}
        hit = ci.get(name.lower())
        if hit and hit != name:
            # Worth its own sentence: a case-only miss reads as correct to a human.
            # (For a C identifier this is a compile error on every platform - unlike
            # the header FILENAME case, which NTFS hides and only Linux catches.)
            return f" -- CASE ONLY: the SDK spells it `{hit}`"
        close = difflib.get_close_matches(name, sorted(pool), n=3, cutoff=0.7)
        if close:
            return " -- did you mean " + " or ".join(f"`{c}`" for c in close) + "?"
        return ""


# ---------------------------------------------------------------- locating an SDK
def evt_include_dirs(evt_root: pathlib.Path) -> list[pathlib.Path]:
    """EVT layout varies by drop; find the Peripheral/inc folders wherever they are."""
    if not evt_root.is_dir():
        return []
    return sorted({p for p in evt_root.rglob("Peripheral/inc") if p.is_dir()})


def evt_support_dirs(evt_root: pathlib.Path) -> list[pathlib.Path]:
    out: list[pathlib.Path] = []
    for name in ("Core", "System", "Startup", "Debug"):
        out.extend(p for p in evt_root.rglob(name) if p.is_dir())
    return sorted(set(out))


def build_index(doc: dict, r: Report) -> Index | None:
    """Resolve a part to an SDK and read it. None = not checkable, and it says why."""
    sdk = ((doc.get("codegen") or {}).get("sdk")) or {}
    if sdk.get("synthetic"):
        r.info("codegen.sdk",
               "synthetic part - declares `synthetic: true`, so there is no SDK to check "
               "against and nothing here is a claim about real silicon")
        return None
    if not sdk:
        r.warn("codegen.sdk",
               "no SDK declared, so NOTHING in this file was checked against a header. "
               "Add `codegen.sdk: { evt: <folder>, series: <series> }`, or "
               "`{ synthetic: true }` for a part that is not real silicon. See data/FORMAT.md.")
        return None

    evt = sdk.get("evt")
    series = sdk.get("series")
    sources: list[str] = []
    inc_dirs: list[pathlib.Path] = []
    support: list[pathlib.Path] = []

    if evt:
        evt_root = ROOT / "data" / "sources" / str(evt) / "Evt"
        if not evt_root.is_dir():
            r.warn("codegen.sdk.evt", f"`{evt}` -> {evt_root} does not exist")
        else:
            dirs = evt_include_dirs(evt_root)
            if dirs:
                inc_dirs += dirs
                support += evt_support_dirs(evt_root)
                sources.append(f"EVT data/sources/{evt}/Evt")
            else:
                r.info("codegen.sdk.evt",
                       f"`{evt}` exists but has no Peripheral/inc yet - falling back to PlatformIO")

    if not inc_dirs and series:
        base = PIO_SDK / "Peripheral" / str(series) / "inc"
        if base.is_dir():
            inc_dirs.append(base)
            support += [PIO_SDK / n for n in ("Core", "System", "Startup", "Debug")]
            sources.append(f"framework-wch-noneos-sdk/Peripheral/{series}")
        else:
            r.warn("codegen.sdk.series",
                   f"no SDK for series `{series}`, NOT CHECKED - looked in {base}. "
                   "Install the PlatformIO package, or drop the EVT sources in "
                   f"data/sources/{evt or '<PART>'}/Evt/.")

    if not inc_dirs:
        return None

    idx = Index(" + ".join(sources))
    for d in inc_dirs:
        for f in sorted(d.iterdir()):
            if f.is_file() and f.suffix.lower() == ".h":
                idx.header_files.add(f.name)
                idx.add_header(f)
    for d in support:
        if not d.is_dir():
            continue
        for f in sorted(d.rglob("*")):
            if not f.is_file():
                continue
            if f.suffix.lower() == ".h":
                idx.add_header(f)
            elif f.suffix.lower() in (".s", ".asm"):
                idx.add_asm(f)
    return idx


# ---------------------------------------------------------------- the checks
def want(r: Report, idx: Index, where: str, name, pool: set[str], kind: str) -> None:
    """One name, one namespace, one verdict."""
    if name is None:
        return
    name = str(name).strip()
    if not name or name in pool:
        return
    # Found, but filed under a different kind: say so rather than "does not exist".
    if name in idx.everything:
        r.error(where, f"`{name}` exists in the SDK but is not {kind} (searched {idx.label})")
        return
    r.error(where, f"`{name}` is not {kind} in this part's SDK "
                   f"(searched {idx.label}){idx.suggest(name, pool)}")


def gpio_ports(doc: dict) -> list[str]:
    """The ports this part really has, from `pins:` - not A..D by assumption."""
    out = set()
    for p in (doc.get("pins") or {}):
        m = re.fullmatch(r"P([A-Z])\d+", str(p))
        if m:
            out.add(m.group(1))
    return sorted(out)


def check_header(doc: dict, idx: Index, r: Report) -> None:
    h = (doc.get("codegen") or {}).get("header")
    if not h or h in idx.header_files:
        return
    ci = {f.lower(): f for f in idx.header_files}
    hit = ci.get(str(h).lower())
    if hit:
        r.error("codegen.header",
                f"`{h}` differs only in CASE from the real file `{hit}`. NTFS resolves it "
                "anyway, Linux does not, and a machine carrying two series' include paths "
                "compiles the other part's register map. This is the round-2 defect: the "
                "spelling must match the file exactly.")
        return
    close = difflib.get_close_matches(str(h), sorted(idx.header_files), n=3, cutoff=0.6)
    r.error("codegen.header",
            f"`{h}` is not a header in this part's include dir (searched {idx.label})"
            + (" -- did you mean " + " or ".join(f"`{c}`" for c in close) + "?" if close else ""))


def check_gpio(doc: dict, idx: Index, r: Report) -> None:
    cg = doc.get("codegen") or {}
    gc = cg.get("gpio_clock") or {}
    want(r, idx, "codegen.gpio_clock.fn", gc.get("fn"), idx.functions, "a declared function")
    if gc.get("port"):
        ports = gpio_ports(doc)
        if not ports:
            r.warn("codegen.gpio_clock.port", "no P<x><n> pins in `pins:`, so $PORT was not expanded")
        for p in ports:
            want(r, idx, f"codegen.gpio_clock.port [$PORT={p}]",
                 str(gc["port"]).replace("$PORT", p), idx.macros, "a defined macro")
    want(r, idx, "codegen.gpio_clock.afio", gc.get("afio"), idx.macros, "a defined macro")

    # The speed enum is the whole point of round 3's P0.
    speed_pool = idx.enums.get("GPIOSpeed_TypeDef") or idx.enum_members
    declared = set()
    for i, sp in enumerate(((doc.get("gpio") or {}).get("speeds")) or []):
        if isinstance(sp, dict):
            want(r, idx, f"gpio.speeds[{i}].macro", sp.get("macro"), speed_pool,
                 "a member of GPIOSpeed_TypeDef")
            if sp.get("macro"):
                declared.add(sp["macro"])
    for key, macro in (cg.get("speeds") or {}).items():
        want(r, idx, f"codegen.speeds.{key}", macro, speed_pool,
             "a member of GPIOSpeed_TypeDef")

    # Mode macros, same rule: GPIOMode_TypeDef is per family.
    mode_pool = idx.enums.get("GPIOMode_TypeDef") or idx.enum_members
    seen_modes = set()
    for listname in ("modes", "input_modes"):
        for i, mo in enumerate(((doc.get("gpio") or {}).get(listname)) or []):
            if isinstance(mo, dict):
                want(r, idx, f"gpio.{listname}[{i}].macro", mo.get("macro"), mode_pool,
                     "a member of GPIOMode_TypeDef")
                if mo.get("macro"):
                    seen_modes.add(mo["macro"])
    real_modes = idx.enums.get("GPIOMode_TypeDef")
    if seen_modes and real_modes and seen_modes < real_modes:
        r.warn("gpio.modes",
               f"GPIOMode_TypeDef has {len(real_modes)} member(s), this part accounts for "
               f"{len(seen_modes)}; unaccounted: {', '.join(sorted(real_modes - seen_modes))}. "
               "A mode the part has but the table cannot ask for is a mode the user cannot reach.")

    # A part that states its speeds should account for all of them.
    real = idx.enums.get("GPIOSpeed_TypeDef")
    if declared and real and declared < real:
        r.warn("gpio.speeds",
               f"GPIOSpeed_TypeDef has {len(real)} member(s), this part offers "
               f"{len(declared)}; not offered: {', '.join(sorted(real - declared))}. "
               "Correct only if the silicon really lacks them - say so in the notes.")


def check_remaps(doc: dict, idx: Index, r: Report) -> None:
    """`peripherals.*.remaps[].macro` and `codegen.remap.fn` — the macro form.

    CH32X035 carries 44 of these and every one of them went UNCHECKED until this existed:
    a planted `GPIO_FullRemap_USART2X` passed the gate silently. A remap macro is exactly
    the kind of name this tool was built for - plausible, per-family, and a compile error
    if it is wrong - so the omission mattered more than the count suggests.
    """
    cg = doc.get("codegen") or {}
    rm = cg.get("remap") or {}
    if rm.get("style") == "macro":
        want(r, idx, "codegen.remap.fn", rm.get("fn"), idx.functions, "a declared function")
        want(r, idx, "codegen.remap.enable", rm.get("enable"),
             idx.macros | idx.enum_members, "a defined macro or enum member")
    for pid, P in (doc.get("peripherals") or {}).items():
        for i, entry in enumerate((P or {}).get("remaps") or []):
            if isinstance(entry, dict) and entry.get("macro"):
                want(r, idx, f"peripherals.{pid}.remaps[{i}].macro", entry["macro"],
                     idx.macros | idx.enum_members, "a defined macro or enum member")


def check_init_structs(doc: dict, idx: Index, r: Report) -> None:
    """`codegen.init_structs` pairs a struct with the function that applies it, and
    `codegen.periph_handle` names each peripheral's register block. Both are claims."""
    cg = doc.get("codegen") or {}
    for struct, spec in (cg.get("init_structs") or {}).items():
        want(r, idx, f"codegen.init_structs.{struct}", struct, idx.types,
             "a type the SDK defines")
        if isinstance(spec, dict):
            want(r, idx, f"codegen.init_structs.{struct}.fn", spec.get("fn"),
                 idx.functions, "a declared function")
    for pid, chans in (cg.get("channel_macros") or {}).items():
        for sig, macro in (chans or {}).items():
            want(r, idx, f"codegen.channel_macros.{pid}.{sig}", macro,
                 idx.macros | idx.enum_members, "a defined macro or enum member")
    for pid, handle in (cg.get("periph_handle") or {}).items():
        # A register-block handle is a macro in the main header (`#define ADC1 ((...)*)`).
        want(r, idx, f"codegen.periph_handle.{pid}", handle, idx.macros, "a defined macro")


def check_periph_clock(doc: dict, idx: Index, r: Report) -> None:
    pc = (doc.get("codegen") or {}).get("periph_clock") or {}
    for dom, spec in pc.items():
        if not isinstance(spec, dict):
            continue
        want(r, idx, f"codegen.periph_clock.{dom}.fn", spec.get("fn"),
             idx.functions, "a declared function")
        prefix = spec.get("prefix")
        if not prefix:
            continue
        # The macro is `prefix + key` unless the domain maps the key to a different SPL
        # spelling in `sdk:`. CH32H417 needs that for exactly two: the peripheral `USBFS`
        # has the bit `RCC_HBPeriph_OTG_FS`, and `OPA`/`CMP` share `RCC_HB2Periph_OPCM`.
        # Checking the raw key there would demand `RCC_HBPeriph_USBFS`, which the SPL does
        # not define - so the check would fail on correct data and pass on wrong data.
        sdk = spec.get("sdk") if isinstance(spec.get("sdk"), dict) else {}
        for bit in (spec.get("bits") or {}):
            want(r, idx, f"codegen.periph_clock.{dom}.bits.{bit}",
                 f"{prefix}{sdk.get(bit, bit)}", idx.macros, "a defined macro")


def check_params(doc: dict, idx: Index, r: Report) -> None:
    """`struct:` / `sdk_field:` / option `sdk:` on peripheral params and DMA channel params."""
    def one(where: str, p: dict, default_struct: str | None = None) -> None:
        struct = p.get("struct") or default_struct
        if p.get("struct"):
            want(r, idx, f"{where}.struct", struct, idx.types, "a type the SDK defines")
        fld = p.get("sdk_field")
        if fld and struct:
            if struct in idx.fields:
                if fld not in idx.fields[struct]:
                    r.error(f"{where}.sdk_field",
                            f"`{fld}` is not a member of `{struct}` (searched {idx.label})"
                            + idx.suggest(fld, idx.fields[struct]))
            else:
                r.warn(f"{where}.sdk_field",
                       f"`{struct}` was not found as a struct, so `{fld}` could not be checked")
        elif fld:
            r.warn(f"{where}.sdk_field",
                   f"`{fld}` names an init-struct member but no `struct:` says which struct")
        # A parameter the SDK sets through a CALL rather than an init-struct member
        # (TIM_ARRPreloadConfig, SPI_CalculateCRC, ADC_RegularChannelConfig). The
        # function has to exist too - it is no less a claim than a field name.
        want(r, idx, f"{where}.sdk_call", p.get("sdk_call"),
             idx.functions, "a declared function")
        # An argument list is a contract with the generator, so only the placeholders it
        # defines are legal - a typo like $HANDEL would otherwise reach generated C as
        # literal text. Anything not starting with $ is passed through as a literal.
        known = {"$HANDLE", "$VALUE", "$CHANNEL", "$RANK", "$INDEX"}
        for a in (p.get("sdk_args") or []):
            if str(a).startswith("$") and str(a) not in known:
                r.error(f"{where}.sdk_args",
                        f"`{a}` is not a placeholder the generator defines "
                        f"(known: {', '.join(sorted(known))})"
                        + idx.suggest(str(a), known))
        if p.get("sdk_args") and not p.get("sdk_call"):
            r.warn(f"{where}.sdk_args",
                   "an argument list with no `sdk_call:` names no function to pass it to")
        if p.get("sdk_call") and not p.get("sdk_args"):
            r.warn(f"{where}.sdk_call",
                   f"`{p['sdk_call']}` is named but `sdk_args:` is missing, so the generator "
                   "knows what to call and not how - it will emit a TODO instead of the call")
        # A bool parameter that reaches a FunctionalState member names its two macros.
        for k in ("sdk_enabled", "sdk_disabled"):
            want(r, idx, f"{where}.{k}", p.get(k),
                 idx.macros | idx.enum_members, "a defined macro or enum member")
        if p.get("sdk_none") and not p.get("sdk_note"):
            r.warn(f"{where}.sdk_none",
                   "says the SDK exposes nothing for this parameter but gives no `sdk_note:` "
                   "saying where the bit is. An unexplained gap reads as an oversight.")
        for j, o in enumerate(p.get("options") or []):
            if isinstance(o, dict) and o.get("sdk"):
                want(r, idx, f"{where}.options[{j}].sdk", o["sdk"],
                     idx.macros | idx.enum_members, "a defined macro or enum member")

    # A DMA request remap names a macro and a register, like anything else.
    for i, rm in enumerate((doc.get("dma") or {}).get("remaps") or []):
        if isinstance(rm, dict):
            want(r, idx, f"dma.remaps[{i}].macro", rm.get("macro"),
                 idx.macros | idx.enum_members, "a defined macro or enum member")

    for i, p in enumerate((doc.get("dma") or {}).get("channel_params") or []):
        if isinstance(p, dict):
            one(f"dma.channel_params[{i}] ({p.get('key', i)})", p, "DMA_InitTypeDef")

    for pid, P in (doc.get("peripherals") or {}).items():
        for i, p in enumerate((P or {}).get("params") or []):
            if isinstance(p, dict):
                one(f"peripherals.{pid}.params[{i}] ({p.get('key', i)})", p)

        # Per-channel init structs (TIM_OCInitTypeDef): one struct, and a DIFFERENT
        # apply function per channel, so the call table is checked entry by entry.
        cp = (P or {}).get("channel_params")
        if isinstance(cp, dict):
            where0 = f"peripherals.{pid}.channel_params"
            want(r, idx, f"{where0}.struct", cp.get("struct"), idx.types,
                 "a type the SDK defines")
            for ch, fn in (cp.get("sdk_calls") or {}).items():
                want(r, idx, f"{where0}.sdk_calls.{ch}", fn, idx.functions,
                     "a declared function")
            for i, p in enumerate(cp.get("params") or []):
                if isinstance(p, dict):
                    one(f"{where0}.params[{i}] ({p.get('key', i)})", p, cp.get("struct"))


def check_nvic(doc: dict, idx: Index, r: Report) -> None:
    """`irqn` is either an IRQn_Type member or a startup handler symbol.

    The vendor is not consistent about this and we cannot pretend to be: on CH32V006
    the ADC vector is `ADC_IRQn` in the enum but `ADC1_IRQHandler` in the startup
    table, and NMI has no enum member under that name at all."""
    pool = (idx.enums.get("IRQn_Type") or set()) | idx.asm_symbols | idx.macros
    for i, v in enumerate((doc.get("nvic") or {}).get("vectors") or []):
        if not isinstance(v, dict) or not v.get("irqn"):
            continue
        name = v["irqn"]
        if name in pool:
            continue
        r.error(f"nvic.vectors[{i}] ({v.get('name', i)}).irqn",
                f"`{name}` is neither a member of IRQn_Type nor a symbol the startup file "
                f"declares (searched {idx.label})" + idx.suggest(name, pool))


def check_pio(doc: dict, idx: Index, r: Report) -> None:
    """`mcu.variants[*].pio_board` / `.pio_env` name things outside this repo, so they
    rot the same way an SPL name does - and for the same reason, silently."""
    variants = ((doc.get("mcu") or {}).get("variants")) or {}
    claims_board = any(isinstance(v, dict) and v.get("pio_board") for v in variants.values())
    claims_env = any(isinstance(v, dict) and v.get("pio_env") for v in variants.values())
    if not claims_board and not claims_env:
        return

    boards_dir = pathlib.Path.home() / ".platformio" / "platforms" / "ch32v" / "boards"
    if claims_board:
        if not boards_dir.is_dir():
            r.warn("mcu.variants[*].pio_board",
                   f"no ch32v platform installed at {boards_dir}, board ids NOT CHECKED")
        else:
            have = {f.stem for f in boards_dir.glob("*.json")}
            for part, v in variants.items():
                b = (v or {}).get("pio_board")
                if b and b not in have:
                    r.error(f"mcu.variants.{part}.pio_board",
                            f"`{b}` is not a board the ch32v platform ships"
                            + idx.suggest(str(b), have))

    ini = ROOT / "data" / "firmware" / "platformio.ini"
    if claims_env:
        if not ini.exists():
            r.warn("mcu.variants[*].pio_env",
                   f"{ini} is missing, environment names NOT CHECKED")
        else:
            text = ini.read_text(encoding="utf-8", errors="replace")
            envs = set(re.findall(r"^\[env:([^\]]+)\]", text, re.M))
            for part, v in variants.items():
                e = (v or {}).get("pio_env")
                if e and e not in envs:
                    r.error(f"mcu.variants.{part}.pio_env",
                            f"`{e}` is not an environment in data/firmware/platformio.ini"
                            + idx.suggest(str(e), envs))


CHECKS = (check_header, check_gpio, check_remaps, check_init_structs, check_periph_clock,
          check_params, check_nvic, check_pio)


def verify_file(path: pathlib.Path) -> Report:
    r = Report(path)
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:                       # noqa: BLE001 - report, never crash
        r.error("yaml", str(exc))
        return r
    if not isinstance(doc, dict):
        r.error("yaml", "top level is not a mapping")
        return r
    doc = resolve_inherits(doc, path.parent, r)
    idx = build_index(doc, r)
    if idx is None:
        return r
    if idx.files_read == 0:
        r.warn("codegen.sdk", f"{idx.label} held no readable headers - NOT CHECKED")
        return r
    for check in CHECKS:
        check(doc, idx, r)
    r.info("codegen.sdk", f"checked against {idx.label} ({idx.files_read} files)")
    return r


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Check every SPL name an MCU file claims against that part's SDK headers.")
    ap.add_argument("files", nargs="*", help="MCU yaml files (default: data/mcus/*.yaml)")
    ap.add_argument("--strict", action="store_true", help="treat warnings as failures")
    ap.add_argument("--quiet", action="store_true", help="print problems only")
    ap.add_argument("--list-sources", action="store_true",
                    help="print which SDK each part resolves to, and exit")
    args = ap.parse_args()

    paths = [pathlib.Path(f) for f in args.files] or [
        pathlib.Path(f) for f in sorted(glob.glob(str(ROOT / "data" / "mcus" / "*.yaml")))
    ]
    if not paths:
        print("verify_sdk_names: no MCU files found")
        return 1

    if args.list_sources:
        for p in paths:
            r = Report(p)
            doc = resolve_inherits(yaml.safe_load(p.read_text(encoding="utf-8")), p.parent, r)
            idx = build_index(doc, r)
            label = idx.label if idx else "NOT CHECKED"
            detail = f"{idx.files_read} files" if idx else ("; ".join(r.warns + r.infos) or "-")
            print(f"  {p.name:<24} {label:<46} {Report._safe(detail)}")
        return 0

    if not args.quiet:
        print(f"verify_sdk_names: {len(paths)} file(s)")
    reports = [verify_file(p) for p in paths]
    for rep in reports:
        rep.print(args.quiet)

    errors = sum(len(r.errors) for r in reports)
    warns = sum(len(r.warns) for r in reports)
    bad = errors + (warns if args.strict else 0)
    if not args.quiet or bad:
        print(f"\n{errors} error(s), {warns} warning(s)" + (" [--strict]" if args.strict else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
