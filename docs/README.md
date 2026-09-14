# WCHCube documentation

Four documents, in the order most people want them.

| Document | Read it when |
|---|---|
| **[HOW-IT-WORKS.md](HOW-IT-WORKS.md)** | You want to understand the project — what it is, how it is structured, why it is shaped this way, and **exactly how much of it you should trust**. |
| **[ADDING-A-PART.md](ADDING-A-PART.md)** | Your microcontroller is not supported. This is the whole process, from dropping the vendor's files into `data/sources/` to seeing generated C compile. |
| **[COVERAGE.md](COVERAGE.md)** | You are extracting a part, or asking whether one is finished. The coverage ledger: every function on every pin, every RM chapter and every SDK instance is modelled, declared absent with a citation, or **open** — and a part is not done while a row is open. |
| **[WCH-MCU-CATALOG.md](WCH-MCU-CATALOG.md)** | You are asking *which* part to add, or whether one is already modelled. Every MCU WCH publishes, read from the vendor's own product API, joined against `data/mcus/`. A pointer, never a citation — the datasheet in `data/sources/` is the only thing an extraction may quote. |
| **[../data/FORMAT.md](../data/FORMAT.md)** | You are writing or editing an MCU file. It is the field-by-field schema and the authoritative DATA↔ENGINE contract. |

Two more, if you are picking the project up rather than using it:

| Document | What it is |
|---|---|
| **[../PROGRESS.md](../PROGRESS.md)** | The honest current state, kept current, including what is broken and what has never been tested. Read this before believing anything else. |
| **[../agents/README.md](../agents/README.md)** | The written working agreement the AI agents run under — ownership, the work cycle, the gates, and this machine's environment gotchas. |
| **[../agents/STATUS.md](../agents/STATUS.md)** | **The single source of truth for where the work stands** — measured numbers with the command that printed each, the open list with an owner per row, each agent's in-flight task and last cycle, the acceptance script, what only a human can do, and the backlog. If you are picking this up mid-stream, read this one. |

## About these documents, and the images in them

The screenshots in `images/` are **generated from the built app**, not taken by hand:

```bash
python build.py
node tools/capture_docs_images.js        # → docs/images/*.png
node tools/capture_docs_images.js --list # what it would capture, without capturing
```

That tool drives a real Chrome or Edge over the DevTools Protocol with no npm dependencies
(the same driver the QA suites use), sets up each configuration through the app's own API, and
**refuses to write an image whose page does not satisfy the condition its caption claims**. A
screenshot that does not show what it says it shows is worse than no screenshot — it is a lie
with a picture behind it.

So if the UI changes, re-run it. Images you cannot regenerate rot silently.

The diagrams are [Mermaid](https://mermaid.js.org) and are inline in the Markdown, which means
GitHub renders them and they are editable as text — no binary diagram files to drift out of
date.
