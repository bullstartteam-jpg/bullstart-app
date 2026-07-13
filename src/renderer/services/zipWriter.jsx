// Minimal ZIP writer (store method, no compression). Enough to bundle
// already-compressed images (PNG/JPEG) into a single downloadable archive,
// so we avoid pulling in a JSZip dependency just for the QR-design export.
//
// Limitations: no ZIP64, so keep archives under 4 GB and 65 535 entries — far
// beyond any realistic order-design batch.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(v) {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
}
function u32(v) {
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}
function concat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Build a ZIP Blob from `[{ name, bytes }]`. `name` may contain forward
 * slashes to create folders. The (large) image bytes are pushed as their own
 * Blob chunk — never copied — so memory stays close to the sum of inputs.
 */
export function buildZip(files) {
  const enc = new TextEncoder();
  const chunks = [];   // Blob parts, in file order
  const central = [];  // central-directory records, built as we go
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.bytes;
    const crc = crc32(data);
    const size = data.length;

    const localHeader = concat([
      u32(0x04034b50), // local file header signature
      u16(20),         // version needed to extract
      u16(0),          // general purpose flags
      u16(0),          // compression method = store
      u16(0),          // last mod time
      u16(0),          // last mod date
      u32(crc),
      u32(size),       // compressed size
      u32(size),       // uncompressed size
      u16(nameBytes.length),
      u16(0),          // extra field length
      nameBytes,
    ]);
    chunks.push(localHeader, data);

    central.push(concat([
      u32(0x02014b50), // central directory header signature
      u16(20),         // version made by
      u16(20),         // version needed to extract
      u16(0),          // flags
      u16(0),          // compression method
      u16(0),          // time
      u16(0),          // date
      u32(crc),
      u32(size),       // compressed size
      u32(size),       // uncompressed size
      u16(nameBytes.length),
      u16(0),          // extra field length
      u16(0),          // comment length
      u16(0),          // disk number start
      u16(0),          // internal attrs
      u32(0),          // external attrs
      u32(offset),     // relative offset of local header
      nameBytes,
    ]));

    offset += localHeader.length + size;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) { chunks.push(c); centralSize += c.length; }

  chunks.push(concat([
    u32(0x06054b50), // end of central directory signature
    u16(0),          // disk number
    u16(0),          // central dir start disk
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(centralStart),
    u16(0),          // comment length
  ]));

  return new Blob(chunks, { type: 'application/zip' });
}
