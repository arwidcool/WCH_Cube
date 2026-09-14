"""tools/cross_loader_dump.py — the Python half of the cross-loader check.

Every `data/mcus/*.yaml` and `data/packages/packages.yaml` file is read by TWO
YAML parsers that disagree with each other by design: Python's `yaml.safe_load`
implements YAML 1.1 (PyYAML has never implemented 1.2), and the app's vendored
`js-yaml` implements YAML 1.2. YAML 1.1's implicit-typing rules are wider than
1.2's — `On`/`Off`/`Yes`/`No`/`y`/`n` all resolve to booleans, and a bare
`HH:MM`-shaped scalar resolves to a sexagesimal integer — none of which 1.2
does. Every Python gate in this repository (`validate_mcu.py`, `coverage.py`,
`verify_sdk_names.py`, every `*_selftest.py`) validates the 1.1 reading. The
app that ships runs the 1.2 reading. A file that is clean under one can be
silently wrong under the other, and nothing before this file checks that.

This script does NOT decide whether the two readings agree — `tools/
cross_loader_check.mjs` does that, in Node, where the JS-side parse actually
runs. This script's only job is to hand back what Python saw, with every
scalar's TYPE preserved explicitly (a JSON boolean and a JSON string that says
"true" look identical over the wire unless the type survives as data, not as
JSON's own typing, which is exactly the distinction this check exists to
catch).

Usage: python tools/cross_loader_dump.py <file> [<file> ...]
Output: one JSON object on stdout, `{ "<path>": <result>, ... }`, where a
result is `{"ok": true, "tree": <tagged>}` or `{"ok": false, "error": "..."}`.
A tagged node is always a 2-element list `[category, value]`:
    ["null", None]              ["bool", True|False]
    ["number", <num>|"NaN"]     ["string", <str>]
    ["date", "<isoformat>"]     ["array", [<tagged>, ...]]
    ["object", [[<tagged key>, <tagged value>], ...]]   (insertion order kept)
"object" is a list of pairs, not a JSON object, so a key YAML 1.1 coerces to a
non-string (rare, but the classic `on:` key trap) still round-trips instead of
colliding under `json.dumps`' string-keys-only rule.
"""
import datetime
import json
import sys

try:
    import yaml
except ImportError:
    print(json.dumps({"__fatal__": "PyYAML is required: pip install pyyaml"}))
    sys.exit(2)


def tag(v):
    if v is None:
        return ["null", None]
    if isinstance(v, bool):
        return ["bool", v]
    if isinstance(v, (int, float)):
        if isinstance(v, float) and v != v:  # NaN != NaN
            return ["number", "NaN"]
        return ["number", v]
    if isinstance(v, str):
        return ["string", v]
    if isinstance(v, datetime.datetime):
        return ["date", v.isoformat()]
    if isinstance(v, datetime.date):
        return ["date", v.isoformat()]
    if isinstance(v, list):
        return ["array", [tag(x) for x in v]]
    if isinstance(v, dict):
        return ["object", [[tag(k), tag(val)] for k, val in v.items()]]
    # PyYAML's safe_load only ever produces the types above; anything else
    # means a new tag was taught to the loader and this script needs updating
    # too, so it is a NAMED failure, not a silent stringification.
    return ["UNHANDLED_PYTHON_TYPE:" + type(v).__name__, repr(v)]


def main(argv):
    out = {}
    for path in argv:
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
        except OSError as e:
            out[path] = {"ok": False, "error": f"could not read file: {e}"}
            continue
        try:
            doc = yaml.safe_load(text)
        except yaml.YAMLError as e:
            out[path] = {"ok": False, "error": f"yaml.safe_load raised: {e}"}
            continue
        out[path] = {"ok": True, "tree": tag(doc)}
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
