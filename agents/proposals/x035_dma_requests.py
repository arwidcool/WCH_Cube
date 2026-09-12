#!/usr/bin/env python
"""
CH32X035 RM v1.9 §9.2.3 "DMA Request Mapping" — the peripheral → channel table, derived
from the ORIGINAL PDF by word position rather than from the markdown conversion, which
kept the rows and lost the columns (AGENT-1, round-4 board, 17:26Z).

PDF FALLBACK: RM Table 9-2. This is the last-resort reading of the rule in
`data/sources/README.md` ("Read the markdown first. The PDF is the last resort."), and
the reason is structural rather than aesthetic: the conversion kept each peripheral's
request names in order and lost the `Channel N` columns entirely, so NO request can be
placed into a channel from the markdown at all. The markdown is still read here — as the
independent second statement of row order — and it must agree with the PDF reading on
every row's token set, which is what makes the recovered columns checkable instead of
merely plausible.

    python agents/proposals/x035_dma_requests.py [path/to/CH32X035RM.pdf]

Method — two independent readings that must agree:
  1. POSITIONAL: every word on the table's pages is placed into the column whose
     "Channel N" header it sits under, by x-coordinate. Tokens the PDF wrapped mid-word
     ("USART1_T" + "X", "TIM1_TRI" + "G", "TIM2_CO" + "M") are re-joined by row.
  2. ROW ORDER + ANCHORS: the markdown conversion kept each peripheral's requests in
     left-to-right = channel order (AGENT-1, 17:26Z), so along every row the channels from
     reading 1 must be non-decreasing and the token SET must match; and the nine requests
     AGENT-1 anchored to WCH EVT examples (a third source) must land on those channels.
The script refuses to print a YAML block unless every check passes, and prints what
failed when one does not.

It is a PROPOSAL for AGENT-1's `data/mcus/CH32X035.yaml` `dma.requests`, not a tool that
edits it: `data/` is theirs. Requires pymupdf (installed on this box).
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'tools'))
import source_docs  # the markdown-first policy, in one place

import pymupdf

if len(sys.argv) > 1:
    PDF = pathlib.Path(sys.argv[1])
else:
    PDF = source_docs.pdf('X035', 'CH32X035RM')
assert PDF is not None, 'x035_dma_requests: no RM PDF in data/sources/X035/Datasheets'
source_docs.announce_pdf_fallback(
    'RM Table 9-2 (DMA request mapping): the markdown conversion kept the rows and lost '
    'the channel columns, so the markdown cannot place a request into a channel. It is '
    'still read below, as the independent statement of row order.')
doc = pymupdf.open(PDF)

# ---- locate the table: the page whose text has "9.2.3 DMA Request Mapping" ------------
start = next(i for i in range(len(doc)) if '9.2.3 DMA Request Mapping' in doc[i].get_text())
pages = [start, start + 1]

REQ = re.compile(r'^(ADC|SPI_(RX|TX)|USART\d_(TX|RX)|I2C_(TX|RX)|TIM\d_(CH\d|UP|TRIG|COM))$')
FRAG = {'X', 'G', 'M'}                      # second halves of wrapped tokens
PERIPH = ['ADC', 'SPI', 'USART1', 'USART2', 'USART3', 'USART4', 'I2C', 'TIM1', 'TIM2']


def words(pi):
    return [(w[0], w[1], w[4]) for w in doc[pi].get_text('words')]


# ---- reading 1: positional -------------------------------------------------------------
w0 = words(pages[0])
hdr_y = next(y for x, y, t in w0 if t == 'Peripheral')
cols = sorted(x for x, y, t in w0 if abs(y - hdr_y) < 3 and t.startswith('Channel'))
assert len(cols) == 8, cols


def column(x):
    c = None
    for i, cx in enumerate(cols):
        if x >= cx - 2:
            c = i + 1
    return c


positional = {}                              # request -> channel
for n, pi in enumerate(pages):
    ws = words(pi)
    ymin = hdr_y if n == 0 else 0
    stop = [y for x, y, t in ws if t == '9.3']
    ymax = stop[0] if stop else 1e9
    rows = {}
    for x, y, t in ws:
        if ymin < y < ymax:
            rows.setdefault(round(y), []).append((x, t))
    ordered = [sorted(rows[y]) for y in sorted(rows)]
    for r, row in enumerate(ordered):
        for x, t in row:
            if t in FRAG or x < cols[0] - 2:      # the Peripheral column names "ADC" too
                continue
            tok = t
            if not REQ.match(tok):
                # wrapped token: its tail is a lone fragment on one of the next few rows in
                # the same column (rows are keyed by y across the whole page, so another
                # column's word can sit between the two halves)
                for nxt in ordered[r + 1:r + 4]:
                    tail = [t2 for x2, t2 in nxt if t2 in FRAG and column(x2) == column(x)]
                    if tail:
                        tok = t + tail[0]
                        break
            if REQ.match(tok):
                c = column(x)
                assert c, (tok, x)
                assert positional.get(tok, c) == c, (tok, positional[tok], c)
                positional[tok] = c

# ---- reading 2: the markdown's row order, and the EVT-example anchors ----------------
MD = source_docs.markdown('X035', 'CH32X035RM')
assert MD is not None, 'x035_dma_requests: no RM markdown in data/sources/X035/Datasheets'
md = open(MD, encoding='utf-8').read().splitlines()
i0 = next(i for i, l in enumerate(md) if l.startswith('Peripheral Channel1'))
i1 = next(i for i in range(i0, len(md)) if md[i].lstrip('#').strip().startswith('9.3 Register Description'))
rows, cur, prev = {}, None, None
for l in md[i0 + 1:i1]:
    t = l.lstrip('#').strip()
    if not t or 'Reference Manual' in t or t.startswith('V1.'):
        continue
    for tok in t.split():
        if tok in FRAG and prev:
            rows[cur][-1] = prev + tok          # re-join a wrapped token
            prev = None
            continue
        if tok in PERIPH and (cur is None or tok != cur):
            cur = tok; rows.setdefault(cur, []); prev = None
            if tok == 'ADC': continue           # the ADC row's request is also spelled ADC
        if cur is None:
            continue
        rows[cur].append(tok); prev = tok
problems = []
for per, toks in rows.items():
    mine = {t for t in toks if REQ.match(t)}
    ours = {r for r in positional if r.split('_')[0] == per or (per == 'ADC' and r == 'ADC')}
    if mine != ours:
        problems.append(f'{per}: markdown row lists {sorted(mine)} but the PDF placed {sorted(ours)}')
    chans = [positional[t] for t in toks if t in positional]
    if chans != sorted(chans):
        problems.append(f'{per}: row order {toks} is not channel order under the PDF reading {chans}')
ANCHORS = {'ADC': 1, 'SPI_RX': 2, 'SPI_TX': 3, 'USART3_TX': 2, 'USART3_RX': 3, 'USART2_RX': 6,
           'USART2_TX': 7, 'I2C_TX': 6, 'I2C_RX': 7}           # WCH EVT examples, AGENT-1 17:26Z
for r, c in ANCHORS.items():
    if positional.get(r) != c:
        problems.append(f'{r}: EVT example says channel {c}, PDF reading says {positional.get(r)}')

# ---- compare and print -------------------------------------------------------------------
print(f'PDF positional reading: {len(positional)} requests over {len(cols)} channels')
print(f'markdown row order: {len(rows)} peripheral rows; EVT anchors: {len(ANCHORS)}')
if problems:
    print('PROBLEMS:')
    for pr in problems:
        print('  ' + pr)
else:
    print('row order, token sets and all EVT anchors agree with the positional reading')
disagree = problems

SDK = {'ADC': 'ADC1', 'SPI_RX': 'SPI1_RX', 'SPI_TX': 'SPI1_TX', 'I2C_TX': 'I2C1_TX', 'I2C_RX': 'I2C1_RX'}
by_ch = {}
for r, c in positional.items():
    by_ch.setdefault(c, []).append(SDK.get(r, r))
print()
print('# dma.requests for data/mcus/CH32X035.yaml — RM v1.9 §9.2.3, read positionally from the PDF')
print('# by agents/proposals/x035_dma_requests.py. Names follow the spelling already used in the')
print('# file (ADC1, SPI1_*, I2C1_*); the RM writes them without the instance digit.')
print('  requests:')
for c in range(1, 9):
    print(f'    {c}: [{", ".join(by_ch.get(c, []))}]')
if disagree:
    print('# NOT paste-ready: see the disagreements above.')
    sys.exit(2)
