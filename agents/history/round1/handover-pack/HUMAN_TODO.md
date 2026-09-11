# HUMAN_TODO — things only the human can do. Agents list them here once and never re-request them on the board.

1. **Add a git remote and push**: `git remote add origin <url> && git push -u origin main`.
   Unblocks: CI has never run, Tauri has never compiled, worktree model. AGENT-4 takes over the moment it exists.
2. **Rust toolchain on the dev box** (`rustup`) — optional if CI does it; lets AGENT-4 run `cargo run` in `src-tauri/`.
3. **Move the repo off the Google Drive mount** — `npm install` fails there (EBADF) and sync can corrupt a
   half-written `dist/index.html` mid-run. Any local folder works.
4. **Datasheet + RM markdown for the next parts** into `data/sources/`: CH32V003, CH32V203, CH32V307, CH32X035,
   in that order. AGENT-1 starts each one the cycle it appears.
5. **Verify one hardware fact** AGENT-2 could not: the ch32v00x EVT SDK spelling of the port clock enable
   (`RCC_PB2PeriphClockCmd(RCC_PB2Periph_GPIOx, …)` vs `RCC_APB2…`). One-line YAML change in `codegen.gpio_clock`.
