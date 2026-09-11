#!/usr/bin/env python3
"""Validate data/mcus/*.yaml against the format the app actually relies on.

    python tools/validate_mcu.py                    # every bundled MCU
    python tools/validate_mcu.py data/mcus/X.yaml   # just one
    python tools/validate_mcu.py --strict           # warnings count as failures
    python tools/validate_mcu.py --quiet            # only problems, no summary

Exit code 0 = clean.  1 = at least one ERROR (or a WARN under --strict).

What it checks
  schema             required keys and value types, per the format header in
                     data/mcus/WCH-DUMMY32-C8.yaml
  packages           the package id has a geometry in data/packages/packages.yaml,
                     pin numbers are 1..N with no gaps or duplicates, N matches the
                     geometry, pin 0 is the exposed pad and only on packages that have one
  pin-existence      every pin named in a remap table, in a package map, or in the EXTI
                     table exists in `pins:`
  remap-consistency  every signal a setting can ask for is routed by at least one remap,
                     every remap_by_package index is in range, and remap tables agree
                     with each other about which signals they carry
  I/O counts         mcu.variants[*].io_count vs the io pins actually in that package
                     table (a shorted pair counts once) - catches a dropped or
                     duplicated row in `packages:`
  clock              every source/prescaler reference points at a node that exists

Output is deliberately ASCII only: the Windows console here is cp1252 and chokes
on arrows and box characters.
"""
from __future__ import annotations

import argparse
import glob
import os
import pathlib
import sys

try:
    import yaml
except ImportError:
    sys.exit("validate_mcu: PyYAML is required.  pip install pyyaml")

ROOT = pathlib.Path(__file__).resolve().parent.parent
PACKAGES_YAML = ROOT / "data" / "packages" / "packages.yaml"

PIN_TYPES = {"io", "power", "ground", "reset", "boot", "sys", "nc", "analog"}
SETTING_TYPES = {"choice", "checkboxes"}

# Key whitelists. These exist for one specific failure, which has already happened four
# times in this repo: a YAML flow mapping treats a comma as a field separator, so an
# unquoted comma inside { } silently truncates the value and turns the remainder into a
# null-valued key.
#
#     - { name: IN8 (Vrefint, internal) }     parses as  {name: "IN8 (Vrefint",
#                                                         "internal)": None}
#
# The file still parses and the app still loads, so nothing else catches it. Worse, the
# app keys per-setting state by choice NAME, so two choices whose names both truncate to
# the same string silently collapse into one. An unknown key is the only reliable tell.
CHOICE_KEYS = {"name", "signals", "default"}
SETTING_KEYS = {"name", "type", "choices", "notes"}
PIN_ENTRY_KEYS = {"type", "analog", "notes", "five_volt_tolerant", "drive"}


def unknown_keys(mapping, allowed):
    return sorted(k for k in mapping if k not in allowed)


class Report:
    """Collects problems for one file and prints them grouped."""

    def __init__(self, path: pathlib.Path):
        self.path = path
        self.errors: list[str] = []
        self.warns: list[str] = []

    def error(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}: {msg}")

    def warn(self, where: str, msg: str) -> None:
        self.warns.append(f"{where}: {msg}")

    @staticmethod
    def _safe(text: str) -> str:
        """The YAML contains arrows and dashes; this console is cp1252."""
        enc = getattr(sys.stdout, "encoding", None) or "ascii"
        return str(text).encode(enc, "replace").decode(enc, "replace")

    def print(self, quiet: bool = False) -> None:
        rel = os.path.relpath(self.path, ROOT).replace("\\", "/")
        if not self.errors and not self.warns:
            if not quiet:
                print(f"  OK    {rel}")
            return
        print(f"  {'FAIL' if self.errors else 'warn'}  {rel}")
        for e in self.errors:
            print(f"          ERROR  {self._safe(e)}")
        for w in self.warns:
            print(f"          warn   {self._safe(w)}")


def load_geometries() -> dict:
    if not PACKAGES_YAML.exists():
        return {}
    doc = yaml.safe_load(PACKAGES_YAML.read_text(encoding="utf-8")) or {}
    return {p["id"]: p for p in doc.get("packages", []) if isinstance(p, dict) and "id" in p}


def names_of(value) -> list[str]:
    """A package row is either one name or a list of internally shorted names."""
    return [str(v) for v in value] if isinstance(value, list) else [str(value)]


def check_mcu_block(doc: dict, r: Report) -> None:
    mcu = doc.get("mcu")
    if not isinstance(mcu, dict):
        r.error("mcu", "missing or not a mapping")
        return
    for key in ("name", "vendor", "family", "core", "default_package"):
        if not mcu.get(key):
            r.error("mcu", f"missing `{key}`")
    for key in ("flash_kb", "sram_kb"):
        if not isinstance(mcu.get(key), (int, float)):
            r.error("mcu", f"`{key}` must be a number")
    packages = doc.get("packages") or {}
    default = mcu.get("default_package")
    if default and default not in packages:
        r.error("mcu.default_package", f"`{default}` is not in `packages:` ({', '.join(packages)})")

    variants = mcu.get("variants") or {}
    if variants and not isinstance(variants, dict):
        r.error("mcu.variants", "must be a mapping of part number -> info")
        return
    for part, info in (variants or {}).items():
        if not isinstance(info, dict):
            r.error(f"mcu.variants.{part}", "must be a mapping")
            continue
        pkg = info.get("package")
        if not pkg:
            r.error(f"mcu.variants.{part}", "missing `package`")
        elif pkg not in packages:
            r.error(f"mcu.variants.{part}", f"package `{pkg}` is not in `packages:`")


def check_packages(doc: dict, geom: dict, r: Report) -> dict:
    """Returns {package: {pin_number: [names]}} for the checks that follow."""
    packages = doc.get("packages")
    if not isinstance(packages, dict) or not packages:
        r.error("packages", "missing or empty")
        return {}
    pins_map = doc.get("pins") or {}
    out = {}

    for pkg, table in packages.items():
        where = f"packages.{pkg}"
        if not isinstance(table, dict) or not table:
            r.error(where, "missing or empty pin table")
            continue

        numbers = []
        for raw in table:
            try:
                numbers.append(int(raw))
            except (TypeError, ValueError):
                r.error(where, f"pin key `{raw}` is not a number")
        out[pkg] = {int(k): names_of(v) for k, v in table.items() if str(k).lstrip("-").isdigit()}

        body = sorted(n for n in numbers if n != 0)
        if body:
            expected = list(range(1, len(body) + 1))
            if body != expected:
                missing = sorted(set(expected) - set(body))
                extra = sorted(set(body) - set(expected))
                bits = []
                if missing:
                    bits.append(f"missing {missing[:8]}")
                if extra:
                    bits.append(f"unexpected {extra[:8]}")
                dupes = sorted({n for n in body if body.count(n) > 1})
                if dupes:
                    bits.append(f"duplicated {dupes[:8]}")
                r.error(where, "pin numbers must be 1.." + str(len(body)) + " with no gaps - " + "; ".join(bits))

        g = geom.get(pkg)
        if not g:
            r.error(where, f"no geometry for `{pkg}` in data/packages/packages.yaml - the chip cannot be drawn")
        else:
            if g.get("pins") != len(body):
                r.error(where, f"has {len(body)} pins but geometry `{pkg}` is {g.get('pins')}-pin")
            if 0 in numbers and not g.get("epad"):
                r.warn(where, "declares pin 0 (exposed pad) but the geometry has no `epad: true`")
            if g.get("epad") and 0 not in numbers:
                r.warn(where, f"geometry `{pkg}` has an exposed pad but the table has no pin 0")

        # every name must be declared in `pins:`
        seen: dict[str, list[int]] = {}
        for num, names in out[pkg].items():
            for n in names:
                if n not in pins_map:
                    r.error(where, f"pin {num} is `{n}`, which is not declared in `pins:`")
                seen.setdefault(n, []).append(num)

        # the engine keys state by pin NAME, so a name on two physical pins is ambiguous
        for name, nums in seen.items():
            if len(nums) > 1:
                kind = (pins_map.get(name) or {}).get("type", "io")
                msg = (f"`{name}` is on {len(nums)} physical pins {sorted(nums)} - the app keys pins by name, "
                       f"so only pin {sorted(nums)[0]} is reachable")
                if kind == "io":
                    r.error(where, msg)
                else:
                    r.warn(where, msg)

    return out


def check_pins(doc: dict, tables: dict, r: Report) -> None:
    pins = doc.get("pins")
    if not isinstance(pins, dict) or not pins:
        r.error("pins", "missing or empty")
        return
    bonded = {n for table in tables.values() for names in table.values() for n in names}
    for name, info in pins.items():
        where = f"pins.{name}"
        if info is None:
            r.warn(where, "empty entry; give it at least a `type`")
            continue
        if not isinstance(info, dict):
            r.error(where, "must be a mapping, e.g. { type: io }")
            continue
        kind = info.get("type", "io")
        if kind not in PIN_TYPES:
            r.error(where, f"unknown type `{kind}` (known: {', '.join(sorted(PIN_TYPES))})")
        stray = unknown_keys(info, PIN_ENTRY_KEYS)
        if stray:
            r.error(where, f"unknown key(s) {stray} - almost always an unquoted comma "
                           f"inside {{ }}, which truncates the value before it")
        if name not in bonded:
            r.warn(where, "declared but not bonded on any package")


def check_peripherals(doc: dict, r: Report) -> None:
    periphs = doc.get("peripherals")
    if not isinstance(periphs, dict) or not periphs:
        r.error("peripherals", "missing or empty")
        return
    pins_map = doc.get("pins") or {}
    packages = doc.get("packages") or {}

    for pid, P in periphs.items():
        where = f"peripherals.{pid}"
        if not isinstance(P, dict):
            r.error(where, "must be a mapping")
            continue
        if not P.get("category"):
            r.warn(where, "no `category`; it will not appear under a heading in the tree")

        remaps = P.get("remaps") or []
        if remaps and not isinstance(remaps, list):
            r.error(f"{where}.remaps", "must be a list")
            remaps = []

        routed: set[str] = set()
        for i, remap in enumerate(remaps):
            rw = f"{where}.remaps[{i}]"
            if not isinstance(remap, dict):
                r.error(rw, "must be a mapping with `name` and `pins`")
                continue
            if not remap.get("name"):
                r.warn(rw, "has no `name`; the UI shows an empty remap label")
            table = remap.get("pins")
            if not isinstance(table, dict) or not table:
                r.error(rw, "missing `pins:` mapping (signal -> pin)")
                continue
            for signal, pin in table.items():
                routed.add(str(signal))
                if pin is None:
                    r.error(rw, f"signal `{signal}` has no pin")
                elif str(pin) not in pins_map:
                    r.error(rw, f"signal `{signal}` is routed to `{pin}`, which is not declared in `pins:`")

        # every signal a setting can turn on must be routed somewhere
        wanted: set[str] = set()
        for j, s in enumerate(P.get("settings") or []):
            sw = f"{where}.settings[{j}]"
            if not isinstance(s, dict):
                r.error(sw, "must be a mapping")
                continue
            if not s.get("name"):
                r.error(sw, "missing `name`")
            stype = s.get("type", "choice")
            if stype not in SETTING_TYPES:
                r.error(sw, f"unknown type `{stype}` (known: {', '.join(sorted(SETTING_TYPES))})")
            choices = s.get("choices")
            if not isinstance(choices, list) or not choices:
                r.error(sw, "missing `choices`")
                continue
            defaults = [c for c in choices if isinstance(c, dict) and c.get("default")]
            if len(defaults) > 1:
                r.error(sw, f"{len(defaults)} choices marked `default: true`; at most one")
            stray = unknown_keys(s, SETTING_KEYS)
            if stray:
                r.error(sw, f"unknown key(s) {stray} - almost always an unquoted comma "
                            f"inside {{ }}, which truncates the value before it")
            seen_choices: dict[str, int] = {}
            for k, c in enumerate(choices):
                if not isinstance(c, dict) or not c.get("name"):
                    r.error(f"{sw}.choices[{k}]", "each choice needs a `name`")
                    continue
                stray = unknown_keys(c, CHOICE_KEYS)
                if stray:
                    r.error(f"{sw}.choices[{k}]",
                            f"`{c['name']}` has unknown key(s) {stray} - an unquoted comma "
                            f"inside {{ }} truncates the name; quote it")
                first = seen_choices.get(str(c["name"]))
                if first is not None:
                    r.error(f"{sw}.choices[{k}]",
                            f"name `{c['name']}` is already used by choices[{first}]; the "
                            f"engine keys this setting's state by choice name, so the two "
                            f"collapse into one")
                seen_choices[str(c["name"])] = k
                for sig in c.get("signals") or []:
                    wanted.add(str(sig))
            # the engine treats choices[0] as the off state (isEnabled/resetPin rely on it)
            if stype == "choice" and isinstance(choices[0], dict) and choices[0].get("signals"):
                r.warn(sw, f"first choice `{choices[0].get('name')}` carries signals; the engine treats "
                           f"choices[0] as the off state, so the peripheral will look permanently enabled")

        for sig in sorted(wanted - routed):
            if remaps:
                r.error(where, f"signal `{sig}` can be selected but no remap routes it")

        rbp = P.get("remap_by_package") or {}
        if rbp and not isinstance(rbp, dict):
            r.error(f"{where}.remap_by_package", "must be a mapping package -> remap index")
        else:
            for pkg, idx in rbp.items():
                if pkg not in packages:
                    r.error(f"{where}.remap_by_package", f"`{pkg}` is not a package of this MCU")
                if not isinstance(idx, int) or not (0 <= idx < max(len(remaps), 1)):
                    r.error(f"{where}.remap_by_package.{pkg}",
                            f"remap index {idx} is out of range (0..{len(remaps) - 1})")


def check_io_counts(doc: dict, tables: dict, r: Report) -> None:
    """mcu.variants[*].io_count vs the pin tables. A shorted pair is one physical pin."""
    pins_map = doc.get("pins") or {}
    variants = (doc.get("mcu") or {}).get("variants") or {}
    for part, info in variants.items():
        if not isinstance(info, dict):
            continue
        declared = info.get("io_count")
        if declared is None:
            continue
        pkg = info.get("package")
        table = tables.get(pkg)
        if table is None:
            continue
        counted = 0
        for num, names in table.items():
            if num == 0:
                continue  # exposed pad is not an I/O
            if any((pins_map.get(n) or {}).get("type", "io") == "io" for n in names):
                counted += 1
        if counted != declared:
            r.error(f"mcu.variants.{part}",
                    f"io_count says {declared} but package `{pkg}` has {counted} I/O pins "
                    f"(a shorted pair counts once) - datasheet and pin table disagree")


def check_clock(doc: dict, r: Report) -> None:
    clock = doc.get("clock")
    if clock is None:
        r.warn("clock", "no clock tree; the Clock Configuration tab will be empty")
        return
    if not isinstance(clock, dict):
        r.error("clock", "must be a mapping")
        return
    sources = clock.get("sources") or {}
    if not sources:
        r.error("clock.sources", "no oscillators declared")
    nodes = set(sources) | {"PLLCLK"}

    pll = clock.get("pll") or {}
    for i, inp in enumerate(pll.get("inputs") or []):
        src = (inp or {}).get("source")
        if src and src not in sources:
            r.error(f"clock.pll.inputs[{i}]", f"source `{src}` is not in clock.sources")
    if pll and not pll.get("multipliers"):
        r.error("clock.pll", "no `multipliers`")

    for src in (clock.get("sysclk") or {}).get("sources") or []:
        if src not in nodes:
            r.error("clock.sysclk.sources", f"`{src}` is neither an oscillator nor PLLCLK")

    prescalers = clock.get("prescalers") or {}
    # a prescaler may hang off SYSCLK, another prescaler, an oscillator, or the PLL directly
    known = set(prescalers) | set(sources) | {"SYSCLK", "PLLCLK"}
    for name, p in prescalers.items():
        pw = f"clock.prescalers.{name}"
        if not isinstance(p, dict):
            r.error(pw, "must be a mapping")
            continue
        if not p.get("options"):
            r.error(pw, "no `options` (divider list)")
        src = p.get("source")
        if src and src not in known:
            r.error(pw, f"source `{src}` is not another prescaler or SYSCLK")
    for i, d in enumerate(clock.get("derived") or []):
        src = (d or {}).get("source")
        if src and src not in known:
            r.error(f"clock.derived[{i}]", f"source `{src}` is not a known clock node")


def check_exti(doc: dict, r: Report) -> None:
    exti = doc.get("exti")
    if not exti:
        return
    pins_map = doc.get("pins") or {}
    for line, mapping in (exti.get("lines") or {}).items():
        if not isinstance(mapping, dict):
            r.error(f"exti.lines.{line}", "must be a mapping of register value -> pin")
            continue
        for bits, pin in mapping.items():
            if pin and str(pin) not in pins_map:
                r.error(f"exti.lines.{line}", f"`{bits}` selects `{pin}`, which is not declared in `pins:`")


def validate_file(path: pathlib.Path, geom: dict) -> Report:
    r = Report(path)
    try:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        r.error("yaml", f"will not parse: {str(e).splitlines()[0]}")
        return r
    if not isinstance(doc, dict):
        r.error("yaml", "top level must be a mapping")
        return r

    for key in ("mcu", "packages", "pins", "peripherals"):
        if key not in doc:
            r.error("(file)", f"missing top-level `{key}:`")
    if r.errors:
        return r

    check_mcu_block(doc, r)
    tables = check_packages(doc, geom, r)
    check_pins(doc, tables, r)
    check_peripherals(doc, r)
    check_io_counts(doc, tables, r)
    check_clock(doc, r)
    check_exti(doc, r)
    return r


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate WCHCube MCU YAML files.")
    ap.add_argument("files", nargs="*", help="MCU yaml files (default: data/mcus/*.yaml)")
    ap.add_argument("--strict", action="store_true", help="treat warnings as failures")
    ap.add_argument("--quiet", action="store_true", help="print problems only")
    args = ap.parse_args()

    paths = [pathlib.Path(f) for f in args.files] or [
        pathlib.Path(f) for f in sorted(glob.glob(str(ROOT / "data" / "mcus" / "*.yaml")))
    ]
    if not paths:
        print("validate_mcu: no MCU files found")
        return 1

    geom = load_geometries()
    if not geom:
        print(f"validate_mcu: WARNING - no package geometries loaded from {PACKAGES_YAML}")

    if not args.quiet:
        print(f"validate_mcu: {len(paths)} file(s)")
    reports = [validate_file(p, geom) for p in paths]
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
