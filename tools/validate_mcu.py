#!/usr/bin/env python3
"""Validate data/mcus/*.yaml against the format the app actually relies on.

    python tools/validate_mcu.py                    # every bundled MCU
    python tools/validate_mcu.py data/mcus/X.yaml   # just one
    python tools/validate_mcu.py --strict           # warnings count as failures
    python tools/validate_mcu.py --quiet            # only problems, no summary

Exit code 0 = clean.  1 = at least one ERROR (or a WARN under --strict).

What it checks
  schema             required keys and value types, per the format header in
                     data/mcus/CH32V006.yaml and the schema in data/FORMAT.md
  packages           the package id has a geometry in data/packages/packages.yaml,
                     pin numbers are 1..N with no gaps or duplicates, N matches the
                     geometry, pin 0 is the exposed pad and only on packages that have one
  pin-existence      every pin named in a remap table, in a package map, or in the EXTI
                     table exists in `pins:`
  remap-consistency  every signal a setting can ask for is routed by at least one remap,
                     every remap_by_package index is in range, and remap tables agree
                     with each other about which signals they carry
  dead pins          the reverse direction: every signal that IS routed to a pin is
                     claimable by some setting choice, or that pad can never be assigned
  pins declaration   a peripheral that routes nothing says so - `pins: { none: true,
                     source: ... }` (the silicon gives it no pad; tools/coverage.py checks
                     the claim against the datasheet) or `pins: { open: true, owner: ...,
                     task: ... }` (its pads are not extracted yet). Silence is an error
  I/O counts         mcu.variants[*].io_count vs the io pins actually in that package
                     table (a shorted pair counts once) - catches a dropped or
                     duplicated row in `packages:`
  clock              every source/prescaler reference points at a node that exists,
                     and the HSE coupling (clock.hse_peripheral / hse_setting /
                     hse_signals) still names a real setting whose choice claims
                     those signals - the round-2 "picking HSE enables the crystal"
                     path has nothing else holding it together
  dma                every request names a peripheral that exists, every request has
                     starting values, and every value names a real channel parameter
                     and one of its options
  nvic               every vector has a number nothing else uses and an owner that
                     exists, and the priority scheme's bit widths match the ranges
                     it offers
  codegen            every NAME in `codegen:` still points at something in this file:
                     remap fields wide enough for their remap list, analog signals
                     the peripheral really routes, and value maps keyed by choice
                     names that still exist. The bit NUMBERS are the RM's word and
                     only a human re-reading it can check those.
  gpio               `speeds` / `modes` / `input_modes` are well formed, every entry
                     has the `name` the UI and a .wchproj key on, and `class:` - which
                     `constraints:` selects modes by - uses the closed set
  constraints        every entry names a choice, a pin and a package that exist HERE:
                     `choices` must be choices the part offers and `classes` needs every
                     mode classified, `only_on`/`not_on` pins must be in `pins:` and
                     bonded on every package the entry scopes itself to, `when` must
                     name a real peripheral. Plus the two ways an entry can be
                     unreadable: `only_on` and `not_on` together, and the same choice
                     both allow-listed and deny-listed in the same circumstances.
                     A constraint that matches nothing reads exactly like one that works.

Output is deliberately ASCII only: the Windows console here is cp1252 and chokes
on arrows and box characters.
"""
from __future__ import annotations

import copy

import argparse
import glob
import os
import pathlib
import re
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
# One entry of `signal_pins:` - a pin this signal may use, and the AF code that pin's
# GPIOx_AFRy field must hold to carry it. Checked for stray keys like everything else
# written in flow style, because an unquoted comma truncates the value before it.
SIGNAL_PIN_KEYS = {"pin", "af", "notes"}
# A peripheral's `pins:` declaration - the statement a routing-less peripheral must make
# (docs/COVERAGE.md): `none` + `source` when the silicon gives it no pad, `open` +
# `owner` + `task` while its pads are unextracted.
#
# `supplies:` is the third thing that belongs on this declaration: the supply DOMAINS the
# peripheral governs. A rail is not a peripheral function, so no pin table row carries it
# and `none` stays true - yet `supplies:` is a hardware fact (which pads carry a rail, at
# what voltage, constrained against which other rail) and hardware facts live in the data,
# cited, rather than being inferred by the app from a pin's `type:`. Only the peripheral
# that owns the power interface may carry it, and AGENT-2's `suppliesProblems()` shape
# check is the app side of the same rule.
PERIPH_PINS_KEYS = {"none", "open", "source", "owner", "task", "notes", "supplies"}
SUPPLY_KEYS = {"name", "pins", "range", "note", "source"}
# How a remap reaches the silicon. `register` and `macro` move a whole peripheral at
# once; `af` moves one pin at a time and is the only one that pairs with `signal_pins:`.
REMAP_STYLES = {"register", "macro", "af"}

# `gpio.*` entries. `class` is only meaningful on a mode - it is the direction the mode
# drives, and `constraints:` selects modes by it (see GPIO_MODE_CLASSES).
GPIO_ENTRY_KEYS = {"name", "macro", "pins_note"}
GPIO_MODE_CLASSES = {"in", "out", "af", "analog"}

# Which `gpio:` list an `option:` in a constraint is about. Dotted because the same
# mechanism has to reach a future column without a second schema.
GPIO_OPTION_SOURCES = {"gpio.mode": "modes", "gpio.pull": "input_modes", "gpio.speed": "speeds"}

CONSTRAINT_KEYS = {"id", "option", "choices", "classes", "only_on", "not_on",
                   "packages", "when", "reason", "source"}


def unknown_keys(mapping, allowed):
    return sorted(k for k in mapping if k not in allowed)


def check_supplies(decl: dict, where: str, doc: dict, r: Report) -> None:
    """The `pins.supplies:` block - the supply domains a peripheral governs.

    Each rail is a hardware fact, so each needs its own citation: a rail with no `source`
    is an uncited claim, which is the defect the whole file format exists to make
    impossible. The pads are checked against the part's own `pins:` table, because a rail
    naming a pad the file does not define is the same class of error as a routing to one.
    """
    sup = decl.get("supplies")
    if sup is None:
        return
    if not isinstance(sup, list) or not sup:
        r.error(f"{where}.pins.supplies", "must be a non-empty list of "
                                          "{ name, pins, range, note, source }")
        return
    for i, s in enumerate(sup):
        sw = f"{where}.pins.supplies[{i}]"
        if not isinstance(s, dict):
            r.error(sw, "must be a mapping")
            continue
        stray = unknown_keys(s, SUPPLY_KEYS)
        if stray:
            r.error(sw, f"unknown key(s) {stray}")
        for k in ("name", "pins", "source"):
            if not s.get(k):
                r.error(sw, f"needs `{k}:`")
        pads = s.get("pins")
        if pads is not None and (not isinstance(pads, list) or not pads):
            r.error(sw, "`pins:` must be a non-empty list of pin names")
        else:
            for p in pads or []:
                if p not in (doc.get("pins") or {}):
                    r.error(sw, f"`{p}` is not a pin this part defines; a supply rail "
                                f"names a pad that exists")


class Report:
    """Collects problems for one file and prints them grouped."""

    def __init__(self, path: pathlib.Path):
        self.path = path
        self.errors: list[str] = []
        self.warns: list[str] = []
        self.infos: list[str] = []

    def error(self, where: str, msg: str) -> None:
        self.errors.append(f"{where}: {msg}")

    def warn(self, where: str, msg: str) -> None:
        self.warns.append(f"{where}: {msg}")

    def info(self, where: str, msg: str) -> None:
        """Worth saying once; never a failure, not even under --strict."""
        self.infos.append(f"{where}: {msg}")

    @staticmethod
    def _safe(text: str) -> str:
        """The YAML contains arrows and dashes; this console is cp1252."""
        enc = getattr(sys.stdout, "encoding", None) or "ascii"
        return str(text).encode(enc, "replace").decode(enc, "replace")

    def print(self, quiet: bool = False) -> None:
        # relpath raises on Windows when the file is on a different drive than the repo,
        # which happens whenever someone validates a scratch copy. Fall back to the path.
        try:
            rel = os.path.relpath(self.path, ROOT).replace("\\", "/")
        except ValueError:
            rel = str(self.path)
        if not self.errors and not self.warns and not self.infos:
            if not quiet:
                print(f"  OK    {rel}")
            return
        print(f"  {'FAIL' if self.errors else 'warn' if self.warns else 'info'}  {rel}")
        for e in self.errors:
            print(f"          ERROR  {self._safe(e)}")
        for w in self.warns:
            print(f"          warn   {self._safe(w)}")
        for i in self.infos:
            print(f"          info   {self._safe(i)}")


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

        # The engine keys state by pin NAME, so a name on two physical pins is ambiguous —
        # but only for pins you can actually configure. HUMAN decision 2026-09-11T11:30Z:
        # repeated VSS/VDD stay exactly as the datasheet lists them, and the engine treats
        # non-io pins as labels that are never addressed by name. Report io duplicates only.
        for name, nums in seen.items():
            if len(nums) < 2:
                continue
            if (pins_map.get(name) or {}).get("type", "io") != "io":
                continue
            r.error(where, f"`{name}` is on {len(nums)} physical pins {sorted(nums)} - the app keys "
                           f"io pins by name, so only pin {sorted(nums)[0]} is reachable")

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
    # `codegen.skip_signals` names the pads GPIO_Init and GPIO_PinAFConfig must not touch -
    # the debug pair, the crystal, a hard-wired USB transceiver. They legitimately have no
    # `af:`, and warning that codegen "emits a TODO instead" for them says something that
    # is not true: the emitter skips them, which is the whole point of the key. Mirrors
    # skippedClaim() in app/engine/constraints.js - `true` for a whole peripheral, or a
    # list of its bare signal names.
    skip = ((doc.get("codegen") or {}).get("skip_signals") or {})

    def skipped(pid, sig):
        rule = skip.get(pid)
        return rule is True or (isinstance(rule, list) and str(sig) in rule)

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

        # `signal_pins:` - the per-pin AF shape. A peripheral uses ONE mux shape; a
        # part carrying both would have two places saying where a signal goes, and the
        # engine reads `signal_pins` first, so the `remaps:` list would silently be
        # dead. Rejected rather than resolved by precedence.
        sig_pins = P.get("signal_pins")
        af_routed: set[str] = set()
        if sig_pins is not None:
            spw = f"{where}.signal_pins"
            if not isinstance(sig_pins, dict) or not sig_pins:
                r.error(spw, "must be a non-empty mapping signal -> [{pin, af}, ...]")
                sig_pins = {}
            elif remaps:
                r.error(where, "has BOTH `remaps:` and `signal_pins:`; a peripheral muxes one "
                               "way or the other. The engine reads `signal_pins` first, so the "
                               "`remaps:` list here would never be used")
            for signal, opts in (sig_pins or {}).items():
                sw2 = f"{spw}.{signal}"
                if not isinstance(opts, list) or not opts:
                    r.error(sw2, "must be a non-empty list of { pin, af } entries")
                    continue
                af_routed.add(str(signal))
                seen_pins: set[str] = set()
                for k, o in enumerate(opts):
                    ow = f"{sw2}[{k}]"
                    if not isinstance(o, dict):
                        r.error(ow, "must be a mapping with `pin` and `af`")
                        continue
                    stray = unknown_keys(o, SIGNAL_PIN_KEYS)
                    if stray:
                        r.error(ow, f"unknown key(s) {stray} - almost always an unquoted comma "
                                    f"inside {{ }}, which truncates the value before it")
                    pin = o.get("pin")
                    if pin is None:
                        r.error(ow, "missing `pin`")
                    elif str(pin) not in pins_map:
                        r.error(ow, f"`{pin}` is not declared in `pins:`")
                    elif str(pin) in seen_pins:
                        # Two entries for one pin can only differ in `af`, and the engine
                        # keys the user's choice by PIN NAME, so the second is unreachable.
                        r.error(ow, f"`{pin}` is listed twice for this signal; the engine keys "
                                    f"the choice by pin name, so the second entry is dead")
                    else:
                        seen_pins.add(str(pin))
                    af = o.get("af")
                    if af is None:
                        # No AF code is CORRECT for a pad the generator must not touch;
                        # it is a gap only for a pin codegen will try to mux.
                        if not skipped(pid, signal):
                            r.warn(ow, f"`{pin}` has no `af:`; codegen will not guess an AF code "
                                       f"and emits a TODO instead")
                    elif not isinstance(af, int) or not (0 <= af <= 15):
                        r.error(ow, f"`af: {af}` must be an integer 0..15 (GPIOx_AFRy is four bits)")

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
            # HUMAN decision 2026-09-11T11:30Z: a first choice that carries signals is correct
            # where the reset state really does hold the pin (CH32V006 SYS: factory RST_MODE).
            # Say it once so it is visible, but never fail on it, and never reorder the choices.
            if stype == "choice" and isinstance(choices[0], dict) and choices[0].get("signals"):
                r.info(sw, f"first choice `{choices[0].get('name')}` carries signals, so this peripheral "
                           f"reads as enabled from reset - correct when the reset state holds the pin")

        for sig in sorted(wanted - routed - af_routed):
            if remaps:
                r.error(where, f"signal `{sig}` can be selected but no remap routes it")
            elif sig_pins:
                r.error(where, f"signal `{sig}` can be selected but `signal_pins:` gives it no pin")

        # The reverse direction, and the one that let 207 dead pads ship on CH32H417 and
        # ten unselectable ADC channels on CH32L103 (2026-09-12): a signal that is routed
        # to a pin but that no setting's choice ever names is a pad the user can never
        # assign. It renders on the chip as a function and the picker offers nothing.
        for sig in sorted((routed | af_routed) - wanted):
            r.error(where, f"signal `{sig}` is routed to a pin but no setting choice claims it, "
                           f"so that pad can never be assigned (a dead pin); add it to a "
                           f"choice's `signals:` or drop the routing")

        # A peripheral with no routing must SAY so. `pins: { none: true, source: ... }`
        # is the claim that the silicon gives it no pad (tools/coverage.py checks that
        # claim against the datasheet); `pins: { open: true, owner: ..., task: ... }` is
        # the admission that its pads are not extracted yet. Silence was how USBFS,
        # USBHS, USBSS and TKEY shipped on CH32H417 as "holds no pin on any package"
        # while the datasheet gives every one of them pads.
        decl = P.get("pins")
        if not routed and not af_routed:
            if not isinstance(decl, dict):
                r.error(where, "routes no signal to any pin and declares nothing; add "
                               "`pins: { none: true, source: ... }` if the silicon gives it no "
                               "pad, or `pins: { open: true, owner: ..., task: ... }` while its "
                               "pads are unextracted")
            else:
                stray = unknown_keys(decl, PERIPH_PINS_KEYS)
                if stray:
                    r.error(f"{where}.pins", f"unknown key(s) {stray}")
                if bool(decl.get("none")) == bool(decl.get("open")):
                    r.error(f"{where}.pins", "needs exactly one of `none: true` or `open: true`")
                elif decl.get("none") and not decl.get("source"):
                    r.error(f"{where}.pins", "`none: true` needs a `source:` - a DS table or "
                                             "note number saying no pin carries it; a family "
                                             "is not a source")
                elif decl.get("open") and not (decl.get("owner") and decl.get("task")):
                    r.error(f"{where}.pins", "`open: true` needs `owner:` and `task:` (a phrase "
                                             "that exists in TASKS.md) so the gap has a name")
                # `supplies:` - the supply domains this peripheral governs. Each rail is a
                # hardware fact, so each needs its own citation.
                check_supplies(decl, where, doc, r)
        elif isinstance(decl, dict) and "supplies" in decl and not (
                decl.get("none") or decl.get("open")):
            # A ROUTING peripheral may declare `supplies:` and nothing else, and that is
            # the normal case rather than the exception: PWR on CH32L103 routes the WKUP
            # pad, so it is not a peripheral that "routes nothing" and needs no `none`/
            # `open` claim - but the supply domains are still its business. The claim that
            # conflicts with a routing is `none`/`open` ("I have no pad"), and that is what
            # this branch keeps rejecting; `supplies` says nothing about pads at all.
            stray = unknown_keys(decl, PERIPH_PINS_KEYS)
            if stray:
                r.error(f"{where}.pins", f"unknown key(s) {stray}")
            else:
                check_supplies(decl, where, doc, r)
        elif isinstance(decl, dict):
            r.error(f"{where}.pins", "declared, but this peripheral routes signals to pins; one "
                                     "of the two is wrong")

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

    check_hse_coupling(doc, clock, sources, r)


def _setting_named(periph: dict, name: str):
    for st in periph.get("settings") or []:
        if isinstance(st, dict) and st.get("name") == name:
            return st
    return None


def _signals_routed_by(periph: dict) -> set:
    """Every signal a peripheral can route to a pin, under EITHER remap schema.

    `remaps:` is the whole-peripheral choice every CH32V00x part uses, and its signals
    live in each remap's `pins:` map. `signal_pins:` is the per-pin schema CH32H417 needs
    (RM 9.3.2.2, GPIOx_AFRL/AFRH), where a peripheral lists each signal's pins directly.
    Reading only `remaps` made this helper return an empty set for an AF-muxed part, so
    `clock.hse_signals` failed with "not routed to a pin by any RCC remap" no matter what
    the file said - a false negative on the one shape the second family uses.
    """
    routed = set()
    for rm in periph.get("remaps") or []:
        routed |= set((rm or {}).get("pins") or {})
    for sig in (periph.get("signal_pins") or {}):
        routed.add(sig)
    return routed


def check_hse_coupling(doc: dict, clock: dict, sources: dict, r: Report) -> None:
    """Picking HSE as a clock source has to switch on the peripheral setting that wires
    the crystal up, and that setting claims pins. clock.hse_peripheral / hse_setting /
    hse_signals are the only thing tying the clock tree to the peripheral table, so a
    rename on either side has to be caught here: the app would otherwise quietly stop
    enabling the crystal, with nothing on screen to say why."""
    periphs = doc.get("peripherals") or {}
    pid = clock.get("hse_peripheral")
    sname = clock.get("hse_setting")
    signals = clock.get("hse_signals") or []

    if "HSE" not in sources:
        if pid or sname or signals:
            r.warn("clock.hse_peripheral", "declared, but this part has no HSE oscillator")
        return
    if not pid:
        r.warn("clock.hse_peripheral",
               "the part has an HSE oscillator but nothing says which peripheral setting "
               "enables it, so the app has to guess a setting whose name contains `HSE`")
        return

    periph = periphs.get(pid)
    if not isinstance(periph, dict):
        r.error("clock.hse_peripheral", f"`{pid}` is not in peripherals")
        return

    have = [str(st.get("name")) for st in periph.get("settings") or [] if isinstance(st, dict)]
    if not sname:
        r.error("clock.hse_setting", f"missing; `{pid}` offers: {', '.join(have)}")
        return
    st = _setting_named(periph, sname)
    if st is None:
        r.error("clock.hse_setting",
                f"`{pid}` has no setting named `{sname}` (it has: {', '.join(have)})")
        return
    if not signals:
        r.error("clock.hse_signals",
                "missing; the engine cannot tell which pins the crystal claims")
        return

    want = set(signals)
    choices = [c for c in st.get("choices") or [] if isinstance(c, dict)]
    if not any(want <= set(c.get("signals") or []) for c in choices):
        r.error("clock.hse_signals",
                f"no choice of `{pid}` / `{sname}` claims all of {sorted(want)}, so picking "
                "HSE would switch on a setting that never reserves the crystal pins")
    for sig in sorted(want - _signals_routed_by(periph)):
        r.error("clock.hse_signals", f"`{sig}` is not routed to a pin by any `{pid}` remap")


def check_param_list(defs, where, r: Report) -> dict:
    """Shared by `peripherals.*.params` and `dma.channel_params` - they are the same
    schema on purpose, so the UI renders both with one set of editors. Returns the
    parameters by key so the caller can check values against them."""
    by_key = {}
    for i, d in enumerate(defs or []):
        at = f"{where}[{i}]"
        if not isinstance(d, dict):
            r.error(at, "must be a mapping")
            continue
        key = d.get("key")
        if not key:
            r.error(at, "no `key`, so the app drops it silently")
            continue
        if key in by_key:
            r.error(at, f"duplicate key `{key}`")
        by_key[key] = d
        at = f"{where}.{key}"
        opts = d.get("options")
        names = [o.get("name") if isinstance(o, dict) else o for o in opts or []]
        default = d.get("default")
        if default is None:
            r.error(at, "no `default`")
        elif opts and default not in names:
            r.error(at, f"default `{default}` is not one of its options ({', '.join(map(str, names))})")
        lo, hi = d.get("min"), d.get("max")
        if isinstance(default, (int, float)) and not isinstance(default, bool):
            if lo is not None and default < lo:
                r.error(at, f"default {default} is below min {lo}")
            if hi is not None and default > hi:
                r.error(at, f"default {default} is above max {hi}")
        if lo is not None and hi is not None and lo > hi:
            r.error(at, f"min {lo} is above max {hi}")
    return by_key


def check_dma(doc: dict, r: Report) -> None:
    """`dma:` has to carry enough to build a DMA Settings tab: which channels serve which
    request, what a fresh request starts as, and what the user may change. A request with
    no starting values is the failure that matters - the tab would add a row of blanks."""
    dma = doc.get("dma")
    if dma is None:
        return
    if not isinstance(dma, dict):
        r.error("dma", "must be a mapping")
        return
    periphs = doc.get("peripherals") or {}
    channels = dma.get("channels")
    requests = dma.get("requests") or {}

    signals = set()
    for ch, sigs in requests.items():
        where = f"dma.requests.{ch}"
        try:
            n = int(ch)
        except (TypeError, ValueError):
            r.error(where, "channel must be a number")
            continue
        if channels and not (1 <= n <= int(channels)):
            r.error(where, f"channel {n} is outside 1..{channels}")
        for sig in sigs or []:
            signals.add(sig)
            # `TIM1_UP` is peripheral TIM1 plus an event name; `ADC1` is the whole
            # peripheral. Only the peripheral half can be checked - UP/TRIG/COM are
            # events with no pin, so they are not in any remap table.
            owner = str(sig).split("_")[0]
            if owner not in periphs:
                r.error(where, f"`{sig}` belongs to `{owner}`, which is not a peripheral "
                               "in this file")

    params = check_param_list(dma.get("channel_params"), "dma.channel_params", r)
    if requests and not params:
        r.warn("dma.channel_params",
               "no per-request parameters, so the DMA Settings tab can only pick a "
               "channel - no direction, priority, width or mode")

    defaults = dma.get("request_defaults") or {}
    for sig in sorted(signals - set(defaults)):
        r.warn("dma.request_defaults",
               f"`{sig}` has no starting values, so adding it gives the user a row of "
               "generic defaults to fix by hand")
    for sig in sorted(set(defaults) - signals):
        r.error("dma.request_defaults", f"`{sig}` is not served by any channel")
    for sig, vals in defaults.items():
        where = f"dma.request_defaults.{sig}"
        if not isinstance(vals, dict):
            r.error(where, "must be a mapping of parameter key to value")
            continue
        for key, val in vals.items():
            if key not in params:
                r.error(where, f"`{key}` is not a dma.channel_params key")
                continue
            opts = params[key].get("options")
            names = [o.get("name") if isinstance(o, dict) else o for o in opts or []]
            if opts and val not in names:
                r.error(where, f"{key}: `{val}` is not one of {', '.join(map(str, names))}")

    fields = (dma.get("register") or {}).get("fields") or {}
    seen = {}
    for name, f in fields.items():
        if not isinstance(f, dict):
            continue
        for bit in range(int(f.get("lsb", 0)), int(f.get("lsb", 0)) + int(f.get("bits", 1))):
            if bit > 31:
                r.error(f"dma.register.fields.{name}", f"bit {bit} is outside a 32-bit register")
            if bit in seen:
                r.error(f"dma.register.fields.{name}", f"bit {bit} is also used by `{seen[bit]}`")
            seen[bit] = name

def check_nvic(doc: dict, r: Report) -> None:
    """`nvic:` is what the NVIC Settings tab and the System Core NVIC panel are built
    from. Two vectors on one number, or a vector owned by a peripheral that does not
    exist on this part, both produce a tab that lies about the silicon - which is what
    a derived part is most likely to do, since it inherits the parent's whole table."""
    nvic = doc.get("nvic")
    if nvic is None:
        return
    if not isinstance(nvic, dict):
        r.error("nvic", "must be a mapping")
        return
    periphs = doc.get("peripherals") or {}

    seen_num, seen_name = {}, set()
    for i, v in enumerate(nvic.get("vectors") or []):
        where = f"nvic.vectors[{i}]"
        if not isinstance(v, dict):
            r.error(where, "must be a mapping")
            continue
        name = v.get("name")
        if not name:
            r.error(where, "no `name`")
        else:
            where = f"nvic.vectors.{name}"
            if name in seen_name:
                r.error(where, "duplicate vector name")
            seen_name.add(name)
        num = v.get("vector")
        if num is None:
            r.error(where, "no `vector` number")
        elif num in seen_num:
            r.error(where, f"vector number {num} is already used by `{seen_num[num]}`")
        else:
            seen_num[num] = name
        owner = v.get("peripheral")
        if owner and owner not in periphs:
            r.error(where, f"owned by `{owner}`, which is not a peripheral in this file")
        if not owner and not v.get("system"):
            r.warn(where, "has no `peripheral` and is not marked `system: true`, so no "
                          "NVIC tab will list it")

    scheme = nvic.get("scheme") or {}
    bits = scheme.get("priority_bits")
    for g in scheme.get("groups") or []:
        if not isinstance(g, dict):
            continue
        gname = g.get("name", "(unnamed)")
        total = 0
        for half in ("preempt", "sub"):
            part = g.get(half) or {}
            b = int(part.get("bits", 0))
            total += b
            hi = part.get("max")
            if hi is not None and b is not None and hi > (1 << b) - 1:
                r.error(f"nvic.scheme.groups.{gname}.{half}",
                        f"offers up to {hi} but {b} bit(s) only reach {(1 << b) - 1}")
        if bits is not None and total != int(bits):
            r.error(f"nvic.scheme.groups.{gname}",
                    f"splits into {total} bit(s) but the scheme has {bits}")


def check_codegen(doc: dict, r: Report) -> None:
    """`codegen:` holds the register encodings the C generator cannot derive. The bit
    numbers are the reference manual's word and only a human re-reading it can check
    them (CH32V006.notes.md records that pass). What can be checked mechanically is that
    every NAME in here still points at something in this file, because those links rot
    quietly: a renamed choice leaves the generator emitting a reset value."""
    cg = doc.get("codegen")
    if cg is None:
        return
    if not isinstance(cg, dict):
        r.error("codegen", "must be a mapping")
        return
    periphs = doc.get("peripherals") or {}

    # `codegen.remap.style` names the route a remap takes to the silicon. Three exist:
    #   register  an AFIO field per peripheral (the default when `fields:` is present)
    #   macro     one GPIO_PinRemapConfig call per peripheral
    #   af        one GPIO_PinAFConfig call per PIN - the per-pin shape
    # `af` is the only one that pairs with `signal_pins:`, and the pairing is checked
    # in both directions: a style with no peripheral to apply it to is as dead as a
    # peripheral whose style was never declared, and both look like working data.
    remap_cfg = cg.get("remap") or {}
    style = remap_cfg.get("style")
    if style is not None and style not in REMAP_STYLES:
        r.error("codegen.remap.style", f"unknown style `{style}` (known: {', '.join(sorted(REMAP_STYLES))})")
    af_periphs = sorted(pid for pid, P in periphs.items() if isinstance(P, dict) and P.get("signal_pins"))
    if style == "af":
        if not remap_cfg.get("fn"):
            r.error("codegen.remap.fn", "`style: af` needs the function that applies it "
                                        "(GPIO_PinAFConfig on the parts seen so far); without it "
                                        "the generator emits a TODO instead of the call")
        if remap_cfg.get("fields"):
            r.error("codegen.remap.fields", "`style: af` muxes per PIN, so there is no "
                                             "per-peripheral AFIO field to write")
        if not af_periphs:
            r.error("codegen.remap.style", "`style: af` but no peripheral has `signal_pins:`, "
                                            "so nothing would ever be emitted")
    elif af_periphs:
        r.error("codegen.remap.style",
                f"{', '.join(af_periphs)} use `signal_pins:` but codegen.remap.style is "
                f"`{style or 'unset'}`; the AF emitter only runs on `style: af`, so the pin "
                f"choices would reach the pinout and never reach the generated C")

    for pid, slices in ((cg.get("remap") or {}).get("fields") or {}).items():
        where = f"codegen.remap.fields.{pid}"
        periph = periphs.get(pid)
        if not isinstance(periph, dict):
            r.error(where, "no such peripheral")
            continue
        if not isinstance(slices, list):
            r.error(where, "must be a list of {lsb, bits} slices")
            continue
        bits = sum(int(sl.get("bits", 0)) for sl in slices if isinstance(sl, dict))
        count = len(periph.get("remaps") or [])
        if bits and count > (1 << bits):
            r.error(where, f"{bits} bits hold {1 << bits} values but the peripheral has "
                           f"{count} remaps, so the high ones cannot be encoded")

    for pid, sigs in (cg.get("analog_signals") or {}).items():
        where = f"codegen.analog_signals.{pid}"
        periph = periphs.get(pid)
        if not isinstance(periph, dict):
            r.error(where, "no such peripheral")
            continue
        routed = _signals_routed_by(periph)
        for sig in sigs or []:
            if sig not in routed:
                r.error(where, f"`{sig}` is not a signal this peripheral routes to a pin")

    # periph_clock names the clock-enable bit per peripheral. Plenty of legitimate names
    # here are not modelled peripherals (AFIO, SRAM, the GPIO ports), so an unknown name
    # is a warning - but it does catch the real case: a child part that removed a
    # peripheral and inherited its parent's clock-enable bit anyway.
    known_extra = {"AFIO", "SRAM", "FLASH", "PWR", "BKP", "CRC"}
    for reg, blk in (cg.get("periph_clock") or {}).items():
        if not isinstance(blk, dict):
            continue
        for name in (blk.get("bits") or {}):
            if name in periphs or str(name).startswith("GPIO") or name in known_extra:
                continue
            r.warn(f"codegen.periph_clock.{reg}.bits",
                   f"`{name}` is not a peripheral in this file; if the part does not have "
                   "it, the generator will emit a clock enable for hardware that is absent")

    mco = (cg.get("rcc") or {}).get("mco")
    if isinstance(mco, dict) and mco.get("values"):
        _check_choice_keys(doc, r, "codegen.rcc.mco.values",
                           mco.get("peripheral"), mco.get("setting"), mco["values"])

    ctlr = cg.get("ctlr")
    if isinstance(ctlr, dict) and ctlr.get("hse_choices"):
        clock = doc.get("clock") or {}
        _check_choice_keys(doc, r, "codegen.ctlr.hse_choices",
                           clock.get("hse_peripheral"), clock.get("hse_setting"),
                           ctlr["hse_choices"], exhaustive=True)


def _check_choice_keys(doc, r, where, pid, sname, mapping, exhaustive: bool = False) -> None:
    """A value map keyed by the NAME of a choice. Every key must still be a choice; with
    `exhaustive`, every choice must also have an encoding, so adding a choice without one
    is caught rather than silently generating nothing for it."""
    periphs = doc.get("peripherals") or {}
    if not pid or not sname:
        r.error(where, "does not say which peripheral setting its keys come from")
        return
    periph = periphs.get(pid)
    if not isinstance(periph, dict):
        r.error(where, f"peripheral `{pid}` does not exist")
        return
    st = _setting_named(periph, sname)
    if st is None:
        r.error(where, f"`{pid}` has no setting named `{sname}`")
        return
    names = [str(c.get("name")) for c in st.get("choices") or [] if isinstance(c, dict)]
    for key in mapping:
        if str(key) not in names:
            r.error(where, f"`{key}` is not a choice of `{pid}` / `{sname}` "
                           f"(choices: {', '.join(names)})")
    if exhaustive:
        keys = {str(k) for k in mapping}
        for name in names:
            if name not in keys:
                r.error(where, f"choice `{name}` has no encoding, so the generator "
                               "cannot emit it")


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


def check_gpio(doc: dict, r: Report) -> None:
    """`gpio:` says what this part's GPIO block actually offers, so the UI stops
    offering a hardware choice the silicon does not have. The lists are the part's own
    and per family, so the checks here are about shape and about `class:` - the field
    `constraints:` selects modes by, where a typo would make a rule match nothing and
    read exactly like one that works."""
    g = doc.get("gpio")
    if g is None:
        return
    if not isinstance(g, dict):
        r.error("gpio", "must be a mapping")
        return
    stray = unknown_keys(g, {"speeds", "modes", "input_modes"})
    if stray:
        r.error("gpio", f"unknown key(s) {stray}")

    for key in ("speeds", "modes", "input_modes"):
        lst = g.get(key)
        if lst is None:
            continue
        if not isinstance(lst, list):
            r.error(f"gpio.{key}", "must be a list")
            continue
        for i, entry in enumerate(lst):
            where = f"gpio.{key}[{i}]"
            if not isinstance(entry, dict):
                r.error(where, "must be a mapping like { name: ..., macro: ... }")
                continue
            if not entry.get("name"):
                r.error(where, "has no `name`; the UI and a .wchproj both key on it")
            allowed = GPIO_ENTRY_KEYS | ({"class"} if key == "modes" else set())
            extra = unknown_keys(entry, allowed)
            if extra:
                r.error(where, f"unknown key(s) {extra}")
            if not entry.get("macro"):
                r.warn(where, "has no `macro`; nothing can emit this choice")
            if key == "modes" and "class" in entry and entry["class"] not in GPIO_MODE_CLASSES:
                r.error(where, f"unknown class `{entry['class']}` "
                               f"(known: {', '.join(sorted(GPIO_MODE_CLASSES))})")


def check_constraints(doc: dict, r: Report) -> None:
    """`constraints:` is round 5's mechanism - one entry per choice the app must not
    offer, on some pins, on some packages, or while another peripheral is on. The GPIO
    table, the conflict engine and codegen all read it, so a constraint that matches
    nothing is indistinguishable from one that works. Every name in an entry is
    therefore resolved against this file, and the two checks that are not about names -
    mutual exclusion and allow-vs-deny - are the two ways an entry can be unreadable."""
    items = doc.get("constraints")
    if items is None:
        return
    if not isinstance(items, list):
        r.error("constraints", "must be a list of { id, option, ... } entries")
        return
    gpio = doc.get("gpio") or {}
    pins_map = doc.get("pins") or {}
    packages = doc.get("packages") or {}
    periphs = doc.get("peripherals") or {}
    modes = [e for e in (gpio.get("modes") or []) if isinstance(e, dict)]

    def choices_for(option):
        key = GPIO_OPTION_SOURCES.get(option)
        if not key:
            return None
        return [str((e or {}).get("name")) for e in (gpio.get(key) or []) if isinstance(e, dict)]

    seen_ids: set = set()
    for i, c in enumerate(items):
        fallback = f"constraints[{i}]"
        if not isinstance(c, dict):
            r.error(fallback, "must be a mapping")
            continue
        cid = c.get("id")
        where = f"constraints.{cid}" if cid else fallback
        extra = unknown_keys(c, CONSTRAINT_KEYS)
        if extra:
            r.error(where, f"unknown key(s) {extra}")
        if not cid:
            r.error(where, "has no `id`; a conflict message and a test both name the rule by it")
        elif cid in seen_ids:
            r.error(where, "duplicate `id`; it is how one rule is named and tested")
        else:
            seen_ids.add(cid)
        if not c.get("reason"):
            r.error(where, "has no `reason`; that sentence is what the user is shown")
        if not c.get("source"):
            r.error(where, "has no `source`; a citation is a file:line or a table/note "
                           "number, never a family")

        option = c.get("option")
        known = choices_for(option)
        if not option:
            r.error(where, "has no `option`")
        elif known is None:
            r.error(where, f"unknown option `{option}` "
                           f"(known: {', '.join(sorted(GPIO_OPTION_SOURCES))})")

        has_choices, has_classes = "choices" in c, "classes" in c
        if has_choices == has_classes:
            r.error(where, "needs exactly one of `choices:` (by name) or "
                           "`classes:` (every mode of that class)")
        elif has_choices:
            lst = c.get("choices")
            if not isinstance(lst, list) or not lst:
                r.error(f"{where}.choices", "must be a non-empty list")
            elif known is not None:
                for name in lst:
                    if str(name) not in known:
                        r.error(f"{where}.choices",
                                f"`{name}` is not a choice this part offers "
                                f"(has: {', '.join(known) if known else 'none'}) - a constraint "
                                f"naming a choice that does not exist is silently dead")
        else:
            lst = c.get("classes")
            if not isinstance(lst, list) or not lst:
                r.error(f"{where}.classes", "must be a non-empty list")
            else:
                if option != "gpio.mode":
                    r.error(f"{where}.classes", "`classes:` selects from `gpio.modes`, so it "
                                                "only applies to `option: gpio.mode`")
                unclassed = [str(e.get("name") or "?") for e in modes if not e.get("class")]
                if unclassed:
                    r.error(f"{where}.classes", "`gpio.modes` must give EVERY entry a `class:` "
                           f"before one is selected here; missing on: {', '.join(unclassed)}")
                for cls in lst:
                    if cls not in GPIO_MODE_CLASSES:
                        r.error(f"{where}.classes", f"unknown class `{cls}` "
                               f"(known: {', '.join(sorted(GPIO_MODE_CLASSES))})")

        has_only, has_not = "only_on" in c, "not_on" in c
        if has_only == has_not:
            r.error(where, "needs exactly one of `only_on:` (valid here) or "
                           "`not_on:` (invalid here)")
        pin_key = "only_on" if has_only else "not_on"
        plist = c.get(pin_key)
        if not isinstance(plist, list) or not plist:
            r.error(f"{where}.{pin_key}", "must be a non-empty list of pin names")
            plist = []
        else:
            if len(plist) == 1:
                r.warn(f"{where}.{pin_key}", f"names one pin (`{plist[0]}`); check it is not a "
                                             "truncated list")
            for p in plist:
                if p not in pins_map:
                    r.error(f"{where}.{pin_key}", f"`{p}` is not declared in `pins:`")

        pkgs = c.get("packages")
        if pkgs is not None:
            if not isinstance(pkgs, list) or not pkgs:
                r.error(f"{where}.packages", "must be a non-empty list of package ids")
            else:
                for pkg in pkgs:
                    table = packages.get(pkg)
                    if not isinstance(table, dict):
                        r.error(f"{where}.packages", f"`{pkg}` is not a package of this part")
                        continue
                    # The scoping exists so a rule can exclude a package where the pin IS
                    # bonded but the rule does not hold. Naming a pin that is not bonded
                    # there is a different claim and a wrong one: the pin cannot be
                    # configured at all, so the entry is inert and reads as enforcement.
                    bonded = {n for names in table.values() for n in names_of(names)}
                    for p in plist:
                        if p in pins_map and p not in bonded:
                            r.error(f"{where}.packages",
                                    f"`{p}` is named but is not bonded on `{pkg}`, so the rule "
                                    "can never apply there")

        when = c.get("when")
        if when is not None:
            if not isinstance(when, dict):
                r.error(f"{where}.when", "must be a mapping, e.g. { peripheral: USBFS, enabled: true }")
            else:
                extra = unknown_keys(when, {"peripheral", "enabled"})
                if extra:
                    r.error(f"{where}.when", f"unknown key(s) {extra}")
                pid = when.get("peripheral")
                if not pid:
                    r.error(f"{where}.when", "has no `peripheral`")
                elif pid not in periphs:
                    r.error(f"{where}.when", f"`{pid}` is not a peripheral in this file")
                if "enabled" in when and not isinstance(when["enabled"], bool):
                    r.error(f"{where}.when", "`enabled` must be true or false")

    # One choice cannot be both allow-listed and deny-listed in the same circumstances:
    # two entries like that are not a rule, they are two rules that cannot both be read,
    # and which one wins is whichever the engine happens to consult first.
    def targets(c):
        out = set()
        for name in c.get("choices") or []:
            out.add(("choice", str(name)))
        for cls in c.get("classes") or []:
            out.add(("class", str(cls)))
        return out

    for i, a in enumerate(items):
        if not isinstance(a, dict) or a.get("when") is not None:
            continue
        for b in items[i + 1:]:
            if not isinstance(b, dict) or b.get("when") is not None:
                continue
            if a.get("option") != b.get("option") or a.get("packages") != b.get("packages"):
                continue
            if ("only_on" in a) == ("only_on" in b):
                continue
            both = targets(a) & targets(b)
            if both:
                names = ", ".join(sorted(t for _, t in both))
                r.error(f"constraints.{b.get('id')}",
                        f"`{names}` is both allow-listed and deny-listed on "
                        f"`{a.get('option')}` in the same circumstances (see "
                        f"constraints.{a.get('id')})")


# --- `mcu.inherits:` ---------------------------------------------------------
# A derived part (CH32V005 = CH32V006 minus TouchKey and TIM3) names its parent and
# lists what it drops. Resolution has to happen BEFORE validation, or every check
# below fires on keys the child legitimately does not carry.
#
# The rules are app/engine/inherit.js's - that module is the source of truth and the
# app resolves the same way at load time:
#     maps merge key by key and the child wins
#     lists REPLACE wholesale, never concatenate (a remaps[] index is the AFIO_PCFR1
#         field value, so appending would silently re-number every mapping)
#     scalars replace; mcu.variants replaces; mcu.remove takes dotted paths and it is
#         an error for one to match nothing
def _deep_merge(base, over):
    if not isinstance(base, dict) or not isinstance(over, dict):
        return copy.deepcopy(over)
    out = {}
    for k in set(base) | set(over):
        if k not in over:
            out[k] = copy.deepcopy(base[k])
        elif k not in base:
            out[k] = copy.deepcopy(over[k])
        else:
            out[k] = _deep_merge(base[k], over[k])
    return out


def _remove_path(obj, path):
    parts = str(path).split(".")
    node = obj
    for p in parts[:-1]:
        if not isinstance(node, dict) or p not in node:
            return False
        node = node[p]
    last = parts[-1]
    if isinstance(node, dict) and last in node:
        del node[last]
        return True
    return False


def _mcu_files_by_name(folder):
    """mcu.name -> parsed document, for every sibling MCU file."""
    out = {}
    for f in sorted(folder.glob("*.yaml")):
        try:
            doc = yaml.safe_load(f.read_text(encoding="utf-8"))
        except yaml.YAMLError:
            continue
        if isinstance(doc, dict) and isinstance(doc.get("mcu"), dict) and doc["mcu"].get("name"):
            out[doc["mcu"]["name"]] = doc
    return out


def resolve_inherits(doc, folder, r, seen=None):
    """Merged document, or the original plus errors on `r` if it cannot be resolved."""
    seen = list(seen or [])
    parent_name = (doc.get("mcu") or {}).get("inherits")
    if not parent_name:
        return doc
    me = (doc.get("mcu") or {}).get("name", "(unnamed)")
    if parent_name in seen:
        r.error("mcu.inherits", "loop: " + " -> ".join(seen + [me, parent_name]))
        return doc
    parents = _mcu_files_by_name(folder)
    if parent_name not in parents:
        r.error("mcu.inherits", f"`{parent_name}` is not an MCU file in {folder.name}/")
        return doc
    base = resolve_inherits(parents[parent_name], folder, r, seen + [me])
    merged = _deep_merge(base, doc)
    if (doc.get("mcu") or {}).get("variants"):
        merged["mcu"]["variants"] = copy.deepcopy(doc["mcu"]["variants"])   # never inherit part numbers
    for path in (doc.get("mcu") or {}).get("remove", []) or []:
        if not _remove_path(merged, path):
            r.error("mcu.remove", f"`{path}` matches nothing in the merged document")
    merged.get("mcu", {}).pop("inherits", None)
    merged.get("mcu", {}).pop("remove", None)
    return merged


def check_flow_mappings(text: str, r: Report) -> None:
    """Catch the unquoted-comma trap in the raw text, before YAML hides it.

    In `{ a: 1, b: 2 }` a comma separates entries, so an unquoted comma inside a VALUE
    silently ends it and starts a new key:

        - { name: IN8 (Vrefint, internal) }
          -> {name: "IN8 (Vrefint", "internal)": None}

    The key whitelists elsewhere catch this once the stray fragment lands somewhere they
    inspect. This check is the general one and needs no whitelist: every comma-separated
    segment of a flow mapping must be a `key: value` pair, so a segment with no colon is
    always a value that got cut in half. It reads the source text rather than the parsed
    document, which is the only place the evidence still exists.
    """
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.split(" #", 1)[0] if " #" in raw and not _in_quotes(raw, raw.find(" #")) else raw
        for span in re.findall(r"\{[^{}]*\}", line):
            body = span[1:-1]
            if not body.strip():
                continue
            # Blank out quoted strings and [ ... ] list values so their commas, which are
            # legitimate separators inside their own brackets, are not counted here.
            masked = re.sub(r'"[^"]*"', lambda m: "_" * len(m.group(0)), body)
            masked = re.sub(r"'[^']*'", lambda m: "_" * len(m.group(0)), masked)
            masked = re.sub(r"\[[^\[\]]*\]", lambda m: "_" * len(m.group(0)), masked)
            for seg in masked.split(","):
                if seg.strip() and ":" not in seg:
                    r.error(f"line {n}",
                            f"`{seg.strip()}` is not a `key: value` pair - an unquoted comma "
                            f"split the value before it. Quote the whole value: {span.strip()[:70]}")
                    break


def _in_quotes(line: str, idx: int) -> bool:
    return line.count('"', 0, idx) % 2 == 1 or line.count("'", 0, idx) % 2 == 1


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

    doc = resolve_inherits(doc, path.parent, r)
    if r.errors:
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
    check_dma(doc, r)
    check_nvic(doc, r)
    check_codegen(doc, r)
    check_gpio(doc, r)
    check_constraints(doc, r)
    check_exti(doc, r)
    check_flow_mappings(path.read_text(encoding="utf-8"), r)
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
