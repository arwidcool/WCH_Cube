#!/usr/bin/env python3
"""source_docs.py -- find a part's source documents, and markdown comes first.

THE POLICY, and the long form is `data/sources/README.md`, section
"Read the markdown first. The PDF is the last resort":

  1. The `.md` conversion is the WORKING source -- for the tools, for an agent and
     for a human. It grep-diffs, it can be cited by line, and a second pass can
     check it. If it answers the question, that answer is the answer.
  2. The original PDF is opened only when the markdown CANNOT answer: it is
     missing, unreadable, or demonstrably incomplete (a dropped column, a lost
     placeholder cell, a table the conversion destroyed). Not merely "clearer".
  3. A script that does open a PDF says why, in a `PDF FALLBACK:` line, in its
     docstring and on every run, and recovers the fact by SCRIPT with a check
     against numbers the datasheet states elsewhere -- never by eye.
  4. The recovered cells are then written back into the repo, once, and cited --
     so the PDF is opened once and nobody has to open it again.
  5. A PDF never stands alone: every PDF in a `Datasheets/` folder has its
     markdown conversion beside it. `tests/source_order.test.js` enforces 3 and 5.

Two things this module deliberately does NOT do: it does not read the documents
(that is each extractor's job, and every one of them looks at the text
differently), and it does not decide that a markdown file is *good* -- only that
it is present and non-empty. "Present but mangled" is a judgement each tool makes
about the specific table it needs, and it is the judgement that earns the fallback.

Usage from a tool:

    import source_docs

    # the normal path: this is a hard error if the markdown is not there
    md, kind = source_docs.choose("V006", "CH32V006DS0")

    # a tool that may only read a PDF when the markdown cannot answer
    source_docs.announce_pdf_fallback("Table 2-1-1 lost its `-` placeholder cells")
    pdf = source_docs.pdf("l103", "CH32L103DS0")

Output is ASCII only: the Windows console here is cp1252.
"""
from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCES = ROOT / "data" / "sources"

# The one place the policy is written down for a script to point at.
POLICY = ("data/sources/README.md \"Read the markdown first. "
          "The PDF is the last resort.\"")

# Folders inside a part folder that hold the datasheet / reference manual. The
# drops arrived with three spellings (`Datasheets/`, `datasheets/`), and the
# tools have always searched case-insensitively, so this does too.
DOC_DIRS = ("datasheets", "datasheet")

# Extensions by kind. Case matters on the filename here because the vendor's
# spelling is not consistent (`CH32X035RM.pdf` vs `CH32L103RM.PDF`), and the
# repo has both, so every lookup is case-insensitive on the suffix as well.
MD_EXT = ".md"
PDF_EXTS = (".pdf", ".PDF", ".Pdf")


def _entries(d: pathlib.Path):
    try:
        return list(d.iterdir())
    except OSError:
        return []


def part_dir(part: str) -> pathlib.Path | None:
    """`data/sources/<part>` with the case the filesystem actually has."""
    for e in _entries(SOURCES):
        if e.is_dir() and e.name.lower() == part.lower():
            return e
    return None


def doc_dirs(part: str):
    """The document folders inside a part folder, in a stable order."""
    p = part_dir(part)
    if p is None:
        return []
    out = [e for e in _entries(p) if e.is_dir() and e.name.lower() in DOC_DIRS]
    return sorted(out, key=lambda e: e.name.lower())


def _find(part: str, stem: str, exts):
    """First file whose stem matches `stem` (case-insensitive) with one of `exts`.

    A stem may be a stem or a whole filename: `CH32L103DS0` and
    `CH32L103DS0.md` both find the same file, which is what makes it usable from
    a docstring citation as well as from a constant.
    """
    want = stem.lower()
    for ext in exts:
        if want.endswith(ext.lower()):
            want = want[: -len(ext)]
            break
    for d in doc_dirs(part):
        for e in sorted(_entries(d), key=lambda e: e.name):
            if not e.is_file() or e.stem.lower() != want:
                continue
            for ext in exts:
                if e.name.lower().endswith(ext.lower()):
                    return e
    return None


def markdown(part: str, stem: str) -> pathlib.Path | None:
    """The markdown conversion, or None. The working source."""
    return _find(part, stem, (MD_EXT,))


def pdf(part: str, stem: str) -> pathlib.Path | None:
    """The original PDF, or None. The last resort -- announce it first."""
    return _find(part, stem, PDF_EXTS)


def is_usable(path: pathlib.Path | None) -> bool:
    """Present and non-empty. Nothing here judges quality -- the tool does."""
    return bool(path) and path.is_file() and path.stat().st_size > 0


def choose(part: str, stem: str, *, quiet: bool = False):
    """`(path, kind)` for a document, markdown first, PDF only as a fallback.

    `kind` is "md" or "pdf". Exits 2 with the paths it looked for when neither is
    present, because a silently empty table is the failure this repo keeps paying
    for. When the answer is a PDF the fallback is announced, so a tool cannot
    drift into reading PDFs as its normal path.
    """
    md = markdown(part, stem)
    if is_usable(md):
        return md, "md"
    fallback = pdf(part, stem)
    if is_usable(fallback):
        if not quiet:
            announce_pdf_fallback(f"no usable markdown for {part}/{stem}")
        return fallback, "pdf"
    looked = ", ".join(str(d) for d in doc_dirs(part)) or f"data/sources/{part}"
    sys.exit(f"source_docs: no markdown and no PDF for {part}/{stem} "
             f"(looked in {looked}). Policy: {POLICY}")


def require_markdown(part: str, stem: str) -> pathlib.Path:
    """The markdown, or exit 2 naming the fallback route.

    For the extractors, which are markdown tools by construction: if the
    conversion is not there, the answer is to get one, not to read the PDF from
    inside a tool that has no PDF path, no word-position reader and no check.
    """
    md = markdown(part, stem)
    if is_usable(md):
        return md
    sys.exit(f"source_docs: {part}/{stem} has no markdown conversion in "
             f"data/sources/{part}/Datasheets. The PDF is the LAST resort and it is "
             f"read by a tools/recover_*.py that says why -- not by this tool. "
             f"Policy: {POLICY}")


def pdf_fallback(reason: str) -> str:
    """The banner, as text, so a selftest can assert it without capturing stdout."""
    return ("PDF FALLBACK: " + reason.strip() + "\n"
            "  markdown first, PDF last resort -- " + POLICY + "\n"
            "  the recovery must be scripted, checked against the datasheet's own\n"
            "  numbers, and written back into the repo so this is read once.")


def announce_pdf_fallback(reason: str) -> None:
    print(pdf_fallback(reason))


if __name__ == "__main__":  # tiny CLI, for a quick answer at the console
    if len(sys.argv) < 3:
        sys.exit("usage: python tools/source_docs.py <PART> <STEM>   "
                 "e.g. python tools/source_docs.py V006 CH32V006DS0")
    md = markdown(sys.argv[1], sys.argv[2])
    fb = pdf(sys.argv[1], sys.argv[2])
    print(f"part      : {sys.argv[1]}")
    print(f"stem      : {sys.argv[2]}")
    print(f"markdown  : {md if md else '(none)'}")
    print(f"pdf       : {fb if fb else '(none)'}")
    if is_usable(md):
        print("read this : the markdown")
    elif is_usable(fb):
        announce_pdf_fallback("the markdown is missing or empty")
        print("read this : the PDF, last resort")
    else:
        sys.exit(2)
