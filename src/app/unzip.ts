// src/app/unzip.ts — minimal, dependency-free ZIP reader (central-directory based).
// Supports STORED (method 0) and DEFLATE (method 8, via native DecompressionStream).
// Pure + node-testable: DecompressionStream is a Node 18+ / browser global. Only
// what OOXML needs — no ZIP64, no encryption, no data-descriptor size guessing
// (the central directory carries reliable sizes even when local headers do not).

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;

/** Safety ceiling on a single entry's decompressed size (zip-bomb guard). The
 *  20 MB upstream attachment cap bounds INPUT, not DEFLATE output. */
const MAX_INFLATED_BYTES = 100 * 1024 * 1024;

/** Aggregate ceiling across ALL entries of one archive (zip-bomb guard — a
 *  per-entry cap alone doesn't bound total memory from many entries). */
const MAX_TOTAL_INFLATED_BYTES = 256 * 1024 * 1024;

async function inflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(input as BufferSource).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > MAX_INFLATED_BYTES) {
      await reader.cancel();
      throw new Error("decompressed size exceeds limit");
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function findEocd(view: DataView): number {
  const len = view.byteLength;
  if (len < 22) return -1;
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

/** Read every entry of a ZIP archive into a `path → bytes` map. */
export async function readZipEntries(
  input: ArrayBuffer | Uint8Array,
  maxTotalBytes: number = MAX_TOTAL_INFLATED_BYTES,
): Promise<Map<string, Uint8Array>> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");

  const cdCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");
  const entries = new Map<string, Uint8Array>();

  let p = cdOffset;
  let grandTotal = 0;
  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(p, true) !== CDH_SIG) throw new Error("corrupt central directory");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));

    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);

    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error(`unsupported zip compression method ${method}`);

    grandTotal += data.length;
    if (grandTotal > maxTotalBytes) {
      throw new Error("archive decompressed size exceeds limit");
    }

    entries.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
