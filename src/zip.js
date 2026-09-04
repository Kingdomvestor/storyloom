/**
 * zip.js — a ZIP writer in ~90 lines, no dependency.
 *
 * Why hand-rolled: the only archive this app will ever build is "N PNGs, flat,
 * no directories, no encryption, no zip64". That is the simplest possible ZIP,
 * and pulling a library in for it would add a dependency to a ₦0 project for
 * code we can read in one sitting.
 *
 * The format, for anyone maintaining this: for each entry a local header + the
 * bytes, then a central directory repeating the same metadata, then a 22-byte
 * end-of-central-directory record pointing at where the directory starts. The
 * directory is what unzippers actually read, which is why every number appears
 * twice and both copies have to agree.
 */
import { deflateRawSync } from 'node:zlib';

// CRC-32 (IEEE 802.3), the checksum ZIP requires per entry. Table built once.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// MS-DOS date/time: 2-second resolution, epoch 1980. Preserved because some
// tools show 1980-01-01 for a zero here and it reads as a corrupt archive.
const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

/**
 * Build a ZIP archive.
 *
 * @param {{name: string, data: Buffer|Uint8Array}[]} entries flat file list
 * @param {Date} [when] timestamp stamped on every entry
 * @returns {Buffer}
 */
export function zipSync(entries, when = new Date()) {
  const time = dosTime(when);
  const date = dosDate(when);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(raw);

    // PNG bytes are already deflated, so compressing them again usually *grows*
    // the entry. Try it, keep whichever is smaller, and record the method that
    // matches what we actually wrote.
    const squeezed = deflateRawSync(raw, { level: 6 });
    const stored = squeezed.length >= raw.length;
    const body = stored ? raw : squeezed;
    const method = stored ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed: 2.0
    local.writeUInt16LE(0, 6);            // no flags — sizes are known up front
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);           // no extra field
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);         // extra
    central.writeUInt16LE(0, 32);         // comment
    central.writeUInt16LE(0, 34);         // disk number
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // where this entry's local header is
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central directory
  end.writeUInt16LE(0, 4);                // this disk
  end.writeUInt16LE(0, 6);                // disk with the directory
  end.writeUInt16LE(entries.length, 8);   // entries on this disk
  end.writeUInt16LE(entries.length, 10);  // entries total
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);          // directory starts here
  end.writeUInt16LE(0, 20);               // no archive comment

  return Buffer.concat([...locals, directory, end]);
}
