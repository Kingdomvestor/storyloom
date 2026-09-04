/**
 * pdf.test.js — encode PNGs here, decode the PDF back, compare pixels.
 *
 * pdf.js contains a PNG decoder and a PDF writer, and its docstring makes a
 * specific promise: the images go in losslessly. That is only checkable against a
 * PNG whose exact bytes are known, so this file writes its own encoder rather
 * than reading a fixture — and encodes the same image five times, once per PNG
 * row filter, because the filters are where an off-by-one hides.
 *
 * A corrupt PDF is not a crash. It is a file that opens on one reader and shows
 * blank pages on another, which is why the xref offsets are checked as bytes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync, crc32 } from 'node:zlib';
import { imagesToPdf } from '../src/pdf.js';

const SAMPLES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const chunk = (type, body) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])), 0);
  return Buffer.concat([head, body, crc]);
};

/** Apply one PNG row filter. Neighbours are raw bytes — what a decoder rebuilds. */
function applyFilter(kind, row, prev, bpp) {
  const out = Buffer.alloc(row.length);
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let pred = 0;
    if (kind === 1) pred = a;
    else if (kind === 2) pred = b;
    else if (kind === 3) pred = (a + b) >> 1;
    else if (kind === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i] = (row[i] - pred) & 0xff;
  }
  return out;
}

function encodePng({ width, height, pixels, colorType = 2, filter = 0, bitDepth = 8, interlace = 0 }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;

  const bpp = SAMPLES[colorType] * (bitDepth / 8);
  const stride = width * bpp;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    rows.push(Buffer.from([filter]), applyFilter(filter, row, prev, bpp));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Walk the xref table the way a reader does: every offset must land on its object. */
function readPdf(buf) {
  const text = buf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'), 'missing the PDF header');
  assert.ok(text.endsWith('%%EOF\n'), 'missing the EOF marker');

  const startxref = Number(text.slice(text.lastIndexOf('startxref') + 9).trim().split(/\s/)[0]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref', 'startxref does not point at the table');

  const rows = [...text.slice(startxref).matchAll(/^(\d{10}) \d{5} ([nf]) $/gm)];
  const size = Number(/\/Size (\d+)/.exec(text)[1]);
  assert.equal(rows.length, size, 'the xref table does not have /Size rows');
  rows.slice(1).forEach(([, off], i) => {
    assert.equal(text.slice(Number(off)).startsWith(`${i + 1} 0 obj\n`), true,
      `xref row ${i + 1} points at ${JSON.stringify(text.slice(Number(off), Number(off) + 12))}`);
  });

  const pages = [...text.matchAll(/\/Type \/Page \/Parent \d+ 0 R \/MediaBox \[0 0 (\d+) (\d+)\]/g)]
    .map(([, w, h]) => ({ w: Number(w), h: Number(h) }));
  return { text, pages, count: Number(/\/Type \/Pages \/Count (\d+)/.exec(text)[1]) };
}

/** Every image XObject: its dictionary, and its stream inflated back to samples. */
function images(buf) {
  const text = buf.toString('latin1');
  const out = [];
  for (let at = 0; ;) {
    const i = text.indexOf('/Subtype /Image', at);
    if (i === -1) return out;
    const dictEnd = text.indexOf('>>', i);
    const dict = text.slice(text.lastIndexOf('<<', i), dictEnd);
    const len = Number(/\/Length (\d+)/.exec(dict)[1]);
    const start = text.indexOf('stream\n', dictEnd) + 7;
    out.push({ dict, data: inflateSync(buf.subarray(start, start + len)) });
    at = start + len;
  }
}

// A 4x3 RGB image with no two bytes alike, so a shifted or transposed row shows up.
const RGB = { width: 4, height: 3, pixels: Buffer.from(Array.from({ length: 36 }, (_, i) => (i * 7 + 3) & 0xff)) };

test('one page per image, each sized to its own aspect ratio', () => {
  const pdf = imagesToPdf([
    encodePng(RGB),                                             // 4x3
    encodePng({ ...RGB, width: 3, height: 4 }),                  // 3x4, same bytes
  ]);
  const { pages, count } = readPdf(pdf);
  assert.equal(count, 2, '/Count disagrees with the pages written');
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0], { w: 540, h: 405 });  // 540 * 3/4
  assert.deepEqual(pages[1], { w: 540, h: 720 });  // 540 * 4/3
});

test('the pixels go in losslessly, exactly as the docstring claims', () => {
  const [img] = images(imagesToPdf([encodePng(RGB)]));
  assert.match(img.dict, /\/Width 4\b/);
  assert.match(img.dict, /\/Height 3\b/);
  assert.match(img.dict, /\/ColorSpace \/DeviceRGB\b/);
  assert.match(img.dict, /\/BitsPerComponent 8\b/);
  assert.match(img.dict, /\/Filter \/FlateDecode\b/);
  assert.deepEqual(img.data, RGB.pixels, 'the samples came back changed');
});

test('all five PNG row filters decode to the same image', () => {
  const decoded = [0, 1, 2, 3, 4].map((filter) => images(imagesToPdf([encodePng({ ...RGB, filter })]))[0].data);
  for (const [i, data] of decoded.entries()) {
    assert.deepEqual(data, RGB.pixels, `filter ${i} decoded wrong`);
  }
});

test('alpha is composited onto white rather than dropped blindly', () => {
  // Three pixels, same colour, alpha 255 / 0 / 128. Expected values are the
  // arithmetic written out by hand, not the formula from pdf.js re-run.
  const pixels = Buffer.from([10, 20, 30, 255, 10, 20, 30, 0, 10, 20, 30, 128]);
  const [img] = images(imagesToPdf([encodePng({ width: 3, height: 1, colorType: 6, pixels })]));
  assert.match(img.dict, /\/ColorSpace \/DeviceRGB\b/);
  assert.deepEqual(img.data, Buffer.from([10, 20, 30, 255, 255, 255, 132, 137, 142]));
});

test('grayscale stays one sample per pixel', () => {
  const pixels = Buffer.from([0, 64, 128, 255]);
  const [img] = images(imagesToPdf([encodePng({ width: 4, height: 1, colorType: 0, pixels })]));
  assert.match(img.dict, /\/ColorSpace \/DeviceGray\b/);
  assert.deepEqual(img.data, pixels);
});

test('refuses what it cannot decode instead of writing garbage pixels', () => {
  const cases = {
    'palette PNGs': { ...RGB, colorType: 3 },
    '16-bit PNGs': { ...RGB, bitDepth: 16 },
    'interlaced PNGs': { ...RGB, interlace: 1 },
  };
  for (const [label, opts] of Object.entries(cases)) {
    assert.throws(() => imagesToPdf([encodePng(opts)]), /unsupported PNG/, label);
  }

  assert.throws(() => imagesToPdf([Buffer.from('this is not a PNG at all')]), /not a PNG/);
  assert.throws(() => imagesToPdf([]), /nothing to write/);
  assert.throws(() => imagesToPdf(null), /nothing to write/);

  // A PNG whose IDAT is one row short — what a partial download produces. The
  // header says three rows, the data carries two; nothing in the bytes is
  // malformed, which is exactly why it has to be caught by the length check.
  const short = encodePng({ ...RGB, height: 2 });
  short.writeUInt32BE(3, 20); // IHDR height, 8 (signature) + 8 (len+type) + 4 (width)
  assert.throws(() => imagesToPdf([short]), /short|truncated/);
});
