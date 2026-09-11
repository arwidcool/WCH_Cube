// zip.js — the browser has no filesystem, and a project is a folder.
import { test, assert, fresh, eng } from './_harness.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const { zipFiles, crc32, utf8 } = eng;

test('crc32 matches the published vectors, so the archive is not subtly wrong', () => {
  // A ZIP with a wrong CRC unpacks in some tools and fails in others, which is the
  // worst possible failure mode. These are the standard IEEE 802.3 check values.
  assert.equal(crc32(utf8('')), 0);
  assert.equal(crc32(utf8('a')), 0xE8B7BE43);
  assert.equal(crc32(utf8('abc')), 0x352441C2);
  assert.equal(crc32(utf8('123456789')), 0xCBF43926);
  assert.equal(crc32(utf8('The quick brown fox jumps over the lazy dog')), 0x414FA339);
});

test('utf8 encodes what TextEncoder would, including outside the BMP', () => {
  const enc = new TextEncoder();
  for (const s of ['', 'plain', 'naïve', 'π ≈ 3.14159', 'Ω—…', '日本語', '🙂 emoji', 'a\nb\tc']) {
    assert.deepEqual([...utf8(s)], [...enc.encode(s)], JSON.stringify(s));
  }
});

test('the archive has the structure the format requires', () => {
  const z = zipFiles([{ path: 'a/b.txt', text: 'hello' }, { path: 'c.md', text: '# hi' }]);
  const u32 = at => z[at] | (z[at + 1] << 8) | (z[at + 2] << 16) | (z[at + 3] << 24);
  assert.equal(u32(0) >>> 0, 0x04034B50, 'a local file header first');

  // the end-of-central-directory record is the last 22 bytes when there is no comment
  const end = z.length - 22;
  assert.equal(u32(end) >>> 0, 0x06054B50, 'end of central directory');
  const count = z[end + 10] | (z[end + 11] << 8);
  assert.equal(count, 2, 'two entries');
  const dirStart = u32(end + 16) >>> 0;
  assert.equal(u32(dirStart) >>> 0, 0x02014B50, 'the central directory starts where it says');
  const dirSize = u32(end + 12) >>> 0;
  assert.equal(dirStart + dirSize, end, 'and it ends exactly where the EOCD begins');
});

test('two runs of the same input produce the same bytes', () => {
  const files = [{ path: 'src/main.c', text: 'int main(void){return 0;}\n' }];
  const a = zipFiles(files);
  const b = zipFiles(files);
  assert.deepEqual([...a], [...b],
    'a `new Date()` in the header would break the one artefact people diff');
});

test('a path that would escape the archive is refused', () => {
  assert.throws(() => zipFiles([{ path: '../evil.txt', text: 'x' }]), /escapes the archive root/);
  assert.throws(() => zipFiles([{ path: 'a/../../evil', text: 'x' }]), /escapes the archive root/);
  assert.throws(() => zipFiles([{ path: '', text: 'x' }]), /has no path/);
  // a Windows separator becomes the one the format requires
  const z = zipFiles([{ path: 'a\\b.txt', text: 'x' }]);
  assert.ok(Buffer.from(z).includes(Buffer.from('a/b.txt')), 'entry names use forward slashes');
});

test('a real unzipper accepts it, which is the only proof that counts', () => {
  // Windows' own Expand-Archive, not our reader parsing our writer.
  if (process.platform !== 'win32') return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wchcube-zip-'));
  try {
    const zip = path.join(dir, 'x.zip');
    fs.writeFileSync(zip, zipFiles([
      { path: 'proj/src/main.c', text: 'int main(void) { return 0; }\n' },
      { path: 'proj/README.md', text: '# proj\n\nunicode: naïve π 日本語\n' },
    ]));
    const out = path.join(dir, 'out');
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Path '${zip}' -DestinationPath '${out}' -Force`], { encoding: 'utf8' });
    if (r.error) return;                       // no powershell here; the other tests still ran
    assert.equal(r.status, 0, `Expand-Archive refused the archive: ${r.stderr}`);
    assert.equal(fs.readFileSync(path.join(out, 'proj', 'src', 'main.c'), 'utf8'),
      'int main(void) { return 0; }\n', 'the folder structure and the bytes survive');
    assert.match(fs.readFileSync(path.join(out, 'proj', 'README.md'), 'utf8'), /naïve π 日本語/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('projectZip packs the whole project under one folder', () => {
  const e = fresh('CH32V006', 'TSSOP20');
  e.setProject({ name: 'Zip Demo!', variant: 'CH32V006F8P7' });
  e.compute();
  const z = e.projectZip();
  assert.equal(z.name, 'Zip_Demo_.zip', 'the name is safe as a file name');
  assert.ok(z.bytes.length > 1000);

  const text = Buffer.from(z.bytes).toString('latin1');
  for (const f of e.projectFiles()) {
    assert.ok(text.includes(`Zip_Demo_/${f.path}`),
      `${f.path} is under the project folder, not loose in Downloads`);
  }
  assert.deepEqual([...e.projectZip().bytes], [...z.bytes], 'and it is deterministic');
});
