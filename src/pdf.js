/**
 * pdf.js — a PDF writer for exactly one job: N full-page images, one per page.
 *
 * Why hand-rolled: the alternative was a PDF library (a dependency, on a ₦0
 * budget) or printing through Puppeteer. Puppeteer would have meant a second
 * HTML document that tiles the slides, and templates/carousel.html having a
 * sibling that also lays out slides is exactly the drift the architecture is
 * built to prevent. Embedding the PNGs we already render keeps one layout file.
 *
 * The images go in losslessly. PDF images carry no alpha channel, so the only
 * information that can be lost is transparency, which the slides don't use —
 * see dropAlpha(). No JPEG step, so text edges stay exact.
 */
import { inflateSync, deflateSync } from 'node:zlib';

// Page width in points. 540pt = 7.5in, so a 1080px slide lands at 144 dpi:
// sharp in print, and a fraction of the size a 300 dpi upscale would cost.
// Height follows each image's own ratio, so a non-4:5 render still fits.
const PAGE_WIDTH_PT = 540;

// Samples per pixel by PNG colour type. 3 (palette) is deliberately absent —
// see the guard in decodePng.
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * PNG → raw 8-bit samples. Handles what Chrome's screenshots actually are
 * (non-interlaced, 8-bit, RGB or RGBA) and refuses everything else loudly
 * rather than writing a PDF full of garbage pixels.
 */
function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let header = null;
  const idat = [];
  for (let p = 8; p + 8 <= buf.length; ) {
    const length = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + length; // 4 length + 4 type + data + 4 CRC
  }
  if (!header) throw new Error('PNG has no IHDR');

  const channels = CHANNELS[header.colorType];
  if (!channels || header.bitDepth !== 8 || header.interlace !== 0) {
    throw new Error(
      `unsupported PNG: bitDepth ${header.bitDepth}, colorType ${header.colorType}, interlace ${header.interlace}`
    );
  }
  const data = unfilter(inflateSync(Buffer.concat(idat)), header.width, header.height, channels);
  return { ...header, channels, data };
}
/**
 * Undo PNG's per-scanline delta filters. Each row is prefixed with a filter
 * byte and encoded against the pixel to its left (a), the one above (b) and the
 * one above-left (c) — so decoding has to run in order, top to bottom.
 */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) throw new Error('PNG data is short — truncated file?');
  const out = Buffer.alloc(stride * height);

  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = out.subarray(y * stride, (y + 1) * stride);
    raw.copy(row, 0, src, src + stride);
    src += stride;
    if (filter === 0) continue;
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      switch (filter) {
        case 1: row[i] = (row[i] + a) & 0xff; break;
        case 2: row[i] = (row[i] + b) & 0xff; break;
        case 3: row[i] = (row[i] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const c = prev && i >= bpp ? prev[i - bpp] : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          row[i] = (row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default: throw new Error(`bad PNG filter ${filter} on row ${y}`);
      }
    }
  }
  return out;
}

/**
 * PDF image XObjects have no alpha channel, so a 4-channel screenshot must lose
 * one. The slides are opaque, so this is a straight drop; a genuinely
 * transparent pixel is composited onto white, which is what paper is anyway.
 */
function dropAlpha(data, channels, width, height) {
  if (channels !== 2 && channels !== 4) return { data, colors: channels };
  const colors = channels - 1;
  const out = Buffer.alloc(width * height * colors);
  for (let i = 0, o = 0; i < data.length; i += channels) {
    const alpha = data[i + colors];
    for (let c = 0; c < colors; c++) {
      out[o++] = alpha === 255
        ? data[i + c]
        : Math.round((data[i + c] * alpha + 255 * (255 - alpha)) / 255);
    }
  }
  return { data: out, colors };
}
/**
 * PNG buffers → a one-image-per-page PDF.
 *
 * Object numbering is assigned as we go; the catalog and the page tree are
 * reserved first because every page has to name the page tree as its parent and
 * the tree has to list every page — the two references point at each other.
 *
 * @param {(Buffer|Uint8Array)[]} pngs one per page, in order
 * @returns {Buffer}
 */
export function imagesToPdf(pngs) {
  if (!pngs?.length) throw new Error('imagesToPdf: nothing to write');

  const objects = [];
  const reserve = () => { objects.push(null); return objects.length; };
  const set = (id, body) => {
    objects[id - 1] = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'latin1');
    return id;
  };
  const put = (body) => set(reserve(), body);
  const stream = (dict, bytes) => Buffer.concat([
    Buffer.from(`<< ${dict}${dict ? ' ' : ''}/Length ${bytes.length} >>\nstream\n`, 'latin1'),
    bytes,
    Buffer.from('\nendstream', 'latin1'),
  ]);

  const catalogId = reserve();
  const pagesId = reserve();
  const pageIds = [];

  for (const png of pngs) {
    const { width, height, channels, data } = decodePng(Buffer.from(png));
    const { data: samples, colors } = dropAlpha(data, channels, width, height);

    const imageId = put(stream(
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height}`
      + ` /ColorSpace /Device${colors === 1 ? 'Gray' : 'RGB'} /BitsPerComponent 8 /Filter /FlateDecode`,
      deflateSync(samples, { level: 6 })
    ));

    const w = PAGE_WIDTH_PT;
    const h = Math.round((PAGE_WIDTH_PT * height) / width);
    // `w 0 0 h 0 0 cm` scales the 1×1 unit image up to fill the page exactly.
    const contentId = put(stream('', Buffer.from(`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`, 'latin1')));

    pageIds.push(put(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}]`
      + ` /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
    ));
  }

  set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  set(pagesId,
    `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] >>`);

  // The four high bytes in the header comment are the conventional marker that
  // says "treat this file as binary" to anything transferring it as text.
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [];
  let at = chunks[0].length;
  objects.forEach((body, i) => {
    const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    offsets.push(at);
    chunks.push(head, body, tail);
    at += head.length + body.length + tail.length;
  });

  // The xref table is a byte index into the file, which is why every offset is
  // accumulated above rather than measured afterwards.
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n`
    + `startxref\n${at}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(chunks);
}
