# WCH MCU catalogue — every part WCH lists, and the ones this repo has data for

**What this is.** The complete MCU/SoC line-up as *WCH itself publishes it*, joined against
`data/mcus/`.  It exists to answer one question — "is this part modelled yet?" — without
guessing from family names.

**Where it came from.** `https://www.wch-ic.com/products/` is a Vue app; its tables are filled
from a JSON API, and that API is what was read, so these are the vendor's own cells, not a
transcription:

```
GET https://www.wch-ic.com/api/official/website/categories/sidebar            # category ids
GET https://www.wch-ic.com/api/official/website/productTables/product?categoryId=<id>
```

Categories read: 70 (RISC-V general), 76 (RISC-V enhanced low power), 75 (RISC-V featured
application), 74 (RISC-V Bluetooth wireless), 71 (Cortex-M general), 94 (8-bit, both tables) —
that is every child of the site's `MCU/SoC` node (id 5).  Fetched **2026-09-13**.
**87 rows.**

**Read this as a pointer, not as a source.**  Per `CLAUDE.md` rule 2, nothing here is a citation.
A cell in this table is a marketing summary; the datasheet in `data/sources/<PART>/Datasheets/`
is the only thing an extraction may quote, and where the two disagree the datasheet wins and the
disagreement gets recorded.  WCH revises this line-up without notice — re-run the two URLs above
rather than trusting the date.

**Caveat on granularity.**  WCH mixes series and order codes in one column: `CH32V003` is a
series, `CH32F103C8T6` is an orderable part, and `CH32H417/5` is two series in one cell
(CH32H417 and CH32H415).  Rows are reproduced exactly as published.

---

## The short answer: 6 of the parts below have data

| Part | File | Sources | Coverage |
|---|---|---|---|
| CH32H417 | `data/mcus/CH32H417.yaml` | `data/sources/H417/` | complete, 0 open |
| CH32L103 | `data/mcus/CH32L103.yaml` | `data/sources/l103/` | complete, 0 open |
| CH32V003 | `data/mcus/CH32V003.yaml` | `data/sources/V003/` | complete, 0 open |
| CH32V005 | `data/mcus/CH32V005.yaml` | *derived from CH32V006* (`inherits:`) | complete, 0 open |
| CH32V006 | `data/mcus/CH32V006.yaml` | `data/sources/V006/` | complete, 0 open |
| CH32X035 | `data/mcus/CH32X035.yaml` | `data/sources/X035/` | complete, 0 open |

Quoted from `python tools/coverage.py --quiet`, run 2026-09-13:

```
  CH32H417   OPEN 0  (modelled 1256, absent 23, disagreements 45)
  CH32L103   OPEN 0  (modelled 272, absent 11, disagreements 1)
  CH32V003   OPEN 0  (modelled 116, absent 10, disagreements 0)
  CH32V005   OPEN 0  (modelled 214, absent 14, disagreements 0)
  CH32V006   OPEN 0  (modelled 218, absent 11, disagreements 0)
  CH32X035   OPEN 0  (modelled 278, absent 11, disagreements 0)
```

Everything else in this document — the CH32F Cortex-M line, the CH32V1xx/2xx/3xx line, the
CH5xx Bluetooth SoCs, the CH32M motor parts, the CH64x/CH56x parts and the whole 8-bit
catalogue — **has no file in `data/mcus/` and no documents in `data/sources/`.**

Adding one is `docs/ADDING-A-PART.md`, and it is not done until
`python tools/coverage.py <PART>` prints zero open rows.

---

## Progress: added, next, and not yet started

**11 of the 87 rows have data. 3 rows are queued. 73 rows have not been started.** Counted
against the catalogue's own rows from `data/mcus/*.yaml` (6 files), `data/sources/*` (5 folders)
and `agents/STATUS.md` §6 item 4 (the next-parts queue), 2026-09-14.

| Status | Rows | What it means |
|---|---|---|
| **Added** | 11 | `data/mcus/<PART>.yaml` ships and the ledger reads `OPEN 0` |
| **Next up** | 3 | Named as the next parts to add; **blocked on a human** dropping the DS + RM markdown into `data/sources/` |
| **Not started** | 73 | No file, no sources |
| | **87** | the catalogue's own row count |

The unit is **rows, not parts**, because WCH puts series and order codes in one column. Four
groups are the same silicon counted more than once: `CH32L103` (6 rows — the series plus five
order codes), `CH32V208` (5 rows — the series row in the general table plus four order codes in
the Bluetooth one), and `CH32V317` and `CH32V305` (2 rows each, general and featured). So the
87 rows are **fewer than 87 parts**: 6 distinct parts are done, and 2 more are queued.

### Added — 6 parts, complete and at zero open rows

| Part | File | Sources | Ledger (2026-09-14) |
|---|---|---|---|
| CH32H417 | `data/mcus/CH32H417.yaml` | `data/sources/H417/` | `OPEN 0` (modelled 1257, absent 23, disagreements 44) |
| CH32L103 | `data/mcus/CH32L103.yaml` | `data/sources/l103/` | `OPEN 0` (modelled 272, absent 11, disagreements 1) |
| CH32X035 | `data/mcus/CH32X035.yaml` | `data/sources/X035/` | `OPEN 0` (modelled 278, absent 11, disagreements 0) |
| CH32V006 | `data/mcus/CH32V006.yaml` | `data/sources/V006/` | `OPEN 0` (modelled 218, absent 11, disagreements 0) |
| CH32V005 | `data/mcus/CH32V005.yaml` | *derived from CH32V006* (`inherits:`) | `OPEN 0` (modelled 214, absent 14, disagreements 0) |
| CH32V003 | `data/mcus/CH32V003.yaml` | `data/sources/V003/` | `OPEN 0` (modelled 116, absent 10, disagreements 0) |

`OPEN 0` means every function the datasheet puts on a pin, every RM chapter and every SPL
instance is modelled or declared absent with a `file:line`. It does **not** mean every
peripheral is configurable to the same depth — see the per-part `params:` table in the
[README](../README.md#documentation).

### Next up — 2 parts, waiting on source documents

| Part | Row | Waiting on |
|---|---|---|
| **CH32V203** | RISC-V general (`CH32V203`) and enhanced low power (`CH32V203C8T6`) | DS + RM markdown in `data/sources/` |
| **CH32V307** | RISC-V general | The same, after CH32V203 |

`agents/STATUS.md` §6 item 4: *"Datasheet + RM markdown for the next parts into `data/sources/`:
**CH32V203, then CH32V307.** AGENT-1 starts each the cycle it appears."* The queue is in that
order and it is a **human** step — nothing in the repo can fetch the documents. There is no
partial work for either part anywhere in the tree.

### Not started — 73 rows

| Family | Rows | Parts |
|---|---|---|
| RISC-V general — CH32V | 9 | `CH32V317`, `CH32V305`, `CH32V303`, `CH32V208`, `CH32V205`, `CH32V103`, `CH32V007`, `CH32V004`, `CH32V002` |
| RISC-V featured application — CH32H / CH32M / CH32X / CH64x / CH56x | 14 | `CH32M030C8`, `CH32M030K8`, `CH32M030G8`, `CH32M007E8`, `CH32M007G8`, `CH32M103`, `CH32X033`, `CH32V317`, `CH32V305`, `CH645`, `CH643`, `CH641`, `CH569`, `CH564` |
| RISC-V Bluetooth wireless — CH57x / CH58x / CH59x | 14 | `CH585`, `CH584`, `CH592`, `CH591`, `CH583`, `CH582`, `CH572`, `CH570`, `CH573`, `CH571`, and four `CH32V208` order codes |
| Cortex-M general — CH32F | 16 | `CH32F103` ×4, `CH32F203` ×8, `CH32F205RBT6`, `CH32F207VCT6`, `CH32F208` ×2 |
| E8051 USB — CH54x / CH55x | 14 | `CH541`, `CH543`, `CH546`, `CH548`, `CH547`, `CH549`, `CH545`, `CH551`, `CH552`, `CH554`, `CH558`, `CH559`, `CH555`, `CH557` |
| Minimalist assembly — CH52x / CH53x | 6 | `CH521`, `CH522`, `CH525`, `CH527`, `CH531`, `CH532` |

**Two notes on the easy ones.** `CH32X033` is deliberately *not* folded into CH32X035: it has
its own pin table in the same datasheet (Table 2-2), so it is a different pinout rather than a
variant, and it belongs in its own file — `CH32X035.yaml` records that at line 41 and
`CH32X035.notes.md` has the reasoning. `CH32V203C8T6` is the same silicon as the `CH32V203`
series row, so it arrives with it.

**And an honest caveat about the last three families**, because "not started" implies "next":
the engine's interrupt path models WCH's **PFIC**, which the code says outright is *not* the
Cortex-M scheme (`app/engine/resources.js:473`). The scheme itself is data-driven — priority
bits and groups come from the file — but the generated interrupt code writes PFIC-style calls,
so the CH32F line would need that path checked before it could be called a data job. The E8051
and 8-bit RISC OTP parts are further away again. **No decision to include or exclude them is
recorded anywhere**, so they are listed as not started rather than as out of scope.

---

## Every part WCH lists

### RISC-V general — CH32V

| Part | Freq | Flash | RAM | Notable | Package | In this repo |
|---|---|---|---|---|---|---|
| `CH32V317` | 144MHz | 256K | 64K | USB 480Mbps H/D built-in PHY / 12Mbps OTG; ETH 10M/100M PHY; CAN 2; DVP/SDIO | LQFPF100/QFN68 | no |
| `CH32V307` | 144MHz | 256K | 64K | USB 480Mbps H/D built-in PHY / 12Mbps OTG; ETH 1G MAC+10M PHY; CAN 2; FSMC/DVP/SDIO | LQFP100/QFN68/LQFP64M | **next** — waiting on sources |
| `CH32V305` | 144MHz | 128K | 32K | USB 480Mbps H/D built-in PHY / 12Mbps OTG; CAN 2; SDIO | LQFP64M/LQFP48/QFN28/TSSOP20 | no |
| `CH32V303` | 144MHz | 256K | 64K | USB 12Mbps H/D; CAN 1; FSMC/SDIO | LQFP100/LQFP64M/LQFP48 | no |
| `CH32V208` | 144MHz | 128K | 64K | USB 12Mbps D+H/D; BLE 5.3; ETH 10M PHY; CAN 1 | QFN68/LQFP64M/QFN48/QFN28 | no |
| `CH32V205` | 192MHz | 256K | 32K | USB 480Mbps H/D built-in PHY / 12Mbps H/D; CAN 1; FSMC/PIOC/QSPI / CMP/Type-C PD | LQFP100/LQFP64/LQFP48 | no |
| `CH32V203` | 144MHz | 128K | 64K | USB 12Mbps D+H/D; ETH 10M PHY; CAN 1 | LQFP64M/LQFP48/QFN48X7/LQFP32 / QFN28/QSOP28/QFN20/TSSOP20 | **next** — waiting on sources |
| `CH32V103` | 80MHz | 64K | 20K | USB 12Mbps H/D | LQFP64M/LQFP48/QFN48X7 | no |
| `CH32V007` | 48MHz | 65K | 8K | SLTIM/CMP | QFN32/QSOP24 | no |
| `CH32V006` | 48MHz | 65K | 8K | - | QFN32/QSOP24/QFN20/TSSOP20/QFN20 | **yes** — `data/mcus/CH32V006.yaml` |
| `CH32V005` | 48MHz | 32K | 6K | - | QSOP24/QFN20/TSSOP20/QFN12 | **yes** — `data/mcus/CH32V005.yaml` |
| `CH32V004` | 48MHz | 32K | 6K | - | QFN20/TSSOP20 | no |
| `CH32V003` | 48MHz | 16K | 2K | - | QFN20/TSSOP20/SOP16/SOP8 | **yes** — `data/mcus/CH32V003.yaml` |
| `CH32V002` | 48MHz | 16K | 4K | - | QFN20/TSSOP20/SOP16/QFN12/SOP8 | no |

### RISC-V enhanced low power — CH32V203 / CH32L103

| Part | Freq | Flash | RAM | Notable | Package | In this repo |
|---|---|---|---|---|---|---|
| `CH32V203C8T6` | 144MHz | 64K | 20K | USB D+H/D; CAN 1 | LQFP48 | **next** — arrives with CH32V203 |
| `CH32L103F8P6` | 96MHz | 64K | 20K | USB D; CAN 1 | TSSOP20 | **yes** — `data/mcus/CH32L103.yaml` |
| `CH32L103F8U6` | 96MHz | 64K | 20K | USB H/D; CAN 1 | QFN20 | **yes** — `data/mcus/CH32L103.yaml` |
| `CH32L103G8R6` | 96MHz | 64K | 20K | USB H/D; CAN 1 | QSOP28 | **yes** — `data/mcus/CH32L103.yaml` |
| `CH32L103K8U6` | 96MHz | 64K | 20K | USB H/D; CAN 1 | QFN32 | **yes** — `data/mcus/CH32L103.yaml` |
| `CH32L103C8T6` | 96MHz | 64K | 20K | USB H/D; CAN 1 | LQFP48 | **yes** — `data/mcus/CH32L103.yaml` |

### RISC-V featured application — CH32H / CH32M / CH32X / CH64x / CH56x

| Part | Freq | Flash | RAM | Notable | Package | In this repo |
|---|---|---|---|---|---|---|
| `CH32H417/5` | 400+144MHz | 960K | 896K | USB 5Gbps / 480Mbps / 12Mbps; ETH 100M; DFSDM/LTDC/DVP/SDMMC / QuadSPI/I3C/UHSIF/SAI / SWPMI/LPTIM/RNG/CAN / FMC/PIOC... | QFN128/QFN88/QFN68 / QFN60X6 | **yes** — `data/mcus/CH32H417.yaml` |
| `CH32M030C8` | 72MHz | 64K | 12K | USB 12Mbps; 4 Pair NN Gate driver / ISINK/BC/Type-C PD | QFN48X7_A/QFN48/LQFP48 | no |
| `CH32M030K8` | 72MHz | 64K | 12K | USB 12Mbps; 2 Pair NN Gate driver / ISINK/BC/Type-C PD | QFN32 | no |
| `CH32M030G8` | 72MHz | 64K | 12K | USB 12Mbps; 3 Pair NN Gate driver / ISINK/BC/Type-C PD | QSOP28 | no |
| `CH32M007E8` | 48MHz | 65K | 8K | 3 Pair PN Gate driver | QFN26C3/QSOP24 | no |
| `CH32M007G8` | 48MHz | 65K | 8K | 3 Pair NN Gate driver | QSOP28 | no |
| `CH32M103` | 96MHz | 64K | 20K | USB 12Mbps; 3 Pair PN Gate driver / LPTIM/CAN/Type-C PD | QSOP28 | no |
| `CH32L103` | 96MHz | 64K | 20K | USB 12Mbps; LPTIM/CAN/Type-C PD | LQFP48/QFN32/QSOP28/QFN20/TSSOP20 | **yes** — `data/mcus/CH32L103.yaml` |
| `CH32X035` | 48MHz | 65K | 20K | USB 12Mbps; PIOC/Type-C PD | LQFP64M/LQFP48/QFN28/QSOP28/QFN20/TSSOP20 | **yes** — `data/mcus/CH32X035.yaml` |
| `CH32X033` | 48MHz | 65K | 20K | USB 12Mbps / Device; PIOC | TSSOP20 | no |
| `CH32V317` | 144MHz | 256K | 64K | USB 480Mbps / OTG; ETH 100M; TRNG/CAN | LQFP100/QFN68 | no |
| `CH32V305` | 144MHz | 128K | 32K | USB 480Mbps / OTG; TRNG | LQFP64M/LQFP48/QFN28/TSSOP20 | no |
| `CH645` | 125MHz | 224K | 80K | USB 480Mbps; ETH 100M; Type-C PD | QFN68/QFN32 | no |
| `CH643` | 48MHz | 62K | 20K | USB 12Mbps; LEDPWM / OPA/CMP / PIOC/Type-C PD | QFN80/LQFP64/LQFP48/QSOP28 | no |
| `CH641` | 48MHz | 16K | 2K | QII/ISP / BC/Type-C PD | QFN28/QFN20/QFN16 | no |
| `CH569` | 120MHz | 448K | 48K/80K | USB 5G/480Mbps; ETH 1000M; BUS8 | QFN68 | no |
| `CH564` | 120MHz | 448K | 64/96/128K | USB 480Mbps; ETH 100M; SLV/XBUS / Type-C PD | LQFP128/LQFP64M/QFN32/QFN26C3 | no |

### RISC-V Bluetooth wireless — CH57x / CH58x / CH59x / CH32V208

| Part | Freq | Flash | RAM | Notable | Package | In this repo |
|---|---|---|---|---|---|---|
| `CH585` | 78MHz | 448K | 128K | RISC-V; USB 480Mbps H/D; BLE 5.4 | QFN48/QFN32/QFN26C3/QFN20 | no |
| `CH584` | 78MHz | 448K | 96K | RISC-V; USB 1*H/1*D; BLE 5.4 | QFN48T/QFN32 | no |
| `CH592` | 20MHz | 448K | 26K | RISC-V; USB 1*H/1*D; BLE 5.4 | QFN32/QFN28 | no |
| `CH591` | 20MHz | 192K | 26K | RISC-V; USB 1*D; BLE 5.4 | QFN28/QFN20/TSSOP16 | no |
| `CH583` | 20MHz | 448K | 32K | RISC-V; USB 2*H/2*D; BLE 5.3 | QFN48 | no |
| `CH582` | 20MHz | 448K | 32K | RISC-V; USB 2*H/2*D; BLE 5.3 | QFN48/QFN28 | no |
| `CH572` | 100MHz | 240K | 12K | RISC-V; USB 1*H/1*D; BLE 5.0 | QFN20/DFN10X3/TSSOP16 | no |
| `CH570` | 100MHz | 240K | 12K | RISC-V; USB 1*H/1*D | QFN20/DFN10X3/SOP8 | no |
| `CH573` | 20MHz | 448K | 18K | RISC-V; USB 1*H/1*D; BLE 4.2 | QFN28 | no |
| `CH571` | 20MHz | 192K | 18K | RISC-V; USB 1*D; BLE 4.2 | QFN28/TSSOP16/ESSOP10 | no |
| `CH32V208GBU6` | 144MHz | 128K | 64K | RISC-V; USB 1*H/2*D; BLE 5.3; ETH 10M | QFN28 | no |
| `CH32V208CBU6` | 144MHz | 128K | 64K | RISC-V; USB 1*H/2*D; BLE 5.3 | QFN48 | no |
| `CH32V208RBT6` | 144MHz | 128K | 64K | RISC-V; USB 1*H/2*D; BLE 5.3; ETH 10M | LQFP64M | no |
| `CH32V208WBU6` | 144MHz | 128K | 64K | RISC-V; USB 1*H/2*D; BLE 5.3; ETH 10M | QFN68 | no |

### Cortex-M general — CH32F

| Part | Freq | Flash | RAM | Notable | Package | In this repo |
|---|---|---|---|---|---|---|
| `CH32F103C6T6` | 72MHz | 32K | 10K | USB D+H/D; CAN 1 | LQFP48 | no |
| `CH32F103C8U6` | 72MHz | 64K | 20K | USB D+H/D; CAN 1 | QFN48X7 | no |
| `CH32F103C8T6` | 72MHz | 64K | 20K | USB D+H/D; CAN 1 | LQFP48 | no |
| `CH32F103R8T6` | 72MHz | 64K | 20K | USB D+H/D; CAN 1 | LQFP64M | no |
| `CH32F203C6T6` | 144MHz | 32K | 10K | USB D+H/D; CAN 1 | LQFP48 | no |
| `CH32F203K8T6` | 144MHz | 64K | 20K | USB D; CAN 1 | LQFP32 | no |
| `CH32F203C8T6` | 144MHz | 64K | 20K | USB D+H/D; CAN 1 | LQFP48 | no |
| `CH32F203C8U6` | 144MHz | 64K | 20K | USB D+H/D; CAN 1 | QFN48X7 | no |
| `CH32F203CBT6` | 144MHz | 128K | 32K | USB D; CAN 1 | LQFP48 | no |
| `CH32F203RBT6` | 144MHz | 128K | 32K | USB D; CAN 1 | LQFP64M | no |
| `CH32F203RCT6` | 144MHz | 256K | 64K | USB D; CAN 1 | LQFP64M | no |
| `CH32F203VCT6` | 144MHz | 256K | 64K | USB D; CAN 1 | LQFP100 | no |
| `CH32F205RBT6` | 144MHz | 128K | 32K | USB H/D built-in PHY; CAN 2 | LQFP64M | no |
| `CH32F207VCT6` | 144MHz | 256K | 64K | USB H/D built-in PHY; ETH 1G MAC+10M PHY; CAN 2 | LQFP100 | no |
| `CH32F208RBT6` | 144MHz | 128K | 64K | USB D+H/D; BLE 5.3; ETH 10M; CAN 1 | LQFP64M | no |
| `CH32F208WBU6` | 144MHz | 128K | 64K | USB D+H/D; BLE 5.3; ETH 10M; CAN 1 | QFN68 | no |

### E8051 USB — CH54x / CH55x, E8051 core

| Part | Freq | Flash | RAM | Notable | Package | In this repo |
|---|---|---|---|---|---|---|
| `CH541` | 24MHz | 16K | 256+256 | USB D | TSSOP20/SOP16 | no |
| `CH543` | 24MHz | 16K | 256+256 | USB H/D | QFN20 | no |
| `CH546` | 32MHz | 35K | 1K+256 | USB 1*D | LQFP48/SOP16 | no |
| `CH548` | 32MHz | 35K | 2K+256 | USB 1*H/1*D | LQFP48/SOP16/SOP8 | no |
| `CH547` | 32MHz | 63K | 1K+256 | USB 1*D | LQFP48/QFN28/SOP16 | no |
| `CH549` | 32MHz | 63K | 2K+256 | USB 1*H/1*D | LQFP48/QFN28/SOP16 | no |
| `CH545` | 32MHz | 63K | 8K+256 | USB 4*H/17*D | LQFP64 | no |
| `CH551` | 24MHz | 10K | 512+256 | USB 1*D | SOP16 | no |
| `CH552` | 24MHz | 16K | 1K+256 | USB 1*D | TSSOP20/SOP16/MSOP10/QFN16 | no |
| `CH554` | 24MHz | 16K | 1K+256 | USB 1*H/1*D | TSSOP20/SOP16/MSOP10/QFN16 | no |
| `CH558` | 56MHz | 35K | 4K+256 | USB 1*D | LQFP48/SSOP20 | no |
| `CH559` | 56MHz | 63K | 6K+256 | USB 2*H/1*D | LQFP48/SSOP20 | no |
| `CH555` | 32MHz | 63K | 8K+256 | USB 1*D | LQFP48/LQFP64 | no |
| `CH557` | 32MHz | 63K | 8K+256 | USB 4*H/1*D | LQFP48/LQFP64 | no |

### Minimalist assembly — CH52x / CH53x, 8-bit RISC OTP core

| Part | Freq | Flash | RAM | Notable | Package | In this repo |
|---|---|---|---|---|---|---|
| `CH521` | 6MHz | OTP-1K*16 | 80 | USB PD Type-C or analog applications | SOT23-6 | no |
| `CH522` | 6MHz | OTP-1K5*16 | 80 | USB PD Type-C or analog applications | ESSOP10/QFN16 | no |
| `CH525` | 6MHz | OTP-1K75*16 | 96 | USB PD Type-C or analog applications | SSOP10/SOT23-6 | no |
| `CH527` | 6MHz | OTP-2K*16 | 128 | USB PD Type-C or analog applications | ESSOP10 | no |
| `CH531` | 12MHz | OTP-1K*16 | 192 | USB or IO control | SOP16/SOP8/SSOP10 | no |
| `CH532` | 12MHz | iFlash-2K*16 | 256 | USB or IO control | SOP28/SOP16/QFN28 | no |
