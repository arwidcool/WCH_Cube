# The eight-file pack, superseded 2026-09-13

**Do not read these during a work cycle.** They are here because nothing in this repository is
deleted, and because two of them are an evidence record nothing else holds.

Until 2026-09-13 the live pack was ten files. Which one was authoritative for a given question
depended on the file, and four of them quoted the same three numbers differently — AGENT-1's
REQUEST of `2026-09-13T00:33Z` is about exactly that. The pack is now **three** files
(`../../README.md`, `../../STATUS.md`, `../../BOARD.md`) and `STATUS.md` is the single source of
truth for state.

| File | What it was | Where it went |
|---|---|---|
| `PROJECT.md` | the round-6 brief and its opening measurements | `STATUS.md` §2, with §1 re-measured |
| `DONE.md` | the definition of done — and the rounds 1–5 **evidence record**, 55 KB | round 6's section → `STATUS.md` §2; rounds 1–5 stay here |
| `WALKTHROUGH.md` | the round-6 acceptance script | `STATUS.md` §5 |
| `HUMAN_TODO.md` | things only a human can do | `STATUS.md` §6 |
| `BACKLOG.md` | items for an agent whose brief is complete | `STATUS.md` §7 |
| `AGENT_1_DATA.md` | AGENT-1's standing brief + six Current sections | `STATUS.md` §4, brief plus the latest Current |
| `AGENT_2_APP.md` | AGENT-2's standing brief + Current | `STATUS.md` §4 |
| `AGENT_3_QA_RELEASE.md` | AGENT-3's standing brief + Current | `STATUS.md` §4 |

Deleted in the same commit, not archived, because they pointed at a launcher that no longer
exists: `PROMPT.txt`, `PROMPT_AGENT_1_R6.txt`, `PROMPT_AGENT_2_R6.txt`, `PROMPT_AGENT_3_R6.txt`,
`run_agents.ps1`. §7 of `../../README.md` is the whole handover now — one paragraph, pasted into a
fresh session.

**The one thing here that is not repeated anywhere else** is `DONE.md`'s rounds 1–5. Read a line
there for *how* something was closed, never for where the project stands — those sections still
carry their original `[ ]` marks and a "15 of 24" count from round 3, most of what they call open
closed under a later round's line, and they were never re-audited. That re-audit is a backlog item
in `STATUS.md` §7.
