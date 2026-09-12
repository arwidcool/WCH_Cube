#!/usr/bin/env python3
"""coverage_lib.py -- the coverage ledger: what the sources say about a part, joined to
what its MCU file models. `tools/coverage.py` and `tools/ledger.py` are thin CLIs over this.

THE ONE RULE (docs/COVERAGE.md): every pin-bearing fact a source states about a part is a
ledger row, and a row is MODELLED by a named signal, or ABSENT with a citation, or the
build is red. Silence is the defect, and the gate treats it as one.

What is inventoried, mechanically, from the sources named in data/coverage/<PART>.yaml:

  pin functions   every function token on every pin row of the datasheet's pin table
                  (`DS Table 2-1-x`), read on the row token stream the way
                  tools/audit_h417_all_pins.py reads CH32H417 - PLUS, where the datasheet
                  has one, its signal-first table (`Table 2-3`, `Table 2-2-x`), which is
                  the same silicon read from a different layout and therefore an
                  independent second reading
  chapters        every `Chapter N Title` of the reference manual
  instances       every `#define X ((X_TypeDef *) ...)` in the part's main SPL header

and joined to the MCU file:

  a DS function token -> aliases -> a PERIPHERAL_SIGNAL the file routes ON THAT PIN
  a routed (peripheral, signal, pin) in the file -> a DS token on that pin (reverse)
  a peripheral with no routing -> its `pins:` declaration, verified against the DS
  a chapter -> a peripheral of the file, or a declared non-peripheral
  an instance -> a peripheral of the file, or a declared alias / absence
  a declared resource count -> the number of peripherals matching it

Every row ends in one of: modelled, absent (declared, cited), disagreement (the two DS
readings differ, declared), unread (a power/system pad, informational), or OPEN.

Output is ASCII only: the Windows console here is cp1252.
"""
from __future__ import annotations

import collections
import copy
import pathlib
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("coverage: PyYAML is required.  pip install pyyaml")

ROOT = pathlib.Path(__file__).resolve().parent.parent
MCU_DIR = ROOT / "data" / "mcus"
COVERAGE_DIR = ROOT / "data" / "coverage"
LEDGER_DIR = COVERAGE_DIR / "ledger"
TASKS_MD = ROOT / "TASKS.md"

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import validate_mcu  # noqa: E402  the same inherits resolution the validator uses

# ---------------------------------------------------------------------------- errors
class CoverageError(Exception):
    """A source or a descriptor that cannot be read. Exit 2, never a silent pass."""


# ---------------------------------------------------------------------------- loading
def real_parts() -> list[str]:
    """Every `mcu.name` under data/mcus/, sorted. The synthetic fixture is not there."""
    out = []
    for f in sorted(MCU_DIR.glob("*.yaml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        name = ((doc.get("mcu") or {}).get("name"))
        if name:
            out.append(name)
    return out


def load_mcu(part: str) -> dict:
    """The resolved (inherits applied) MCU document for `part`."""
    for f in sorted(MCU_DIR.glob("*.yaml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        if ((doc.get("mcu") or {}).get("name")) == part:
            rep = validate_mcu.Report(f)
            resolved = validate_mcu.resolve_inherits(doc, MCU_DIR, rep)
            if rep.errors:
                raise CoverageError(f"{f.name}: inherits cannot be resolved: {rep.errors[0]}")
            return resolved
    raise CoverageError(f"no MCU file under data/mcus/ has mcu.name {part}")


def coverage_path(part: str) -> pathlib.Path:
    return COVERAGE_DIR / f"{part}.yaml"


REQUIRED_TOP = ("part", "status", "sources")
STATUSES = ("complete", "in_extraction")


def load_coverage(part: str) -> dict:
    p = coverage_path(part)
    if not p.is_file():
        raise CoverageError(f"{part}: no coverage file at data/coverage/{part}.yaml - every real "
                            "part needs one (docs/COVERAGE.md says what goes in it)")
    doc = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    if not isinstance(doc, dict):
        raise CoverageError(f"{p.name}: top level must be a mapping")
    for k in REQUIRED_TOP:
        if k not in doc:
            raise CoverageError(f"{p.name}: missing `{k}:`")
    if doc["part"] != part:
        raise CoverageError(f"{p.name}: `part: {doc['part']}` does not match the file name")
    if doc["status"] not in STATUSES:
        raise CoverageError(f"{p.name}: `status:` must be one of {', '.join(STATUSES)}")
    if doc["status"] == "in_extraction":
        for k in ("owner", "task", "open_rows"):
            if k not in doc:
                raise CoverageError(f"{p.name}: status in_extraction needs `{k}:`")
        if not isinstance(doc["open_rows"], int):
            raise CoverageError(f"{p.name}: `open_rows:` must be an integer")
    src = doc["sources"]
    if not isinstance(src, dict) or not src.get("ds"):
        raise CoverageError(f"{p.name}: `sources.ds:` (the datasheet markdown) is required")
    return doc


def read_source(rel: str) -> tuple[str, pathlib.Path]:
    p = ROOT / rel
    if not p.is_file():
        raise CoverageError(f"source {rel} is not a file (paths are case-sensitive on CI)")
    return p.read_text(encoding="utf-8", errors="replace"), p


# ---------------------------------------------------------------------------- the model
class Model:
    """The MCU file as the ledger needs it: who routes what where, and who claims what."""

    def __init__(self, doc: dict):
        self.doc = doc
        self.pins: dict[str, str] = {}          # pin name -> type
        for name, info in (doc.get("pins") or {}).items():
            self.pins[str(name)] = ((info or {}).get("type") or "io")
        self.pids: list[str] = []
        self.routed: dict[str, dict[str, set[str]]] = {}      # pid -> sig -> {pin}
        self.af: dict[tuple[str, str, str], int | None] = {}  # (pid, sig, pin) -> af
        self.claimed: dict[str, set[str]] = {}                # pid -> {sig} any choice names
        self.decl: dict[str, dict | None] = {}                # pid -> its `pins:` block
        for pid, P in (doc.get("peripherals") or {}).items():
            if not isinstance(P, dict):
                continue
            self.pids.append(pid)
            r: dict[str, set[str]] = collections.defaultdict(set)
            for rm in P.get("remaps") or []:
                for sig, pin in ((rm or {}).get("pins") or {}).items():
                    if pin is not None:
                        r[str(sig)].add(str(pin))
                        self.af.setdefault((pid, str(sig), str(pin)), None)
            for sig, opts in (P.get("signal_pins") or {}).items():
                for o in opts or []:
                    if isinstance(o, dict) and o.get("pin") is not None:
                        r[str(sig)].add(str(o["pin"]))
                        self.af[(pid, str(sig), str(o["pin"]))] = o.get("af")
            self.routed[pid] = dict(r)
            c: set[str] = set()
            for s in P.get("settings") or []:
                for ch in (s or {}).get("choices") or []:
                    c |= set(str(x) for x in ((ch or {}).get("signals") or []))
            self.claimed[pid] = c
            self.decl[pid] = P.get("pins") if isinstance(P.get("pins"), dict) else None

    def routes(self, pid: str, sig: str, pin: str) -> bool:
        return pin in self.routed.get(pid, {}).get(sig, set())

    def has_routing(self, pid: str) -> bool:
        return bool(self.routed.get(pid))

    def io_pins(self) -> set[str]:
        return {p for p, t in self.pins.items() if t == "io"}

    def pids_by_base(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = collections.defaultdict(list)
        for pid in self.pids:
            out[re.sub(r"\d+$", "", pid)].append(pid)
        return out


# ---------------------------------------------------------------------------- aliases
def _pattern_to_regex(pat: str) -> re.Pattern:
    parts = pat.split("*")
    return re.compile("^" + "(.+?)".join(re.escape(p) for p in parts) + "$")


def _fill(template: str, groups: tuple[str, ...]) -> str | None:
    """`TIM*_CH*` with ('1','2') -> TIM1_CH2. `OPA_P{2}{1}` reorders. None on a bad count."""
    out = template
    if "{" in out:
        for i, g in enumerate(groups, 1):
            out = out.replace("{%d}" % i, g)
        if re.search(r"\{\d+\}", out):
            return None
        return out
    for g in groups:
        if "*" not in out:
            break
        out = out.replace("*", g, 1)
    return None if "*" in out else out


def _values(v) -> list:
    if v is None:
        return []
    if isinstance(v, dict):
        return _values(v.get("to"))
    return list(v) if isinstance(v, list) else [v]


class Aliaser:
    """DS token -> the file's PERIPHERAL_SIGNAL names, and back.

    Resolution order, first hit wins:
      1. an exact `aliases:` key;
      2. an `aliases:` pattern with `*`, in file order;
      3. the token read as `PID_SIG` at any underscore (`TIM2_CH1_ETR` -> TIM2 + CH1_ETR);
      4. the single-instance family rule: `OPA_P0` -> OPA1_P0 when exactly one peripheral
         is `OPA<digits>` and it routes P0 (ambiguous families need an alias);
      5. a bare token that exactly one peripheral routes as a signal (`MCO` -> RCC_MCO).
    A value may be a list: ANY of them routed on the pin satisfies the row (`ADC_IN3` may
    be ADC1_IN3 on one part and both ADC1_IN3 and ADC2_IN3 on another).
    """

    def __init__(self, model: Model, aliases: dict | None):
        self.model = model
        self.exact: dict[str, list[str]] = {}
        self.patterns: list[tuple[re.Pattern, list[str], str]] = []
        for key, val in (aliases or {}).items():
            key = str(key)
            vals = [str(x) for x in _values(val)]
            if not vals:
                raise CoverageError(f"aliases.{key}: no target (use `absent:` to drop a token)")
            # `*` is a wildcard; `{1}`, `{2}` are numbered wildcards the template can
            # reorder (`OPA{1}_P{2}: OPA_P{2}{1}` turns OPA3_P0 into OPA_P03)
            if "*" in key or "{" in key:
                self.patterns.append((_pattern_to_regex(re.sub(r"\{\d+\}", "*", key)), vals, key))
            else:
                self.exact[key] = vals
        self._by_base = model.pids_by_base()
        self._sig_owner: dict[str, list[str]] = collections.defaultdict(list)
        for pid, sigs in model.routed.items():
            for sig in sigs:
                self._sig_owner[sig].append(pid)

    @staticmethod
    def split(name: str) -> tuple[str, str] | None:
        i = name.find("_")
        return (name[:i], name[i + 1:]) if i > 0 else None

    def _literal(self, name: str) -> tuple[str, str] | None:
        """`PID_SIG` at any underscore position where the left part is a peripheral."""
        for m in re.finditer("_", name):
            pid, sig = name[:m.start()], name[m.start() + 1:]
            if pid in self.model.routed and sig:
                return pid, sig
        return None

    def _family(self, name: str) -> tuple[str, str] | None:
        for m in re.finditer("_", name):
            fam, sig = name[:m.start()], name[m.start() + 1:]
            cands = self._by_base.get(fam) or []
            if len(cands) == 1 and sig:
                return cands[0], sig
        return None

    def resolve(self, token: str) -> tuple[list[tuple[str, str]], str]:
        """([(pid, sig), ...], how). Empty list = nothing in the file answers to it."""
        if token in self.exact:
            return [self._pair(v) for v in self.exact[token]], "alias"
        for rx, vals, key in self.patterns:
            m = rx.match(token)
            if m:
                out = []
                for v in vals:
                    filled = _fill(v, m.groups())
                    if filled is None:
                        raise CoverageError(f"aliases.{key}: template `{v}` does not fit `{token}`")
                    out.append(self._pair(filled))
                return out, f"alias {key}"
        lit = self._literal(token)
        if lit:
            return [lit], "literal"
        fam = self._family(token)
        if fam:
            return [fam], "family"
        owners = self._sig_owner.get(token) or []
        if len(owners) == 1:
            return [(owners[0], token)], "bare"
        return [], ("ambiguous: " + ", ".join(sorted(owners))) if owners else "no alias"

    def _pair(self, name: str) -> tuple[str, str]:
        lit = self._literal(name)
        if lit:
            return lit
        s = self.split(name)
        if s:
            return s
        return name, ""


# ---------------------------------------------------------------------------- parsing
# A pin name, with the glued suffix the conversion sometimes leaves on it: `PA0-WKUP`,
# `PC13-` (continued on the next line), `PA13`. Ports are one letter and pins up to two
# digits: CH32X035 has PC19, CH32H417 has PF15.
PIN_TOKEN = re.compile(r"^(P[A-Z]\d{1,2})(-.*)?$")
CELL = re.compile(r"^(\d+|-)$")
FOOTNOTE = re.compile(r"^(\(\d+\))+$")
FOOTNOTE_HALF = re.compile(r"^(\(|\d\))$")            # `(3)` split into `(` and `3)`
AF_TOKEN = re.compile(r"^([A-Za-z][A-Za-z0-9_]*)\(AF(\d+)\)$")
SUFFIX = re.compile(r"^(.*[A-Za-z0-9])_(\d+)$")
FUNC = re.compile(r"^[A-Z][A-Z0-9_]*$")                # a function token is upper-case
# The pin-type column, across every WCH datasheet in the repo. `I/O/` is the front half
# of a split `I/O/A`; H417 adds an I/O-characteristic column with FT / SDP / A.
TYPE_TOKENS = {"I/O", "I/O/", "I/O/A", "I/O/FT", "I/O/S", "I", "O", "A", "P", "S", "FT", "SDP"}
# Page furniture the conversion repeats on every page of a table.
# A header word is only noise when the LINE is furniture: `## I/O PA6 USART2_TX_6` is a
# row whose name wrapped, `## I/O` alone is the column heading, and dropping the first one
# lost four CH32V006 pins on the tool's first run.
NOISE_LINE = re.compile(
    r"Datasheet|wch-ic\.com|wch\.cn|^#*\s*V\d+\.\d+\s+\d+\s*$|^#*\s*Note\s*\d*[:.]|"
    r"^#*\s*(Pin|Main|Default|Remapping|characte|ristic|level|function|Alternate|"
    r"\(After|\(after|reset\)|type|name|No\.)\b|"
    r"^#*\s*I/O(/[A-Z]+)?/?\s*$|"                                   # the type heading alone
    r"^#*\s*(LQFP|QFN|TSSOP|SOP|QSOP|SSOP|DIP)\d*[A-Z]?\d*\s*$|"     # a package column name
    r"^#*\s*[A-Z]\d{3}[A-Z0-9]{2,4}\s*$")                            # V006D8U7, L103K8U, H417WEU6
SUBSCRIPT = re.compile(r"^(SS|DD|DDA|SSA|BAT|DD33A?|DD12A|DDK|DDIO|IO18|REFP|REFN|CAP\w*|HV|HREG)$")
PACKAGE_NAME = re.compile(r"^(LQFP|QFN|TSSOP|SOP|QSOP|SSOP|DIP)\d+[A-Z]?\d*$")
POWER_NAME = re.compile(r"^(V|VSS\w*|VDD\w*|VBAT|VREF\w*|GND|NRST|RST|BOOT\d?|OSC_IN|OSC_OUT|"
                        r"OSC_OU|XI|XO|VIO\w*|VCAP\w*|SS|DD|DDA|SSA|BAT|DD33|DD33A|DD12A|DDK|DDIO|"
                        r"REFP|MDI\w*|SS[RT]X\w*|USB\w*)$")


def _strip_hash(line: str) -> str:
    s = line.strip()
    return s[2:].strip() if s.startswith("##") else s


NOTES_START = re.compile(r"^#*\s*Note\s*\d*\s*[:.]")


def _region(text: str, start: str, end: str, what: str, stop_at_notes: bool = False) -> tuple[list[str], int]:
    """The lines from the first line starting with `start` up to the first later line
    starting with `end`. A pin table also ends where its footnotes begin (`Note 1: ...`),
    because the note text is prose that would otherwise be read as the last row's
    functions - CH32V003's PD3 acquired `TTL`, `CMOS` and `FT` that way."""
    lines = text.splitlines()
    try:
        s = next(i for i, l in enumerate(lines) if l.strip().startswith(start))
    except StopIteration:
        raise CoverageError(f"{what}: no line starts with `{start}`")
    try:
        e = next(i for i, l in enumerate(lines) if i > s and l.strip().startswith(end))
    except StopIteration:
        raise CoverageError(f"{what}: no line after `{start}` starts with `{end}`")
    if stop_at_notes:
        # a note ends the table only when no row follows it: CH32V003's table opens with
        # a `Note:` paragraph before its first row, and a page's worth of rows can follow
        # a footnote the conversion moved. A row is a cells line (`## 8 1 18 8 PD4 ...`)
        # or a pin-block line (`## PA0 A0`).
        row_like = re.compile(r"^(##\s*)?([\d-]+\s+[\d-]|P[A-Z]\d{1,2}\b)")
        for i in range(s + 1, e):
            if NOTES_START.match(lines[i].strip()) and not any(
                    row_like.match(lines[j].strip()) for j in range(i + 1, e)):
                e = i
                break
    return lines[s:e], s


def _tokens(lines: list[str], first_line: int, extra_noise: list[str]) -> list[tuple[str, int]]:
    """(token, 1-based line) for every whitespace- and slash-separated token in the region,
    with page furniture dropped. Slashes separate functions in every WCH pin table."""
    out: list[tuple[str, int]] = []
    noise = [re.compile(n) for n in extra_noise]
    for k, raw in enumerate(lines):
        line = _strip_hash(raw)
        if not line or NOISE_LINE.search(line) or any(n.search(line) for n in noise):
            continue
        for t in re.split(r"[\s/]+", line):
            if t and not t.startswith("CH32"):          # a part name in a footnote is furniture
                out.append((t, first_line + k + 1))
    return out


def _glue(tokens: list[tuple[str, int]], dictionary: set[str]) -> list[tuple[str, int]]:
    """Repair the ways a PDF-to-markdown pass tears a function name, conservatively:
       `USART1_TX` `_8`      a suffix wrapped to its own line     -> USART1_TX_8
       `T1CH3N_` `3`         the digit wrapped                     -> T1CH3N_3
       `I2` `C4_SMBA(AF4)`   a name split mid-token, joined ONLY  -> I2C4_SMBA(AF4)
                             when the join is a known name and the
                             left half is not
       `PC13-` `TAMPER-RTC`  a glued pin-name suffix continued     -> PC13-TAMPER-RTC
    Footnotes `(n)` are removed first, so `T2CH1ETR (1) _2` also joins."""
    toks = [(t, n) for t, n in tokens if not FOOTNOTE.match(t) and not FOOTNOTE_HALF.match(t)]
    out: list[tuple[str, int]] = []
    for t, n in toks:
        if out:
            prev, pn = out[-1]
            if t.startswith("_") and not CELL.match(prev):
                out[-1] = (prev + t, pn)
                continue
            # a name ending in `_` is never complete: what follows is its wrapped suffix,
            # even when that is a bare number (`TIM2_CH1_ETR_` + `5`); a package cell never
            # follows a name ending in `_`
            if prev.endswith("_") and t != "-":
                out[-1] = (prev + t, pn)
                continue
            # `PC13-` + `TAMPER-RTC`: a glued pin-name suffix continued on the next line.
            # A bare `-` is a package cell and never glues (that rule, unguarded, swallowed
            # every `- PC0` row of three datasheets on the tool's second run).
            if prev.endswith("-") and prev != "-" and not CELL.match(t):
                out[-1] = (prev + t, pn)
                continue
            if prev == "V" and SUBSCRIPT.match(t):               # `V` + `SS` = VSS
                out[-1] = (prev + t, pn)
                continue
            base_prev = AF_TOKEN.sub(r"\1", prev)
            joined = prev + t
            jb = AF_TOKEN.sub(r"\1", joined)
            # never join two pin-type tokens: `I` + `O` is the type column, not a torn
            # name, even on a part whose SWPMI has a signal called IO
            # (a bare digit joins only when the exact join is a known name: `C1P` + `0`
            # is CMP1's P0 on CH32X035, while `USART1_TX` + `5` is a function followed by
            # a package cell and `USART1_TX5` is nobody's name; a fragment of one or two
            # letters is never a complete name even when a signal happens to be spelled
            # that way - `SD` + `RAM_D20` is SDRAM_D20, whatever I2S calls its data line)
            if (FUNC.match(base_prev) and (base_prev not in dictionary or len(base_prev) <= 2)
                    and not (prev in TYPE_TOKENS and t in TYPE_TOKENS)
                    and (jb in dictionary or SUFFIX.sub(r"\1", jb) in dictionary)
                    and (not CELL.match(t) or jb in dictionary) and not PIN_TOKEN.match(t)):
                out[-1] = (joined, pn)
                continue
        out.append((t, n))
    return out


def _split_func(tok: str) -> tuple[str, int | None, int | None] | None:
    """`USART1_TX_5` -> (USART1_TX, 5, None); `SPI1_NSS(AF5)` -> (SPI1_NSS, None, 5).
    None for a token that is not a function name."""
    af = None
    m = AF_TOKEN.match(tok)
    if m:
        tok, af = m.group(1), int(m.group(2))
    idx = None
    m = SUFFIX.match(tok)
    if m:
        tok, idx = m.group(1), int(m.group(2))
    if not FUNC.match(tok):
        return None
    # another pin's name, or a package name, in a function position is footnote text
    # that landed inside a row (CH32X035's PC19 carries "RST ... PB7 ... TSSOP20")
    if PIN_TOKEN.match(tok) or PACKAGE_NAME.match(tok):
        return None
    return tok, idx, af


class PinRow:
    __slots__ = ("pin", "raw", "line", "io", "funcs", "own")

    def __init__(self, pin: str, raw: str, line: int, io: bool):
        self.pin, self.raw, self.line, self.io = pin, raw, line, io
        self.funcs: list[tuple[str, int | None, int | None, int]] = []   # (base, idx, af, line)
        self.own: set[str] = set()      # tokens that are the pad's own datasheet name


def parse_pin_table(text: str, cfg: dict, pin_aliases: dict, dictionary: set[str],
                    known_pins: set[str], extra_noise: list[str]) -> list[PinRow]:
    """DS Table 2-1-x on the row token stream. A row is anchored by a pin name that follows
    a run of package-cell tokens (numbers / dashes) and is itself followed by a pin-type
    token; everything after the type tokens, up to the next anchor, is a function of that
    pin. Reading it this way survives the four ways the conversion mangles a row (name on
    its own line, first cell wrapped, leading dash dropped, subscript split) without a
    per-row regex - the same approach that read CH32H417's 95 pins correctly."""
    lines, first = _region(text, cfg["start"], cfg["end"], f"pin table `{cfg['start']}`",
                           stop_at_notes=cfg.get("stop_at_notes", True))
    toks = _glue(_tokens(lines, first, extra_noise), dictionary)
    rows: list[PinRow] = []
    i, n = 0, len(toks)
    prev_cell = True
    while i < n:
        t, ln = toks[i]
        if CELL.match(t):
            prev_cell = True
            i += 1
            continue
        anchor = None
        if prev_cell and FUNC.match(t.split("-")[0]) or (prev_cell and PIN_TOKEN.match(t)):
            # a type token within the next 4 tokens makes this a row (a footnote, a dash
            # and a torn main-function name can all sit between the name and its type)
            look = [x for x, _ in toks[i + 1:i + 5]]
            if any(x in TYPE_TOKENS for x in look):
                anchor = t
        if anchor is not None:
            name = anchor.split("-")[0]
            name = pin_aliases.get(name, name)
            m = PIN_TOKEN.match(anchor)
            if not m and not (name in known_pins or POWER_NAME.match(anchor) or name in pin_aliases):
                anchor = None
        if anchor is None:
            prev_cell = False
            if rows:
                f = _split_func(t)
                if f and f[0] != rows[-1].pin and f[0] != rows[-1].raw:
                    rows[-1].funcs.append((f[0], f[1], f[2], ln))
            i += 1
            continue
        base = pin_aliases.get(anchor.split("-")[0], anchor.split("-")[0])
        io = bool(PIN_TOKEN.match(anchor)) or (base in known_pins and base.startswith("P"))
        row = PinRow(base, anchor, ln, io)
        rows.append(row)
        # the glued suffix of the anchor is a function too: PA0-WKUP carries WKUP
        for extra in anchor.split("-")[1:]:
            f = _split_func(extra)
            if f:
                row.funcs.append((f[0], f[1], f[2], ln))
        # a pad the datasheet names after its function and the file after its port
        # (OSC_IN -> PD0 through pin_aliases) carries that function: OSC_IN on PD0
        if anchor.split("-")[0] != base:
            f = _split_func(anchor.split("-")[0])
            if f:
                row.funcs.append((f[0], None, None, ln))
                row.own.add(f[0])
        # consume type tokens, dashes and the main-function repeat of the pin name
        j = i + 1
        while j < n:
            x, xl = toks[j]
            if x in TYPE_TOKENS or x == "-" or x == base or x == anchor:
                j += 1
                continue
            break
        if not io:
            # a system pad's own name is a fact the file may route (XI, XO, NRST)
            f = _split_func(base)
            if f:
                row.funcs.append((f[0], None, None, ln))
        prev_cell = False
        i = j
    return rows


def parse_pin_grid(text: str, cfg: dict, pin_aliases: dict, dictionary: set[str],
                   extra_noise: list[str]) -> dict[str, set[tuple[str, int | None]]]:
    """The signal-first `Table 2-3` shape: `## PA0 A0` starts a pin block and every token
    until the next `## Pxx` belongs to it. Column-header lines (family names only) and page
    furniture are dropped. Returns pin -> {(base, af)}."""
    lines, first = _region(text, cfg["start"], cfg["end"], f"signal table `{cfg['start']}`",
                           stop_at_notes=cfg.get("stop_at_notes", True))
    out: dict[str, set[tuple[str, int | None]]] = collections.defaultdict(set)
    noise = [re.compile(n) for n in extra_noise]
    cur = None
    buf: list[tuple[str, int]] = []

    def flush():
        if cur is None:
            return
        for t, _ in _glue(buf, dictionary):
            f = _split_func(t)
            if f and f[0] != cur:
                out[cur].add((f[0], f[2]))

    for k, raw in enumerate(lines):
        line = _strip_hash(raw)
        if not line or NOISE_LINE.search(line) or any(n.search(line) for n in noise):
            continue
        words = line.split()
        # the column-header line (`ADC TIM1 TIM2/3/4 USART CMP SYS ...`) repeats on every
        # page: three or more family names, none with an underscore, none a pin
        if len(words) >= 3 and all(re.match(r"^[A-Z][A-Z0-9]*(/[A-Z0-9]+)*$", w) and "_" not in w
                                   and not PIN_TOKEN.match(w) for w in words):
            continue
        parts = [p for p in re.split(r"[\s/]+", line) if p and not p.startswith("CH32")]
        if not parts:
            continue
        head = parts[0]
        m = PIN_TOKEN.match(head)
        if m or head in pin_aliases:
            flush()
            cur = pin_aliases.get(head.split("-")[0], head.split("-")[0])
            buf = [(p, first + k + 1) for p in parts[1:]]
            continue
        buf.extend((p, first + k + 1) for p in parts)
    flush()
    return out


def parse_signal_rows(text: str, cfg: dict) -> dict[str, set[tuple[str, int | None]]]:
    """The signal-first `Table 2-2-N <family> Pin functions` shape (CH32H417): a row is one
    or more signal names (slash-separated) followed by pin cells `PA8(AF7), PB6(AF7)` or
    bare pins; a line of pins alone continues the previous row. Rows whose cells are not
    port pins (temperature sensor, Vrefint) are skipped. Returns pin -> {(base, af)}."""
    lines, first = _region(text, cfg["start"], cfg["end"], f"signal table `{cfg['start']}`")
    cell = re.compile(r"\b(P[A-Z]\d{1,2})\s*(?:\(\s*AF(\d{1,2})\s*\))?")
    sigre = re.compile(r"^([A-Z][A-Za-z0-9]*_[A-Za-z0-9_/]+)")
    out: dict[str, set[tuple[str, int | None]]] = collections.defaultdict(set)
    cur: list[str] = []
    for raw in lines:
        line = _strip_hash(raw)
        if not line or NOISE_LINE.search(line) or re.search(r"function|pin$|_RM=", line):
            continue
        m = sigre.match(line)
        rest = line
        if m and not PIN_TOKEN.match(m.group(1).split("/")[0]):
            cur = [s for s in m.group(1).split("/") if s]
            rest = line[m.end():]
        if not cur:
            continue
        for pin, af in cell.findall(rest):
            for s in cur:
                base = SUFFIX.sub(r"\1", s)
                out[pin].add((base, int(af) if af else None))
    return out


def parse_chapters(text: str) -> list[tuple[int, str, int]]:
    seen: dict[int, tuple[int, str, int]] = {}
    for k, line in enumerate(text.splitlines(), 1):
        m = re.match(r"^#*\s*Chapter\s+(\d+)\s+(.+?)\s*$", line)
        if m:
            n = int(m.group(1))
            if n not in seen:
                seen[n] = (n, m.group(2), k)
    return [seen[n] for n in sorted(seen)]


INSTANCE = re.compile(r"^#define\s+(\w+)\s+\(\(\s*(\w+_TypeDef)\s*\*\)")
BUILTIN_INSTANCE_IGNORE = [re.compile(p) for p in (
    r"^GPIO[A-Z]$", r"^AFIO$", r"^DMA\d*_Channel\d+$", r"^OB$", r"^ESIG$", r"^SysTick$",
    r"^PFIC$", r"^NVIC$")]


def parse_instances(text: str) -> list[tuple[str, str, int]]:
    out = []
    for k, line in enumerate(text.splitlines(), 1):
        m = INSTANCE.match(line)
        if m:
            out.append((m.group(1), m.group(2), k))
    return out


# ---------------------------------------------------------------------------- rows
class Row:
    __slots__ = ("kind", "key", "status", "detail", "cite", "owner")

    def __init__(self, kind: str, key: str, status: str, detail: str, cite: str, owner: str = ""):
        self.kind, self.key, self.status, self.detail, self.cite, self.owner = \
            kind, key, status, detail, cite, owner

    def as_dict(self) -> dict:
        return {"kind": self.kind, "key": self.key, "status": self.status,
                "detail": self.detail, "cite": self.cite, "owner": self.owner}


class Result:
    def __init__(self, part: str, cov: dict):
        self.part = part
        self.cov = cov
        self.rows: list[Row] = []
        self.inventory: dict = {}

    def add(self, *a, **k) -> None:
        self.rows.append(Row(*a, **k))

    def count(self, status: str) -> int:
        return sum(1 for r in self.rows if r.status == status)

    @property
    def open(self) -> list[Row]:
        return [r for r in self.rows if r.status == "open"]


def _decl_list(cov: dict, key: str) -> list[dict]:
    items = cov.get(key) or []
    if not isinstance(items, list):
        raise CoverageError(f"`{key}:` must be a list")
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            raise CoverageError(f"{key}[{i}]: must be a mapping")
        if key in ("absent", "corrections", "disagreements") and not it.get("reason"):
            raise CoverageError(f"{key}[{i}]: needs a `reason:`")
        if key in ("absent", "corrections", "disagreements") and not it.get("source"):
            raise CoverageError(f"{key}[{i}]: needs a `source:` (file:line or a table number)")
    return items


def build(part: str, cov: dict | None = None, doc: dict | None = None) -> Result:
    """The whole ledger for one part. `cov` and `doc` default to the files on disk; the
    self-test passes mutated copies to prove each check can fail."""
    cov = cov or load_coverage(part)
    model = Model(doc if doc is not None else load_mcu(part))
    res = Result(part, cov)
    src = cov["sources"]
    ds_text, ds_path = read_source(src["ds"])
    ds_rel = pathlib.Path(src["ds"]).name
    pin_aliases = {str(k): str(v) for k, v in (cov.get("pin_aliases") or {}).items()}
    extra_noise = [str(x) for x in (cov.get("noise") or [])]
    aliaser = Aliaser(model, cov.get("aliases"))
    absent = _decl_list(cov, "absent")
    corrections = _decl_list(cov, "corrections")
    disagreements = _decl_list(cov, "disagreements")

    # ---- the dictionary of names the mid-token join may produce: the file's own names,
    # every spelling an alias maps onto them, and every complete name either DS reading
    # produced. A join is only made when the joined name is in here and the left half is
    # not, so a torn `I2` + `C4_SMBA` becomes I2C4_SMBA and `A` + `CK4_1` stays torn (and
    # is reported) rather than becoming a name nobody wrote.
    dictionary: set[str] = set()
    for pid, sigs in model.routed.items():
        for sig in sigs:
            dictionary.add(f"{pid}_{sig}")
            dictionary.add(sig)
            for tok in _reverse_names(aliaser, pid, sig):
                dictionary.add(tok)
    tables = cov.get("pin_tables") or []
    if not tables:
        raise CoverageError("`pin_tables:` must list at least one DS pin table")
    for t in tables:
        for r in parse_pin_table(ds_text, t, pin_aliases, dictionary, set(model.pins), extra_noise):
            for base, _, _, _ in r.funcs:
                if "_" in base:
                    dictionary.add(base)

    second: dict[str, set[tuple[str, int | None]]] = {}
    st = cov.get("signal_table")
    if st:
        if st.get("kind") == "pin_grid":
            second = parse_pin_grid(ds_text, st, pin_aliases, dictionary, extra_noise)
        elif st.get("kind") == "signal_rows":
            second = parse_signal_rows(ds_text, st)
        else:
            raise CoverageError("signal_table.kind must be pin_grid or signal_rows")
        for pairs in second.values():
            dictionary |= {b for b, _ in pairs if "_" in b}

    # ---- pin-first reading, over every listed table, with the full dictionary
    rows: list[PinRow] = []
    for t in tables:
        rows += parse_pin_table(ds_text, t, pin_aliases, dictionary, set(model.pins), extra_noise)

    # ---- the parse must account for every io pin the file BONDS, or it is not believed.
    # (Bonded, not declared: CH32V005 inherits CH32V006's die and keeps five pins no
    # package of its own brings out; its table rightly has no row for them.)
    seen_pins = {r.pin for r in rows}
    bonded: set[str] = set()
    for table in (model.doc.get("packages") or {}).values():
        for names in (table or {}).values():
            bonded |= set(str(n) for n in (names if isinstance(names, list) else [names]))
    io = model.io_pins() & bonded
    missing_rows = sorted(io - seen_pins)
    if missing_rows:
        raise CoverageError(
            f"{ds_rel}: the pin-table parse found no row for {len(missing_rows)} io pin(s) the "
            f"file declares - {', '.join(missing_rows[:12])}{' ...' if len(missing_rows) > 12 else ''}. "
            "A parse that cannot see a pin cannot be trusted about its functions; fix the "
            "table bounds, `pin_aliases:` or `noise:` in the coverage file first")
    unknown_rows = sorted({r.pin for r in rows if r.io} - set(model.pins))
    for p in unknown_rows:
        r0 = next(r for r in rows if r.pin == p)
        res.add("pin", f"{p}", "open", f"the DS pin table has a row for `{p}` and the file's "
                f"`pins:` does not declare it", f"{ds_rel}:{r0.line}")

    # ---- apply corrections (torn tokens the conversion produced), then merge readings
    corr: dict[tuple[str, str], dict] = {}
    for c in corrections:
        corr[(str(c.get("pin")), str(c.get("token")))] = c
    used_corr: set[tuple[str, str]] = set()
    first_pairs: dict[str, dict[str, tuple[int | None, int | None, int]]] = collections.defaultdict(dict)
    for r in rows:
        for base, idx, af, ln in r.funcs:
            key = (r.pin, base)
            if key in corr:
                used_corr.add(key)
                for rep in corr[key].get("replace_with") or []:
                    f = _split_func(str(rep))
                    if f:
                        first_pairs[r.pin].setdefault(f[0], (f[1], f[2], ln))
                continue
            first_pairs[r.pin].setdefault(base, (idx, af, ln))
    row_of = {r.pin: r for r in rows}
    # corrections apply to the signal-first reading too, and a signal-first name that
    # only drops the per-pin index the pin-first reading carries (`OPA3_P` for
    # `OPA3_P0`) is the same fact, not a second row
    corrected_second: dict[str, set[tuple[str, int | None]]] = collections.defaultdict(set)
    for pin, pairs in second.items():
        pin = pin_aliases.get(pin, pin)
        for base, af in pairs:
            key = (pin, base)
            if key in corr:
                used_corr.add(key)
                for rep in corr[key].get("replace_with") or []:
                    f = _split_func(str(rep))
                    if f:
                        corrected_second[pin].add((f[0], f[2]))
            else:
                corrected_second[pin].add((base, af))
    second = corrected_second
    for pin, pairs in second.items():
        for base, af in pairs:
            have = first_pairs.get(pin, {})
            if base in have:
                continue
            if any(re.match(re.escape(base) + r"\d+$", h) for h in have):
                continue
            first_pairs[pin].setdefault(base, (None, af, 0))
    for key, c in corr.items():
        if key not in used_corr:
            res.add("declaration", f"correction {key[0]} {key[1]}", "open",
                    "a `corrections:` entry names a token neither DS reading produces any "
                    "more; delete it or fix it", f"data/coverage/{part}.yaml")

    # ---- declared absences, keyed three ways
    abs_tokens: dict[str, dict] = {}
    abs_tok_pin: dict[tuple[str, str], dict] = {}
    abs_chapters: dict[int, dict] = {}
    abs_instances: dict[str, dict] = {}
    abs_patterns: list[tuple[re.Pattern, dict]] = []
    for a in absent:
        if "token" in a:
            tok = str(a["token"])
            if a.get("pin"):
                abs_tok_pin[(str(a["pin"]), tok)] = a
            elif "*" in tok:
                abs_patterns.append((_pattern_to_regex(tok), a))
            else:
                abs_tokens[tok] = a
        elif "chapter" in a:
            abs_chapters[int(a["chapter"])] = a
        elif "instance" in a:
            abs_instances[str(a["instance"])] = a
        else:
            raise CoverageError("absent[]: each entry names a `token:`, `chapter:` or `instance:`")

    def absent_for(pin: str, base: str) -> dict | None:
        if (pin, base) in abs_tok_pin:
            return abs_tok_pin[(pin, base)]
        if base in abs_tokens:
            return abs_tokens[base]
        for rx, a in abs_patterns:
            if rx.match(base):
                return a
        return None

    # ---- forward: every DS function on every pin
    canon_on_pin: dict[str, set[tuple[str, str]]] = collections.defaultdict(set)
    seen_abs: set[int] = set()
    for pin in sorted(first_pairs):
        row = row_of.get(pin)
        is_io = model.pins.get(pin) == "io"
        for base, (idx, af, ln) in sorted(first_pairs[pin].items()):
            cite = f"{ds_rel}:{ln}" if ln else f"{ds_rel} (signal-first table)"
            key = f"{pin} {base}" + (f"_{idx}" if idx is not None else "") + (f"(AF{af})" if af is not None else "")
            a = absent_for(pin, base)
            if a:
                seen_abs.add(id(a))
                res.add("pin", key, "absent", str(a["reason"]), str(a["source"]))
                continue
            cands, how = aliaser.resolve(base)
            if not cands:
                if not is_io and pin not in model.pins:
                    res.add("pin", key, "unread", "a pad the file does not declare as a pin", cite)
                elif not is_io:
                    res.add("pin", key, "unread", f"on the {model.pins.get(pin)} pad `{pin}`; "
                            "not a peripheral function unless an alias says so", cite)
                else:
                    res.add("pin", key, "open", f"no peripheral in the file answers to `{base}` "
                            f"({how}); model it, add an `aliases:` entry, or declare it absent "
                            "with a source", cite)
                continue
            for pid, sig in cands:
                canon_on_pin[pin].add((pid, sig))
            hit = [(pid, sig) for pid, sig in cands if model.routes(pid, sig, pin)]
            if hit:
                pid, sig = hit[0]
                file_af = model.af.get((pid, sig, pin))
                if af is not None and file_af is not None and file_af != af:
                    res.add("pin", key, "open", f"{pid}_{sig} is on {pin} in the file with "
                            f"af: {file_af}, the DS says AF{af}", cite)
                else:
                    res.add("pin", key, "modelled", f"{pid}_{sig} ({how})", cite)
                continue
            # resolved to a name, but not on this pin
            pid, sig = cands[0]
            if pid not in model.routed:
                res.add("pin", key, "open", f"`{base}` resolves to {pid}_{sig} but the file has "
                        f"no peripheral `{pid}`", cite)
            elif sig not in model.routed[pid]:
                have = ", ".join(sorted(model.routed[pid])) or "nothing"
                where = f"; `{pid}` declares pins: {'none' if (model.decl.get(pid) or {}).get('none') else 'open'}" \
                    if model.decl.get(pid) else ""
                res.add("pin", key, "open", f"`{pid}` routes no signal `{sig}` (it routes: {have}){where}", cite)
            else:
                elsewhere = ", ".join(sorted(model.routed[pid][sig]))
                res.add("pin", key, "open", f"{pid}_{sig} is routed in the file, but on {elsewhere}, "
                        f"not on {pin}", cite)

    for a in absent:
        if "token" in a and id(a) not in seen_abs:
            res.add("declaration", f"absent token {a['token']}" + (f" on {a['pin']}" if a.get("pin") else ""),
                    "open", "declared absent, but the DS readings never produce this token; a "
                    "declaration that matches nothing is dead - delete it or fix it",
                    f"data/coverage/{part}.yaml")

    # ---- reverse: every routed (pid, sig, pin) has a DS token on that pin
    for pid in model.pids:
        for sig, pins in model.routed.get(pid, {}).items():
            for pin in sorted(pins):
                if (pid, sig) in canon_on_pin.get(pin, set()):
                    continue
                if pin not in model.pins:
                    continue                      # the validator reports an undeclared pin
                res.add("routing", f"{pid}_{sig} on {pin}", "open",
                        "the file routes it there, but no DS function on that pin resolves to "
                        "it (a wrong pin, a wrong remap index, or a missing alias)",
                        f"data/mcus/{part}.yaml")

    # ---- peripherals: routed, declared none, declared open, or silent
    for pid in model.pids:
        d = model.decl.get(pid)
        if model.has_routing(pid):
            if d:
                res.add("periph", pid, "open", "has routing AND a `pins:` declaration; one of "
                        "them is wrong", f"data/mcus/{part}.yaml")
            continue
        if not d:
            res.add("periph", pid, "open", "routes no pin and declares nothing: add `pins: "
                    "{ none: true, source: ... }` if the silicon gives it no pad, or "
                    "`pins: { open: true, owner: ..., task: ... }` while it is unextracted",
                    f"data/mcus/{part}.yaml")
            continue
        if d.get("open"):
            res.add("periph", pid, "open", f"declared `pins: open` by {d.get('owner', '?')} - "
                    f"{d.get('task', '(no task named)')}", f"data/mcus/{part}.yaml",
                    owner=str(d.get("owner", "")))
            continue
        # declared none: the DS must list nothing for it
        claims = sorted({f"{base} on {pin}" for pin, pairs in canon_on_pin.items()
                         for (p2, _s) in pairs if p2 == pid
                         for base in [b for b in first_pairs.get(pin, {})
                                      if any(x[0] == pid for x in aliaser.resolve(b)[0])]})
        if claims:
            res.add("periph", pid, "open", f"declares `pins: none` but the DS lists "
                    f"{', '.join(claims[:6])}{' ...' if len(claims) > 6 else ''} for it",
                    str(d.get("source") or f"data/mcus/{part}.yaml"))
        else:
            res.add("periph", pid, "absent", "declares `pins: none`; the DS pin table lists no "
                    "function of it, so the claim holds", str(d.get("source") or ""))

    # ---- chapters
    rm_rel = src.get("rm")
    chapters_cfg = cov.get("chapters") or {}
    if rm_rel:
        rm_text, _ = read_source(rm_rel)
        rm_name = pathlib.Path(rm_rel).name
        chapters = parse_chapters(rm_text)
        if not chapters:
            raise CoverageError(f"{rm_name}: no `Chapter N` headings found")
        listed = {int(k) for k in chapters_cfg}
        for n, title, ln in chapters:
            key = f"{n} {title}"
            entry = chapters_cfg.get(n, chapters_cfg.get(str(n)))
            if n in abs_chapters:
                a = abs_chapters[n]
                res.add("chapter", key, "absent", str(a["reason"]), str(a["source"]))
                continue
            if entry is None:
                res.add("chapter", key, "open", "no peripheral is mapped to this chapter and it "
                        "is not declared; add it to `chapters:` or to `absent:`", f"{rm_name}:{ln}")
                continue
            if isinstance(entry, str):
                res.add("chapter", key, "absent", entry, f"{rm_name}:{ln}")
                continue
            pids = entry if isinstance(entry, list) else (entry.get("peripherals") if isinstance(entry, dict) else None)
            if isinstance(entry, dict) and entry.get("not_a_peripheral"):
                res.add("chapter", key, "absent", str(entry["not_a_peripheral"]), f"{rm_name}:{ln}")
                continue
            if not pids:
                res.add("chapter", key, "open", "`chapters:` entry names no peripheral", f"{rm_name}:{ln}")
                continue
            bad = [p for p in pids if p not in model.routed]
            if bad:
                res.add("chapter", key, "open", f"mapped to {', '.join(bad)}, which the file does "
                        "not have", f"{rm_name}:{ln}")
            else:
                res.add("chapter", key, "modelled", ", ".join(pids), f"{rm_name}:{ln}")
        have = {n for n, _, _ in chapters}
        for n in sorted(listed - have):
            res.add("chapter", str(n), "open", "`chapters:` names a chapter this RM does not "
                    "contain", f"data/coverage/{part}.yaml")

    # ---- instances
    hdr_rel = src.get("header")
    inst_cfg = cov.get("instances") or {}
    inst_exact = {str(k): str(v) for k, v in inst_cfg.items() if "*" not in str(k)}
    inst_pat = [(_pattern_to_regex(str(k)), str(v)) for k, v in inst_cfg.items() if "*" in str(k)]
    if hdr_rel:
        hdr_text, _ = read_source(hdr_rel)
        hdr_name = pathlib.Path(hdr_rel).name
        insts = parse_instances(hdr_text)
        if not insts:
            raise CoverageError(f"{hdr_name}: no `#define X ((X_TypeDef *)...)` instances found")
        for name, typedef, ln in insts:
            if any(rx.match(name) for rx in BUILTIN_INSTANCE_IGNORE):
                continue
            if name in abs_instances:
                a = abs_instances[name]
                res.add("instance", name, "absent", str(a["reason"]), str(a["source"]))
                continue
            target = inst_exact.get(name)
            if target is None:
                for rx, v in inst_pat:
                    if rx.match(name):
                        target = v
                        break
            if target is None and name in model.routed:
                target = name
            if target is None:
                res.add("instance", name, "open", f"`{name}` ({typedef}) is an instance the SDK "
                        "defines and no peripheral of the file; map it in `instances:` or "
                        "declare it absent", f"{hdr_name}:{ln}")
            elif target not in model.routed:
                res.add("instance", name, "open", f"`instances:` maps it to `{target}`, which "
                        "the file does not have", f"{hdr_name}:{ln}")
            else:
                res.add("instance", name, "modelled", target, f"{hdr_name}:{ln}")

    # ---- resources
    for i, r in enumerate(cov.get("resources") or []):
        if not isinstance(r, dict) or not all(k in r for k in ("name", "count", "match", "source")):
            raise CoverageError(f"resources[{i}]: needs name, count, match, source")
        rx = re.compile(str(r["match"]))
        got = sorted(p for p in model.pids if rx.match(p))
        if len(got) == int(r["count"]):
            res.add("resource", str(r["name"]), "modelled", f"{len(got)}: {', '.join(got)}", str(r["source"]))
        else:
            res.add("resource", str(r["name"]), "open", f"the DS says {r['count']}, the file has "
                    f"{len(got)} ({', '.join(got) or 'none'})", str(r["source"]))

    # ---- the two DS readings, against each other. Compared by what each token RESOLVES
    # to, so a naming difference the aliases already absorb (`SWP_RX` / `SWPMI_RX`) is not
    # a disagreement, and a signal-first name that drops the per-pin index (`OPA3_OUT`
    # for `OPA3_OUT0`) counts as agreement. What is left is the silicon read two ways
    # with different answers, and that is recorded, never averaged.
    if second:
        declared = {(str(d.get("pin")), str(d.get("token"))): d for d in disagreements}
        used: set[tuple[str, str]] = set()
        first_only, second_only = [], []

        def canon(tok: str) -> str:
            cands, _how = aliaser.resolve(tok)
            return "|".join(sorted(f"{p}_{s}" for p, s in cands)) if cands else tok

        sec_pairs: dict[str, set[str]] = collections.defaultdict(set)
        for pin, pairs in second.items():
            sec_pairs[pin_aliases.get(pin, pin)] |= {b for b, _ in pairs}
        pf_pairs: dict[str, set[str]] = collections.defaultdict(set)
        for r in rows:
            for base, _, _, _ in r.funcs:
                if base in r.own:
                    continue
                key = (r.pin, base)
                if key in corr:
                    for rep in corr[key].get("replace_with") or []:
                        f = _split_func(str(rep))
                        if f:
                            pf_pairs[r.pin].add(f[0])
                else:
                    pf_pairs[r.pin].add(base)

        def agrees(base: str, others: set[str]) -> bool:
            if base in others:
                return True
            c = canon(base)
            for o in others:
                if canon(o) == c:
                    return True
                if re.match(re.escape(o) + r"\d+$", base) or re.match(re.escape(base) + r"\d+$", o):
                    return True
            return False

        for pin in sorted(set(pf_pairs) | set(sec_pairs)):
            # only pins this part bonds: a shared signal-first table (CH32V006/V005's
            # Table 2-3) lists pads the smaller part's own pin table rightly has no row for
            if model.pins.get(pin) != "io" or pin not in bonded:
                continue
            for base in sorted(pf_pairs[pin]):
                if not agrees(base, sec_pairs[pin]):
                    first_only.append((pin, base))
            for base in sorted(sec_pairs[pin]):
                if not agrees(base, pf_pairs[pin]):
                    second_only.append((pin, base))
        for pin, base in first_only + second_only:
            side = "pin-first only" if (pin, base) in first_only else "signal-first only"
            if absent_for(pin, base):
                continue
            d = declared.get((pin, base))
            if d:
                used.add((pin, base))
                res.add("disagreement", f"{pin} {base}", "disagreement",
                        f"{side}: {d['reason']}", str(d["source"]))
            else:
                res.add("disagreement", f"{pin} {base}", "open",
                        f"the DS's two readings differ ({side}); record it in `disagreements:` "
                        "with a source, or fix the parse with `corrections:`",
                        f"{ds_rel}")
        for key, d in declared.items():
            if key not in used:
                res.add("declaration", f"disagreement {key[0]} {key[1]}", "open",
                        "declared, but the two readings agree on it now; delete the entry",
                        f"data/coverage/{part}.yaml")

    res.inventory = {
        "pin_functions": [
            {"pin": r.pin, "token": base, "index": idx, "af": af, "line": ln}
            for r in rows if r.io for base, idx, af, ln in r.funcs
        ],
        "signal_first": {pin: sorted(f"{b}" + (f"(AF{af})" if af is not None else "") for b, af in pairs)
                         for pin, pairs in sorted(second.items())},
        "chapters": [{"n": n, "title": t, "line": ln} for n, t, ln in
                     (parse_chapters(read_source(rm_rel)[0]) if rm_rel else [])],
        "instances": [{"name": n, "typedef": t, "line": ln} for n, t, ln in
                      (parse_instances(read_source(hdr_rel)[0]) if hdr_rel else [])],
    }
    return res


def _reverse_names(aliaser: Aliaser, pid: str, sig: str) -> set[str]:
    """DS tokens that would resolve to (pid, sig): the exact alias keys and the patterns
    inverted, plus the literal and family spellings. Used only to seed the join dictionary."""
    out = {f"{pid}_{sig}"}
    full = f"{pid}_{sig}"
    for key, vals in aliaser.exact.items():
        if full in vals:
            out.add(key)
    for rx, vals, key in aliaser.patterns:
        for v in vals:
            trx = _pattern_to_regex(re.sub(r"\{\d+\}", "*", v))
            m = trx.match(full)
            if m:
                filled = _fill(key, m.groups())
                if filled:
                    out.add(filled)
    base = re.sub(r"\d+$", "", pid)
    out.add(f"{base}_{sig}")
    return out


# ---------------------------------------------------------------------------- gate
def tasks_text() -> str:
    return TASKS_MD.read_text(encoding="utf-8") if TASKS_MD.is_file() else ""


def verdict(res: Result) -> tuple[bool, str]:
    """(ok, message) for one part against its declared status."""
    cov = res.cov
    n_open = len(res.open)
    if cov["status"] == "complete":
        if n_open == 0:
            return True, "complete, 0 open"
        return False, f"declared complete but {n_open} row(s) are OPEN"
    # in_extraction
    recorded = int(cov["open_rows"])
    task = str(cov["task"])
    problems = []
    if task not in tasks_text():
        problems.append(f"its task line is not in TASKS.md: \"{task}\"")
    if n_open > recorded:
        problems.append(f"REGRESSION: {n_open} open rows, {recorded} recorded - {n_open - recorded} "
                        "new gap(s) were introduced; close them, do not raise the number")
    elif n_open < recorded:
        problems.append(f"{n_open} open rows but open_rows: {recorded} - lower it to {n_open} "
                        "(the count may only go down, and it must be current)")
    if problems:
        return False, "; ".join(problems)
    return True, f"in_extraction ({cov.get('owner')}), {n_open} open, tracked"


def safe(text: str) -> str:
    enc = getattr(sys.stdout, "encoding", None) or "ascii"
    return str(text).encode(enc, "replace").decode(enc, "replace")
