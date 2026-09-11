# `lib/` — components

Each subfolder is one component: a PlatformIO library with a `library.json`, a
public `include/` and a private `src/`. This is the ESP-IDF `components/` idea
carried over, and it is also the ownership boundary — two agents working in two
different components do not conflict.

```
lib/<name>/
├── library.json     name, description, dependencies, srcDir/includeDir
├── include/         the public surface. Other components may include these.
└── src/             everything else. Private by convention and by include path.
```

Present today:

| Component | Depends on | May include SDK headers | Purpose |
|---|---|---|---|
| `wch_hal` | — | yes | thin wrappers over the WCH EVT SPL |
| `board` | `wch_hal` | via the HAL | what is physically wired to the chip |
| `util` | — | **no** | hardware-free helpers; compiles for the host too |
| `wchcube_generated` | `wch_hal` | yes | drop zone for configurator output (machine-owned) |

Rules:

1. A component's `library.json` `dependencies` list is the real dependency graph.
   If you need another component, declare it — do not rely on the include path
   happening to work.
2. `util` must stay SDK-free. That is what lets it be unit-tested on the host.
3. Every component is named in the root `platformio.ini`'s `lib_deps`, so it is
   compiled on every build whether or not the application includes it. Add yours
   to that list when you add a component.
4. Adding a component is additive and conflict-free. Widening an existing one
   that someone else owns is not — see `../ARCHITECTURE.md`.
