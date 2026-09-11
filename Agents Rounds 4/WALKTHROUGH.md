# WALKTHROUGH — round 4. A second family, and a folder you can flash.

AGENT-4 runs this in a real browser and a real shell; anyone can. Record results in
`tests/evidence/round4/<date>.md` with a screenshot per numbered section.

Earlier scripts still apply and are run first:
`../Agents Rounds 2/WALKTHROUGH.md` §1–§7 (the app) and
`../Agents Rounds 3/WALKTHROUGH.md` §8–§12 (configuration → C → a binary).
This file adds §13 onward. Sections marked **(gate)** are the round's exit criterion.

---

## 13 CH32X035 exists and is not a special case

13.1 New project → the MCU list offers **CH32X035**. Pick `CH32X035G8U6` (QFN28) → Create.
13.2 The chip draws. Pin numbering runs 1..28 counter-clockwise from pin 1, the exposed pad is
     labelled, and nothing is clipped or overlapping. Console: zero errors, zero warnings.
13.3 Repeat for all seven packages: **LQFP64M, LQFP48, QFN28, QSOP28, QFN20, TSSOP20, QFN12.**
     LQFP64 with 60 I/O is the real test — long signal names (`USBPD_CC1`, `USART4_CTS`,
     `TIM2_CH3N`) must fit their boxes or ellipsise with a full-text tooltip.
13.4 **Port C is not contiguous and has two holes.** The pin list shows PC0–PC7, PC10–PC11 and
     PC14–PC19, and **no PC8, PC9, PC12 or PC13 anywhere** — not in the GPIO table, not in the
     picker, not in the tree, not on the chip. Take the exact set from `CH32X035.yaml`, not from
     this line.
13.5 **Ports are 24 bits wide.** A pin named `PC19` exists, is selectable, and appears in the GPIO
     table. Nothing truncates it to 16.
13.6 The tree lists the peripherals the RM describes, including **USBFS, USBPD, PIOC, AWU** and
     **four USARTs**, each under a sensible category, each opening a panel with real controls. No
     "Activated" checkbox that does nothing.

## 14 The clock tab on a part with no HSE  **(gate)**

This is the section round 4 exists to run. CH32X035 has **one** oscillator.

14.1 Open Clock Configuration on CH32X035. There is **no HSE box**, no HSE entry in the SYSCLK mux,
     no HSE row in RCC, and **no greyed placeholder** where one would have been.
14.2 There is no gap or misalignment in the tree where the HSE branch used to be on the other part.
14.3 The SYSCLK selector offers what the data offers — HSI and its dividers (48 / 24 / 16 / 12 / 8
     MHz) — and every one of them is selectable and moves the downstream values.
14.4 Console is silent. Nothing threw, nothing warned, nothing rendered `undefined`.
14.5 **Now switch back to CH32V006 and re-run `../Agents Rounds 2/WALKTHROUGH.md` §4 in full.**
     HSE is offered, selecting it enables the crystal and claims PA1/PA2, the frequency moves
     SYSCLK, out-of-range goes red. **A second part must not cost the first one anything.**

## 15 Configure a CH32X035 worth generating

15.1 Assign across more than one port, including one in PC's upper range: e.g. `PA1` → an output
     with the user label `STATUS_LED`, `PB10` → `USART2_TX`, `PC16` → something real on this part.
15.2 Set a remap that moves a signal, and confirm the chip repaints. On this part a remap is a
     **named macro** (`GPIO_FullRemap_USART2`), which §17 will check in the generated C.
15.3 Parameter Settings on USART2: baud 115200, 8N1. DMA Settings: add one request — note the
     channel list runs to **8**, not 7. NVIC Settings: enable a vector, and confirm the **EXTI
     vectors appear as three rows (EXTI7_0, EXTI15_8, EXTI25_16), not twenty-six.**
15.4 Ctrl+S → `x035_gate.wchproj`. Keep it; `tests/fixtures/` wants it.

## 16 Generate a PlatformIO project  **(gate)**

16.1 Project Manager tab → the **Generate PlatformIO project** control exists, with a project name
     and a destination.
16.2 Before generating, the panel says what `main.c` will do, driven by the configuration —
     *"Blinks PA1 (STATUS_LED) and prints over the WCH-Link debug channel"*. Reset that pin and it
     changes to *"…No output GPIO is configured, so nothing will blink"*. Restore the pin.
16.3 The preview lists **every** file — `platformio.ini`, `src/main.c`, `README.md`,
     `lib/wchcube_generated/include/wchcube_init.h`, `.../src/wchcube_init.c` — and shows the real
     text of each.
16.4 Read `platformio.ini` in the preview: `platform = ch32v`, `framework = noneos-sdk`,
     `board = genericCH32X035G8U6`, and an upload protocol. No invented keys.
16.5 Generate. Desktop: a folder picker, then the path and the next two commands shown in copyable
     text. Browser: the **Output** row's *Choose folder…* (Edge/Chrome) makes both buttons write
     into the folder you picked — the project under `<folder>/<name>/`, GENERATE CODE's files
     straight into it — and the panel says which will happen *before* the click. With no folder
     chosen, a single `.zip` whose contents match the preview exactly, to the browser's
     Downloads folder, and the panel says that too. Nothing is ever written somewhere unstated.
16.6 **Try to generate for a variant with no board.** Pick CH32V006F4U6 → the button is disabled
     **with the reason visible**: *"no PlatformIO board for this part number"*, and the variants that
     can be generated are listed. It must not silently produce a project for the nearest board —
     F4U6 has 16 KB of flash against F8U6's 62 KB.

## 17 The generated project builds, on its own  **(gate)**

Somewhere outside the repository — the point is that it is self-contained:

```bash
cd /path/to/MyBoard
pio run
```

17.1 Exits **0**. First run downloads nothing that was not already installed.
17.2 Nothing in the folder references a path outside it. Move the folder somewhere else and build
     again — still 0.
17.3 Read the generated `wchcube_init.c`: the remap from 15.2 is a
     `GPIO_PinRemapConfig(GPIO_FullRemap_USART2, ENABLE)` call, the GPIO masks are 32-bit and
     include the PC pin from 15.1, the speed macro is `GPIO_Speed_50MHz`, and the include names
     `ch32x035.h`. **Zero TODO sections, zero `#error`.**
17.4 Repeat the whole of §16–§17 for **CH32V006 TSSOP20**. Both families, same path, same result.
17.5 `node tools/wchcube_cli.js --project x035_gate.wchproj --new-project <tmp>/Proj` produces the
     same folder from the command line, and `--strict` exits 0.

## 18 Flash it  **(the claim nobody here has made yet)**

Needs a board and a WCH-Link. If you have one:

```bash
pio run -t upload
pio device monitor
```

18.1 It flashes.
18.2 The SDI banner prints the part, the package, the SYSCLK the configuration asked for, and
     `SystemCoreClock` read back after `WCHCube_Init()`. **Those last two are allowed to differ from
     the board file's 48 MHz** — that is the two-clock-owners behaviour and the generated README
     explains it — but they must match what the app said the configuration was.
18.3 If an output GPIO was configured, it toggles, and it is the pin named in the banner.
18.4 Screenshot or paste the monitor output into `tests/evidence/round4/`. **This would be the first
     hardware result in this project's history.**

## 19 What this does NOT prove

Into the evidence file every time.

- **If §18 was skipped, nothing here has run on silicon.** §17 says the names exist and the types
  match. It does not say a bit is in the right place. Write "builds, not flashed" and do not let
  anyone round it up.
- **A part that draws is not a part that is complete.** §13 checks rendering; `completeness.test.js`
  checks that every peripheral in the RM has settings, params, DMA and NVIC. Both, or neither
  counts.
- **The DS conversion has lost information.** Any pin table row `CH32X035.notes.md` records as
  unreadable is a row no test covers, on any package that contains it.
