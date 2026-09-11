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
ENGINE_MODULES = ["util.js", "zip.js", "inherit.js", "history.js", "model.js", "params.js",
                  "clock.js", "resources.js", "engine.js", "project.js", "codegen.js",
                  "export.js"]

IMPORT_RE = re.compile(r"^import\s[\s\S]*?from\s+['\"][^'\"]+['\"];[ \t]*$", re.M)
EXPORT_RE = re.compile(r"^export\s+(?=(?:const|let|var|function|class|async))", re.M)
BAD_EXPORT_RE = re.compile(r"^export\s*[{*]", re.M)

# A top-level declaration: at column 0, optionally exported. This catches the one
# failure the bundle cannot survive - the same const/let/class declared twice. Every
# script in the page shares one global lexical scope, so a second declaration is a
# SyntaxError that blanks the whole app rather than breaking one feature.
DECL_RE = re.compile(r"^(?:export\s+)?(?:async\s+)?(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)", re.M)
FATAL_KINDS = {"const", "let", "class"}


def js_safe(text: str) -> str:
    """Never let file content close the <script> that wraps it."""
    return text.replace("</script", "<\\/script")


def bundle_engine() -> str:
    out = []
    for name in ENGINE_MODULES:
        path = ROOT / "app" / "engine" / name
        raw = path.read_text(encoding="utf-8")
        src = IMPORT_RE.sub("", raw)
        if BAD_EXPORT_RE.search(src):
            sys.exit(f"build: {name} uses `export {{...}}` / `export *`; the inliner only "
                     f"handles `export const|let|var|function|class`.")
        for stmt in IMPORT_RE.findall(raw):
            if re.search(r"as", stmt.split("from")[0]):
                sys.exit(f"build: {name} imports under an alias ({' '.join(stmt.split())}). The "
                         f"browser bundle drops the imports and relies on the names matching, "
                         f"so an alias would be undefined at runtime. Import the plain name.")
        src = EXPORT_RE.sub("", src)
        out.append(f"// ===== app/engine/{name} " + "=" * (60 - len(name)) + "\n" + src.strip() + "\n")
    body = "\n".join(out)
    return ('<script>\n"use strict";\n'
            "// Bundled from app/engine/*.js by build.py — do not edit here.\n"
            + js_safe(body) + "</script>")


def top_level_decls(src, origin):
    """(name, kind, origin, line) for every declaration at column 0.

    Anything inside a template literal is skipped: codegen.js emits C source whose
    lines legitimately start with `const`.
    """
    out = []
    for m in DECL_RE.finditer(src):
        if src.count("`", 0, m.start()) % 2:
            continue
        out.append((m.group(2), m.group(1), origin, src.count("\n", 0, m.start()) + 1))
    return out


def page_scripts(tpl):
    """The page's own <script> blocks (the ones with no attributes)."""
    return [(m.group(1), m.start()) for m in re.finditer(r"<script>([\s\S]*?)</script>", tpl)]


def check_no_duplicate_declarations(tpl):
    # scan the RAW modules, not the bundle, so the line numbers point at real files
    decls = []
    for name in ENGINE_MODULES:
        src = (ROOT / "app" / "engine" / name).read_text(encoding="utf-8")
        decls += top_level_decls(src, "app/engine/" + name)
    for body, off in page_scripts(tpl):
        base = tpl.count("\n", 0, off)
        decls += [(n, k, "app/template.html", base + ln) for n, k, _, ln in top_level_decls(body, "")]
    seen, clashes = {}, []
    for name, kind, origin, line in decls:
        if name in seen:
            if kind in FATAL_KINDS or seen[name][0] in FATAL_KINDS:
                clashes.append((name, seen[name], (kind, origin, line)))
        else:
            seen[name] = (kind, origin, line)
    if clashes:
        msg = ["build: the same name is declared twice at the top level of the bundle.",
               "       Every script in the page shares one global scope, so this is a fatal",
               "       SyntaxError in the browser: the app would not start at all.", ""]
        for name, a, b in clashes:
            msg.append("       {}: {} at {}:{}  and  {} at {}:{}".format(name, a[0], a[1], a[2], b[0], b[1], b[2]))
        msg += ["", "       Delete one of them - usually the copy left behind after moving a function."]
        sys.exit("\n".join(msg))


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
    check_no_duplicate_declarations(tpl)
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
