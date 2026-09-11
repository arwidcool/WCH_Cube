#!/usr/bin/env python3
"""Inline data/packages/packages.yaml and every data/mcus/*.yaml into dist/index.html.

Run:  python3 build.py
The app template lives in app/template.html. The result is a single self-contained file.
(When we move to Tauri the app will read the YAML from disk instead — same files, no inlining.)
"""
import glob, os, pathlib

ROOT = pathlib.Path(__file__).parent
tpl = (ROOT / "app" / "template.html").read_text(encoding="utf-8")

def block(id_, path):
    txt = pathlib.Path(path).read_text(encoding="utf-8").replace("</script", "<\\/script")
    return f'<script type="text/x-yaml" id="{id_}" data-file="{os.path.relpath(path, ROOT)}">\n{txt}\n</script>'

blocks = [block("yaml-packages", ROOT / "data" / "packages" / "packages.yaml")]
for f in sorted(glob.glob(str(ROOT / "data" / "mcus" / "*.yaml"))):
    blocks.append(block("yaml-mcu-" + pathlib.Path(f).stem, f))

out = tpl.replace("<!--@@DATA@@-->", "\n".join(blocks))
(ROOT / "dist").mkdir(exist_ok=True)
(ROOT / "dist" / "index.html").write_text(out, encoding="utf-8")
print("wrote dist/index.html", len(out) // 1024, "KB")
