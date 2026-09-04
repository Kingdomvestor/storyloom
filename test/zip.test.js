/**
 * zip.test.js — read the archive back with a parser that shares no code with the
 * writer.
 *
 * The failure mode this guards is specific: a ZIP where the local headers and the
 * central directory disagree still *looks* like a file, and some tools open it
 * anyway. So the reader below deliberately navigates the way an unzipper does —
 * find the end record, walk the directory, follow each offset to a local header,
 * check the two copies match — instead of trusting the order zipSync wrote things.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync, crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { zipSync } from '../src/zip.js';

const SIG = { local: 0x04034b50, central: 0x02014b50, end: 0x06054b50 };

function readZip(buf) {
  const eo = buf.length - 22; // no archive comment, so the end record is last
  assert.equal(buf.readUInt32LE(eo), SIG.end, 'no end-of-central-directory record');
  const total = buf.readUInt16LE(eo + 10);
  const dirSize = buf.readUInt32LE(eo + 12);
  const dirAt = buf.readUInt32LE(eo + 16);
  assert.equal(buf.readUInt16LE(eo + 8), total, 'entry count differs between its two fields');
  assert.equal(dirAt + dirSize, eo, 'the directory does not end where the end record begins');

  const entries = [];
  let p = dirAt;
  for (let i = 0; i < total; i++) {
    assert.equal(buf.readUInt32LE(p), SIG.central, `central header ${i} has the wrong signature`);
    const method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const comp = buf.readUInt32LE(p + 20);
    const raw = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // Follow the offset the directory gives and require the local copy to agree.
    assert.equal(buf.readUInt32LE(at), SIG.local, `${name}: offset does not point at a local header`);
    const lNameLen = buf.readUInt16LE(at + 26);
    assert.equal(buf.toString('utf8', at + 30, at + 30 + lNameLen), name, `${name}: names differ`);
    assert.equal(buf.readUInt16LE(at + 8), method, `${name}: methods differ`);
    assert.equal(buf.readUInt32LE(at + 14), crc, `${name}: CRCs differ`);
    assert.equal(buf.readUInt32LE(at + 18), comp, `${name}: compressed sizes differ`);
    assert.equal(buf.readUInt32LE(at + 22), raw, `${name}: uncompressed sizes differ`);

    const start = at + 30 + lNameLen + buf.readUInt16LE(at + 28);
    const body = buf.subarray(start, start + comp);
    entries.push({
      name, method, crc, time, date, raw, comp,
      data: method === 8 ? inflateRawSync(body) : Buffer.from(body),
    });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return entries;
}

const noise = (n, seed = 'storyloom') => {
  // Deterministic but genuinely incompressible — chained digests, so deflate can
  // find no structure to exploit and `stored` is the branch under test.
  const parts = [];
  let block = Buffer.from(seed);
  for (let got = 0; got < n; got += block.length) {
    block = createHash('sha256').update(block).digest();
    parts.push(block);
  }
  return Buffer.concat(parts).subarray(0, n);
};

test('entries survive the round trip, and both copies of the metadata agree', () => {
  const files = [
    { name: 'deck-slide-01.png', data: noise(4096) },
    { name: 'deck-slide-02.png', data: Buffer.from('the second slide') },
  ];
  const entries = readZip(zipSync(files));

  assert.equal(entries.length, 2);
  entries.forEach((e, i) => {
    assert.equal(e.name, files[i].name);
    assert.deepEqual(e.data, files[i].data, `${e.name}: bytes changed`);
    assert.equal(e.raw, files[i].data.length);
    // An independent CRC oracle — a checksum computed by the same code it is
    // meant to check would agree with itself no matter how wrong it was.
    assert.equal(e.crc, crc32(files[i].data), `${e.name}: CRC is wrong`);
  });
});

test('already-compressed bytes are stored rather than grown', () => {
  // PNGs are deflated already; deflating again typically adds a few bytes, and an
  // export that is bigger than its contents is a bug users can see.
  const data = noise(8192, 'incompressible');
  const [entry] = readZip(zipSync([{ name: 'a.png', data }]));
  assert.equal(entry.method, 0, 'incompressible data should be stored');
  assert.equal(entry.comp, entry.raw);
  assert.deepEqual(entry.data, data);
});

test('compressible bytes are deflated and inflate back exactly', () => {
  const data = Buffer.from('slide '.repeat(2000));
  const [entry] = readZip(zipSync([{ name: 'a.txt', data }]));
  assert.equal(entry.method, 8, 'compressible data should be deflated');
  assert.ok(entry.comp < entry.raw, `expected a smaller entry, got ${entry.comp} vs ${entry.raw}`);
  assert.deepEqual(entry.data, data);
});

test('the timestamp is a real MS-DOS date, not a zero that reads as 1980', () => {
  const when = new Date(2026, 8, 4, 13, 45, 30); // 2026-09-04 13:45:30 local
  const [entry] = readZip(zipSync([{ name: 'a.png', data: Buffer.from('x') }], when));
  assert.deepEqual({
    year: 1980 + (entry.date >> 9),
    month: (entry.date >> 5) & 0b1111,
    day: entry.date & 0b11111,
    hours: entry.time >> 11,
    minutes: (entry.time >> 5) & 0b111111,
    seconds: (entry.time & 0b11111) * 2, // 2-second resolution, by format
  }, { year: 2026, month: 9, day: 4, hours: 13, minutes: 45, seconds: 30 });
});

test('names are measured in bytes, not characters', () => {
  // A multi-byte name with a character-count length would leave the reader
  // pointing one byte inside the file data and every following offset wrong.
  const name = 'wúrà-slide-01.png';
  const [entry] = readZip(zipSync([{ name, data: Buffer.from('x') }]));
  assert.equal(entry.name, name);
});

test('a Uint8Array is accepted as well as a Buffer', () => {
  const [entry] = readZip(zipSync([{ name: 'a.png', data: new Uint8Array([1, 2, 3, 4]) }]));
  assert.deepEqual(entry.data, Buffer.from([1, 2, 3, 4]));
});

test('an empty archive is still a valid archive', () => {
  const buf = zipSync([]);
  assert.equal(buf.length, 22, 'nothing but the end record');
  assert.deepEqual(readZip(buf), []);
});
