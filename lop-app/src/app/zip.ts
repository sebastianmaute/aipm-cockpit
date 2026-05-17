// Minimal hand-rolled ZIP writer.
//
// Just enough to produce OOXML packages (.docx, .xlsx, .pptx). We use the
// STORE method (no compression) — OOXML packages are valid uncompressed,
// just larger on disk. Implementing DEFLATE from scratch would add several
// hundred lines for marginal benefit on this project.
//
// References:
//   • PKWare APPNOTE.TXT 6.3.10 (ZIP file format spec)
//   • ECMA-376 Part 2 (OOXML Open Packaging Conventions)
//
// What we emit per file:
//   • Local file header (signature 0x04034b50)
//   • Raw file bytes (uncompressed = "stored")
//   • Central directory entry (signature 0x02014b50) at the end
//   • End-of-central-directory record (signature 0x06054b50)
//
// We never set the data descriptor flag, so all sizes / CRCs go directly
// into the local file header. Filenames are UTF-8 encoded with the language
// encoding flag (bit 11) set.

export type ZipEntry = {
  /** Forward-slash-separated path inside the archive. */
  path: string;
  /** File contents — string is encoded as UTF-8 before storage. */
  data: string | Uint8Array;
};

// --- CRC-32 ---------------------------------------------------------------

// Precomputed table for the standard CRC-32 polynomial (reflected).
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// --- byte helpers ---------------------------------------------------------

const encoder = new TextEncoder();

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

/** ZIP stores DOS-format date/time in the local file header. We encode the
 *  current date so the produced archives have plausible timestamps; Office
 *  doesn't actually care, but proper timestamps avoid Windows Explorer
 *  complaining about "0001-01-01" entries. */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear());
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((d.getSeconds() / 2) & 0x1f);
  const date =
    (((year - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f);
  return { date, time };
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  writeBytes(b: Uint8Array) {
    this.chunks.push(b);
    this.length += b.length;
  }

  writeU16(n: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n & 0xffff, true);
    this.writeBytes(b);
  }

  writeU32(n: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n >>> 0, true);
    this.writeBytes(b);
  }

  get offset(): number {
    return this.length;
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

// --- public API -----------------------------------------------------------

/**
 * Pack the given entries into an in-memory ZIP archive and return a Blob.
 *
 * The blob has the generic application/zip MIME type by default; callers
 * pass a more specific OOXML MIME (e.g. the
 * `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
 * for .docx) so the download dialog suggests the right "Open with…" app.
 */
export function buildZip(
  entries: ZipEntry[],
  mime = "application/zip",
): Blob {
  const out = new ByteWriter();
  const now = new Date();
  const { date: dosDate, time: dosTime } = dosDateTime(now);

  // Local file headers + data. Remember each entry's offset + CRC for the
  // central directory we write at the end.
  const meta: Array<{
    path: string;
    pathBytes: Uint8Array;
    crc: number;
    size: number;
    localHeaderOffset: number;
  }> = [];

  for (const entry of entries) {
    const data = toBytes(entry.data);
    const pathBytes = encoder.encode(entry.path);
    const c = crc32(data);
    const offset = out.offset;

    // Local file header.
    out.writeU32(0x04034b50);
    out.writeU16(20); // version needed: 2.0 (STORE)
    out.writeU16(0x0800); // general purpose flag — bit 11 = UTF-8 names
    out.writeU16(0); // compression method: 0 (STORE)
    out.writeU16(dosTime);
    out.writeU16(dosDate);
    out.writeU32(c);
    out.writeU32(data.length); // compressed size
    out.writeU32(data.length); // uncompressed size
    out.writeU16(pathBytes.length);
    out.writeU16(0); // no extra field
    out.writeBytes(pathBytes);
    out.writeBytes(data);

    meta.push({
      path: entry.path,
      pathBytes,
      crc: c,
      size: data.length,
      localHeaderOffset: offset,
    });
  }

  // Central directory.
  const cdStart = out.offset;
  for (const m of meta) {
    out.writeU32(0x02014b50);
    out.writeU16(20); // version made by
    out.writeU16(20); // version needed
    out.writeU16(0x0800); // utf-8 names
    out.writeU16(0); // STORE
    out.writeU16(dosTime);
    out.writeU16(dosDate);
    out.writeU32(m.crc);
    out.writeU32(m.size); // compressed
    out.writeU32(m.size); // uncompressed
    out.writeU16(m.pathBytes.length);
    out.writeU16(0); // extra field length
    out.writeU16(0); // file comment length
    out.writeU16(0); // disk number start
    out.writeU16(0); // internal file attributes
    out.writeU32(0); // external file attributes
    out.writeU32(m.localHeaderOffset);
    out.writeBytes(m.pathBytes);
  }
  const cdEnd = out.offset;
  const cdSize = cdEnd - cdStart;

  // End of central directory record.
  out.writeU32(0x06054b50);
  out.writeU16(0); // disk number
  out.writeU16(0); // disk where central dir starts
  out.writeU16(meta.length); // entries on this disk
  out.writeU16(meta.length); // entries total
  out.writeU32(cdSize);
  out.writeU32(cdStart);
  out.writeU16(0); // comment length

  // TS's `BlobPart` type is strict about `ArrayBuffer` vs the broader
  // `ArrayBufferLike` (which would include `SharedArrayBuffer`).
  // `Uint8Array` constructed via `new Uint8Array(length)` is always backed
  // by a plain `ArrayBuffer`, so the cast is safe at runtime.
  return new Blob([out.toBytes() as BlobPart], { type: mime });
}
