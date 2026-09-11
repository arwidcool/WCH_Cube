#!/usr/bin/env python3
"""
validate_mcu.py -- AGENT-1 (DATA). Schema and consistency checks for MCU YAML files.

Usage:
    python tools/validate_mcu.py                     # every data/mcus/*.yaml
    python tools/validate_mcu.py data/mcus/X.yaml    # just these
    python tools/validate_mcu.py --quiet             # only print problems

Exit codes:  0 = all files valid   1 = at least one ERROR   2 = usage / file / parse error

WARNINGs do not fail the run. ERRORs do. Nothing here lowers a threshold to pass; if a
check cannot be evaluated (missing optional data) it is skipped and reported as skipped.

The checks exist because each one has already caught, or would have caught, a real fault:

  choice-keys      An unquoted comma inside a YAML flow mapping silently truncates the
                   name and turns the rest into null-valued keys:
                       { name: RST enabled, ignore 12 ms (RST_MODE=10), signals: [RST] }
                   parses as name="RST enabled" plus a junk key. Three such choices
                   collapse to the same name, and the app keys its per-setting state by
                   choice name, so two settings silently become one. The file still
                   parses, so only a key whitelist catches it.
  signal-parity    Every remap of a peripheral must offer the same signal set, otherwise
                   selecting a remap silently drops a signal the settings still request.
  pin-exists       A remap or package pin that is not declared in `pins:` renders as a
                   blank pad and claims nothing.
  io-count         Guards the package tables against a dropped or duplicated row: the
                   count must equal the I/O number the datasheet's model table states.
  exti-line        AFIO_EXTICR line x can only reach pin number x. A copy-paste that
                   points EXTI3 at PA4 is invisible by eye.
"""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MCU_DIR = ROOT / "data" / "mcus"

CHOICE_KEYS = {"name", "signals", "default"}
SETTING_KEYS = {"name", "type", "choices", "notes"}
PIN_KEYS = {"type", "analog", "notes", "five_volt_tolerant", "drive"}
# The app treats every type other than "io" as a fixed-function pad that cannot be
# assigned (template.html, pin click handler). The whitelist exists to catch typos, not
# to restrict the data, so add to it when a part genuinely needs a new pad type.
PIN_TYPES = {"io", "power", "ground", "reset", "boot"}


class Report:
    def __init__(self, path):
        self.path = path
        self.errors = []
        self.warnings = []
        self.skipped = []

    def err(self, check, msg):
        self.errors.append((check, msg))

    def warn(self, check, msg):
        self.warnings.append((check, msg))

    def skip(self, check, msg):
        self.skipped.append((check, msg))


def names_of(entry):
    """A package pin slot is either one name or a list of internally shorted names."""
    return entry if isinstance(entry, list) else [entry]


# ---------------------------------------------------------------------------- checks

def check_structure(doc, r):
    for key in ("mcu", "packages", "pins", "peripherals"):
        if key not in doc:
            r.err("structure", "missing required top-level key: " + key)
    mcu = doc.get("mcu") or {}
    if not mcu.get("name"):
        r.err("structure", "mcu.name is missing")
    pkgs = doc.get("packages") or {}
    dflt = mcu.get("default_package")
    if dflt and dflt not in pkgs:
        r.err("structure", "mcu.default_package " + repr(dflt) + " is not in packages")


def check_pins(doc, r):
    for name, spec in (doc.get("pins") or {}).items():
        spec = spec or {}
        if not isinstance(spec, dict):
            r.err("pins", name + ": entry is not a mapping")
            continue
        unknown = set(spec) - PIN_KEYS
        if unknown:
            r.err("pins", name + ": unknown key(s) " + ", ".join(sorted(unknown))
                  + " -- usually an unquoted comma inside { }")
        t = spec.get("type")
        if t not in PIN_TYPES:
            r.err("pins", name + ": type " + repr(t) + " not one of " + ", ".join(sorted(PIN_TYPES)))


def check_packages(doc, r):
    declared = set(doc.get("pins") or {})
    for pkg, table in (doc.get("packages") or {}).items():
        if not isinstance(table, dict) or not table:
            r.err("packages", pkg + ": empty or not a mapping")
            continue
        nums = sorted(table)
        for n in nums:
            if not isinstance(n, int):
                r.err("packages", pkg + ": pin key " + repr(n) + " is not an integer")
        nums = [n for n in nums if isinstance(n, int)]
        if not nums:
            continue

        numbered = [n for n in nums if n > 0]
        expected = list(range(1, len(numbered) + 1))
        if numbered != expected:
            missing = sorted(set(expected) - set(numbered))
            extra = sorted(set(numbered) - set(expected))
            r.err("packages", pkg + ": pin numbers are not 1.." + str(len(numbered))
                  + (" (missing " + str(missing) + ")" if missing else "")
                  + (" (unexpected " + str(extra) + ")" if extra else ""))
        if 0 in nums and names_of(table[0]) != ["VSS"]:
            r.warn("packages", pkg + ": pin 0 is the exposed pad and is normally VSS, found "
                   + str(table[0]))

        seen = {}
        for n in nums:
            for name in names_of(table[n]):
                if name not in declared:
                    r.err("pin-exists", pkg + " pin " + str(n) + ": " + name
                          + " is not declared in pins:")
                if name.startswith("P"):
                    if name in seen:
                        r.err("packages", pkg + ": " + name + " appears on pin "
                              + str(seen[name]) + " and pin " + str(n))
                    seen[name] = n


def check_io_counts(doc, r):
    """Package I/O count must match the DS model table (variants[*].io_count)."""
    pins = doc.get("pins") or {}
    variants = (doc.get("mcu") or {}).get("variants") or {}
    stated = {}
    for vname, v in variants.items():
        if not isinstance(v, dict) or "io_count" not in v:
            continue
        stated.setdefault(v.get("package"), {})[vname] = v["io_count"]
    if not stated:
        r.skip("io-count", "no variant declares io_count; nothing to compare against")
        return

    for pkg, table in (doc.get("packages") or {}).items():
        if pkg not in stated:
            r.warn("io-count", pkg + ": no variant with io_count uses this package")
            continue
        count = 0
        for n, entry in table.items():
            if not isinstance(n, int) or n == 0:
                continue          # exposed pad is never an I/O
            if all((pins.get(name) or {}).get("type") == "io" for name in names_of(entry)):
                count += 1
        for vname, want in sorted(stated[pkg].items()):
            if count != want:
                r.err("io-count", pkg + ": counted " + str(count) + " I/O pins, but "
                      + vname + " states " + str(want) + " in the DS model table")


def check_peripherals(doc, r):
    declared = set(doc.get("pins") or {})
    packages = set(doc.get("packages") or {})

    for pid, P in (doc.get("peripherals") or {}).items():
        P = P or {}
        settings = P.get("settings") or []
        remaps = P.get("remaps") or []

        # ---- settings and choices
        seen_settings = set()
        used_signals = set()
        for s in settings:
            if not isinstance(s, dict) or "name" not in s:
                r.err("settings", pid + ": a setting has no name")
                continue
            unknown = set(s) - SETTING_KEYS
            if unknown:
                r.err("settings", pid + "." + str(s["name"]) + ": unknown setting key(s) "
                      + ", ".join(sorted(unknown)))
            if s["name"] in seen_settings:
                r.err("settings", pid + ": duplicate setting name " + repr(s["name"]))
            seen_settings.add(s["name"])

            choices = s.get("choices") or []
            if not choices:
                r.err("settings", pid + "." + str(s["name"]) + ": no choices")
                continue
            seen_choices = set()
            ndefault = 0
            for c in choices:
                if not isinstance(c, dict) or "name" not in c:
                    r.err("choice-keys", pid + "." + str(s["name"])
                          + ": a choice has no name")
                    continue
                unknown = set(c) - CHOICE_KEYS
                if unknown:
                    r.err("choice-keys", pid + "." + str(s["name"]) + " choice "
                          + repr(c["name"]) + ": unknown key(s) "
                          + ", ".join(repr(u) for u in sorted(unknown))
                          + " -- an unquoted comma inside { } truncates the name")
                if c["name"] in seen_choices:
                    r.err("choice-keys", pid + "." + str(s["name"])
                          + ": duplicate choice name " + repr(c["name"])
                          + " -- the app keys its state by choice name")
                seen_choices.add(c["name"])
                if c.get("default"):
                    ndefault += 1
                for sig in (c.get("signals") or []):
                    used_signals.add(sig)
            if ndefault > 1:
                r.err("settings", pid + "." + str(s["name"]) + ": "
                      + str(ndefault) + " choices marked default")

        # ---- remaps
        if not remaps:
            if used_signals:
                r.err("signal-parity", pid + ": choices request signals ("
                      + ", ".join(sorted(used_signals)) + ") but the peripheral has no remaps")
            continue

        sigsets = []
        for i, rm in enumerate(remaps):
            if not isinstance(rm, dict) or "name" not in rm:
                r.err("remaps", pid + " remap " + str(i) + ": missing name")
                continue
            pinmap = rm.get("pins")
            if not isinstance(pinmap, dict) or not pinmap:
                r.err("remaps", pid + " remap " + repr(rm.get("name")) + ": no pins")
                continue
            sigsets.append((rm["name"], set(pinmap)))
            for sig, pin in pinmap.items():
                if pin not in declared:
                    r.err("pin-exists", pid + "." + sig + " remap " + repr(rm["name"])
                          + ": pin " + repr(pin) + " is not declared in pins:")

        if sigsets:
            base_name, base = sigsets[0]
            for name, s in sigsets[1:]:
                if s != base:
                    only_base = sorted(base - s)
                    only_s = sorted(s - base)
                    r.err("signal-parity", pid + ": remap " + repr(name)
                          + " does not offer the same signals as " + repr(base_name)
                          + (" (missing " + ", ".join(only_base) + ")" if only_base else "")
                          + (" (extra " + ", ".join(only_s) + ")" if only_s else ""))
            unknown = used_signals - base
            if unknown:
                r.err("signal-parity", pid + ": choices reference signal(s) "
                      + ", ".join(sorted(unknown)) + " that no remap provides")
            unused = base - used_signals
            if unused:
                r.warn("signal-parity", pid + ": remap signal(s) "
                       + ", ".join(sorted(unused)) + " are never requested by any choice")

        # ---- remap_by_package
        rbp = P.get("remap_by_package")
        if rbp:
            for pkg, idx in rbp.items():
                if pkg not in packages:
                    r.err("remaps", pid + ".remap_by_package: unknown package " + repr(pkg))
                if not isinstance(idx, int) or not (0 <= idx < len(remaps)):
                    r.err("remaps", pid + ".remap_by_package[" + str(pkg) + "] = "
                          + repr(idx) + " is out of range (0.." + str(len(remaps) - 1) + ")")
            missing = packages - set(rbp)
            if missing:
                r.warn("remaps", pid + ".remap_by_package does not cover "
                       + ", ".join(sorted(missing)))


def check_exti(doc, r):
    exti = doc.get("exti")
    if not exti:
        r.skip("exti-line", "no exti: block in this file")
        return
    declared = set(doc.get("pins") or {})
    for line, ports in (exti.get("lines") or {}).items():
        digits = "".join(ch for ch in str(line) if ch.isdigit())
        if not digits:
            r.err("exti-line", str(line) + ": cannot read a line number from the key")
            continue
        want = digits[-1]
        for value, pin in (ports or {}).items():
            if pin not in declared:
                r.err("pin-exists", str(line) + " [" + str(value) + "]: pin " + repr(pin)
                      + " is not declared in pins:")
                continue
            if not pin.endswith(want):
                r.err("exti-line", str(line) + " [" + str(value) + "] = " + pin
                      + ": AFIO_EXTICR line " + want + " can only reach pin number " + want)


def check_dma(doc, r):
    dma = doc.get("dma")
    if not dma:
        r.skip("dma", "no dma: block in this file")
        return
    n = dma.get("channels")
    if not isinstance(n, int) or n < 1:
        r.err("dma", "dma.channels must be a positive integer, got " + repr(n))
        return
    for ch, reqs in (dma.get("requests") or {}).items():
        if not isinstance(ch, int) or not (1 <= ch <= n):
            r.err("dma", "request channel " + repr(ch) + " is outside 1.." + str(n))
        if not reqs:
            r.warn("dma", "channel " + str(ch) + " has no requests")


def check_clock(doc, r):
    clock = doc.get("clock")
    if not clock:
        r.skip("clock", "no clock: block in this file")
        return
    pres = clock.get("prescalers") or {}
    # A prescaler may hang off another prescaler (ADC off HB), off a raw oscillator, or
    # straight off the PLL / system clock (USB off PLLCLK on the dummy part).
    valid_sources = set(pres) | set(clock.get("sources") or {}) | {"PLLCLK", "SYSCLK"}
    for name, spec in pres.items():
        src = (spec or {}).get("source")
        if src and src not in valid_sources:
            r.err("clock", "prescaler " + str(name) + ": source " + repr(src)
                  + " is not a prescaler, a clock source, PLLCLK or SYSCLK")
        opts = (spec or {}).get("options") or []
        if opts and sorted(opts) != list(opts):
            r.warn("clock", "prescaler " + str(name) + ": options are not in ascending order")
    for src in (clock.get("sysclk") or {}).get("sources") or []:
        if src not in (clock.get("sources") or {}) and src != "PLLCLK":
            r.err("clock", "sysclk source " + repr(src) + " is not a declared clock source")


CHECKS = [check_structure, check_pins, check_packages, check_io_counts,
          check_peripherals, check_exti, check_dma, check_clock]


def validate(path, quiet=False):
    import yaml
    r = Report(path)
    try:
        doc = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except Exception as e:
        print(str(path) + ": YAML PARSE ERROR: " + str(e))
        return None
    if not isinstance(doc, dict):
        print(str(path) + ": top level is not a mapping")
        return None

    for fn in CHECKS:
        fn(doc, r)

    name = (doc.get("mcu") or {}).get("name") or Path(path).stem
    status = "FAIL" if r.errors else ("ok" if not r.warnings else "ok (warnings)")
    if not quiet or r.errors or r.warnings:
        print("\n" + name + "  [" + status + "]  " + str(path))
    for check, msg in r.errors:
        print("  ERROR   " + check.ljust(14) + " " + msg)
    for check, msg in r.warnings:
        print("  warning " + check.ljust(14) + " " + msg)
    if not quiet:
        for check, msg in r.skipped:
            print("  skipped " + check.ljust(14) + " " + msg)
    return r


def main():
    ap = argparse.ArgumentParser(description="Validate MCU YAML files.")
    ap.add_argument("files", nargs="*", help="default: every data/mcus/*.yaml")
    ap.add_argument("--quiet", action="store_true", help="print only files with findings")
    args = ap.parse_args()

    try:
        import yaml  # noqa: F401
    except ImportError:
        print("PyYAML is required:  pip install pyyaml", file=sys.stderr)
        return 2

    files = [Path(f) for f in args.files] or sorted(MCU_DIR.glob("*.yaml"))
    if not files:
        print("no MCU files found under " + str(MCU_DIR), file=sys.stderr)
        return 2

    reports, broken = [], 0
    for f in files:
        if not f.exists():
            print(str(f) + ": no such file", file=sys.stderr)
            return 2
        rep = validate(f, args.quiet)
        if rep is None:
            broken += 1
        else:
            reports.append(rep)

    nerr = sum(len(r.errors) for r in reports)
    nwarn = sum(len(r.warnings) for r in reports)
    print("\n" + str(len(files)) + " file(s): " + str(nerr) + " error(s), "
          + str(nwarn) + " warning(s)"
          + (", " + str(broken) + " unparseable" if broken else ""))
    if broken:
        return 2
    return 1 if nerr else 0


if __name__ == "__main__":
    raise SystemExit(main())
