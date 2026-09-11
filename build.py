#!/usr/bin/env python3
"""Build dist/index.html: one self-contained file, no network, no server.

Placeholders in app/template.html
    <!--@@VENDOR@@-->   js-yaml (vendored, MIT) so the app works offline
    <!--@@ENGINE@@-->   app/engine/*.js concatenated into one classic script
    <!--@@DATA@@-->     data/packages/packages.yaml + every data/mcus/*.yaml

Run:  python3 build.py

The engine is written as ES modules (Node imports them directly for the tests in
app/tests/). The browser bundle is a plain concatenation in dependency order with
the import/export keywords stripped, so every engine name becomes a global that
the app script can use — same public API in both worlds. When we move to Tauri the
app will import the modules from disk instead and this inlining goes away.
"""
import glob
import os
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent

# dependency order; index.js is the Node-only barrel and is deliberately skipped
ENGINE_MODULES = ["model.js", "clock.js", "engine.js", "project.js", "export.js"]

IMPORT_RE = re.compile(r"^import\s[\s\S]*?from\s+['\"][^'\"]+['\"];[ \t]*$", re.M)
EXPORT_RE = re.compile(r"^export\s+(?=(?:const|let|var|function|class|async))", re.M)
BAD_EXPORT_RE = re.compile(r"^export\s*[{*]", re.M)


def js_safe(text: str) -> str:
    """Never let file content close the <script> that wraps it."""
    return text.replace("</script", "<\\/script")


def bundle_engine() -> str:
    out = []
    for name in ENGINE_MODULES:
        path = ROOT / "app" / "engine" / name
        src = path.read_text(encoding="utf-8")
        src = IMPORT_RE.sub("", src)
        if BAD_EXPORT_RE.search(src):
            sys.exit(f"build: {name} uses `export {{...}}` / `export *`; the inliner only "
                     f"handles `export const|let|var|function|class`.")
        src = EXPORT_RE.sub("", src)
        out.append(f"// ===== app/engine/{name} " + "=" * (60 - len(name)) + "\n" + src.strip() + "\n")
    body = "\n".join(out)
    return ('<script>\n"use strict";\n'
            "// Bundled from app/engine/*.js by build.py — do not edit here.\n"
            + js_safe(body) + "</script>")


def vendor() -> str:
    p = ROOT / "app" / "vendor" / "js-yaml.js"
    return "<script>\n" + js_safe(p.read_text(encoding="utf-8")) + "\n</script>"


def yaml_block(id_: str, path: pathlib.Path) -> str:
    txt = js_safe(path.read_text(encoding="utf-8"))
    rel = os.path.relpath(path, ROOT).replace("\\", "/")
    return f'<script type="text/x-yaml" id="{id_}" data-file="{rel}">\n{txt}\n</script>'


def data() -> str:
    blocks = [yaml_block("yaml-packages", ROOT / "data" / "packages" / "packages.yaml")]
    for f in sorted(glob.glob(str(ROOT / "data" / "mcus" / "*.yaml"))):
        blocks.append(yaml_block("yaml-mcu-" + pathlib.Path(f).stem, pathlib.Path(f)))
    return "\n".join(blocks)


def main() -> None:
    tpl = (ROOT / "app" / "template.html").read_text(encoding="utf-8")
    for token, builder in (("<!--@@VENDOR@@-->", vendor),
                           ("<!--@@ENGINE@@-->", bundle_engine),
                           ("<!--@@DATA@@-->", data)):
        if token not in tpl:
            sys.exit(f"build: template.html is missing {token}")
        tpl = tpl.replace(token, builder())
    (ROOT / "dist").mkdir(exist_ok=True)
    (ROOT / "dist" / "index.html").write_text(tpl, encoding="utf-8")
    print("wrote dist/index.html", len(tpl) // 1024, "KB")


if __name__ == "__main__":
    main()
