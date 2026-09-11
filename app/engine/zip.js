// =============================================================================
//  zip.js — a ZIP writer, because the browser has no filesystem.
//
//  The desktop build writes a project folder through Tauri. The browser can only
//  hand the user a download, and a project is a folder, so it has to be one file
//  that unpacks into a folder. That means a ZIP, and the app is a single offline
//  HTML file with no bundler, so it means writing one.
//
//  Sixty lines rather than a library, and deliberately the SIMPLEST correct ZIP:
//  every entry is STORED (compression method 0, no deflate). A generated project
//  is a few tens of kilobytes of text; the compression would save a rounding
//  error and cost a deflate implementation that would have to be right.
//
//  Format: APPNOTE.TXT 6.3.4, sections 4.3.7 (local file header), 4.3.12
//  (central directory header) and 4.3.16 (end of central directory). Only the
//  fields those sections require are written, and nothing is guessed:
//  - version needed: 20 (2.0), the floor for a stored entry with these fields
//  - general purpose flag bit 11 set, which declares the name is UTF-8 (4.4.4)
//  - no data descriptor, because sizes and CRC are known before writing
//  - no Zip64, and an entry or archive over 4 GB is refused rather than
//    silently truncated - a configurator cannot produce one, and writing a
//    format field we cannot test is how a corrupt archive gets shipped
//
//  Determinism: every timestamp is FIXED. Round 3's rule is that regenerating
//  the same configuration produces byte-identical output, and `new Date()` would
//  break that for the one artefact a user is most likely to diff.
// =============================================================================

// CRC-32, the standard IEEE table. Built once, lazily.
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (CRC_TABLE = t);
}

export function crc32(bytes) {
  const t = crcTable();
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// UTF-8, without assuming TextEncoder: the engine runs in Node, in a browser and
// inside Tauri's webview, and this is twenty lines against a capability check.
export function utf8(str) {
  const s = String(str);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.codePointAt(i);
    if (cp > 0xFFFF) i++;                       // a surrogate pair is one code point
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

// A fixed DOS date/time: 2020-01-01 00:00:00. DOS packs the year as (year-1980)
// in bits 9-15, the month in 5-8 and the day in 0-4; the time field has
// two-second resolution, which is why 0 is exactly midnight.
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

const MAX = 0xFFFFFFFF;

function push32(a, v) { a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }
function push16(a, v) { a.push(v & 255, (v >>> 8) & 255); }

/**
 * Build a ZIP from `[{ path, text }]` (or `{ path, bytes }`). Returns a Uint8Array.
 *
 * `path` is used verbatim as the entry name with `/` separators, which is what the
 * format requires (4.4.17.1: the name must not contain a drive letter and must use
 * forward slashes), so the same list that writes a folder on disk zips correctly.
 */
export function zipFiles(files) {
  const entries = [];
  const out = [];
  let offset = 0;

  for (const f of files) {
    const name = String(f.path || f.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name) throw new Error('zip: an entry has no path');
    if (name.includes('..')) throw new Error(`zip: "${name}" escapes the archive root`);
    const nameBytes = utf8(name);
    const body = f.bytes ? Uint8Array.from(f.bytes) : utf8(f.text == null ? '' : f.text);
    if (body.length > MAX) throw new Error(`zip: "${name}" is over 4 GB; this writer has no Zip64`);
    const crc = crc32(body);

    const local = [];
    push32(local, 0x04034B50);          // local file header signature
    push16(local, 20);                  // version needed to extract: 2.0
    push16(local, 0x0800);              // flags: bit 11, the name is UTF-8
    push16(local, 0);                   // method: 0 = stored
    push16(local, DOS_TIME);
    push16(local, DOS_DATE);
    push32(local, crc);
    push32(local, body.length);         // compressed size == uncompressed, stored
    push32(local, body.length);
    push16(local, nameBytes.length);
    push16(local, 0);                   // extra field length
    out.push(Uint8Array.from(local), nameBytes, body);
    entries.push({ nameBytes, crc, size: body.length, offset });
    offset += local.length + nameBytes.length + body.length;
    if (offset > MAX) throw new Error('zip: the archive is over 4 GB; this writer has no Zip64');
  }

  const dirStart = offset;
  for (const e of entries) {
    const c = [];
    push32(c, 0x02014B50);              // central directory header signature
    push16(c, 20);                      // version made by: 2.0, MS-DOS
    push16(c, 20);                      // version needed to extract
    push16(c, 0x0800);
    push16(c, 0);
    push16(c, DOS_TIME);
    push16(c, DOS_DATE);
    push32(c, e.crc);
    push32(c, e.size);
    push32(c, e.size);
    push16(c, e.nameBytes.length);
    push16(c, 0);                       // extra
    push16(c, 0);                       // comment
    push16(c, 0);                       // disk number start
    push16(c, 0);                       // internal attributes
    push32(c, 0);                       // external attributes
    push32(c, e.offset);                // offset of the local header
    out.push(Uint8Array.from(c), e.nameBytes);
    offset += c.length + e.nameBytes.length;
  }

  const end = [];
  push32(end, 0x06054B50);              // end of central directory signature
  push16(end, 0);                       // this disk
  push16(end, 0);                       // disk with the central directory
  push16(end, entries.length);
  push16(end, entries.length);
  push32(end, offset - dirStart);       // size of the central directory
  push32(end, dirStart);                // where it starts
  push16(end, 0);                       // comment length
  out.push(Uint8Array.from(end));

  let total = 0;
  for (const part of out) total += part.length;
  const buf = new Uint8Array(total);
  let at = 0;
  for (const part of out) { buf.set(part, at); at += part.length; }
  return buf;
}
