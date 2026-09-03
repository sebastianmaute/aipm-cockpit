// src/app/cfbf.ts — MS-CFB (Compound File Binary) reader.
//
// ★★★ DIFAT CHAIN WALKING IS MANDATORY, NOT AN OPTIMISATION. The header holds
// only the first 109 FAT-sector pointers, covering ~7.1 MB at a 512-byte sector.
// Beyond that the DIFAT continues in chained sectors. A reader that stops at the
// header returns an EMPTY DIRECTORY rather than an error — measured on a real
// 17.8 MB Outlook mail, which needed two chained DIFAT sectors.
//
// ★★★ CALLERS MUST ADDRESS BY PATH, NOT BY NAME. Duplicate stream names across
// storages are normal in .msg. Flattening the tree misattributes a sub-storage
// property to the message — measured, and it produced a body that did not exist.
//
// Hostile input: this is a filesystem format. Every chain walk carries a
// visited-set, every declared size is clamped before allocation, and the reader
// returns partial results rather than throwing.

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const MAXREGSECT = 0xfffffffa;
const FREESECT = 0xffffffff;
/** Hard ceiling on any one stream, whatever the directory entry claims. */
export const MAX_CFBF_STREAM_BYTES = 64 * 1024 * 1024;
/** Hard ceiling on the number of directory entries walked. A cyclic or
 *  adversarially large directory chain must not let the walk grow unbounded
 *  even with a visited-set (each visited sector still yields up to 4 entries). */
const MAX_DIRECTORY_ENTRIES = 200_000;

export type CfbfEntry = {
  path: string;
  name: string;
  type: "storage" | "stream" | "root";
  size: number;
};

type Ctx = {
  b: Uint8Array;
  dv: DataView;
  sec: number;
  mini: number;
  cutoff: number;
  fat: number[];
  miniFat: number[];
  miniSectors: number[];
  entries: RawEntry[];
};

type RawEntry = {
  name: string; type: number; left: number; right: number; child: number;
  start: number; size: number;
};

function offsetOf(ctx: Ctx, sector: number): number { return (sector + 1) * ctx.sec; }

/** Walk a sector chain with a visited-set and a bound. Returns what it could
 *  reach; a cycle or an out-of-range link ends the walk instead of hanging. */
function chain(ctx: Ctx, start: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  let s = start;
  while (s <= MAXREGSECT) {
    if (seen.has(s)) break;                       // cyclic FAT
    if (s >= ctx.fat.length) break;               // chain past the end
    if (offsetOf(ctx, s) + ctx.sec > ctx.b.length) break;
    seen.add(s);
    out.push(s);
    s = ctx.fat[s];
  }
  return out;
}

function buildContext(bytes: Uint8Array): Ctx | null {
  if (bytes.length < 512) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o: number) => dv.getUint16(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);

  const shift = u16(0x1e);
  const miniShift = u16(0x20);
  // ★ Only 9 and 12 are legal. Reject rather than shifting by an
  //  attacker-supplied amount, which would produce an absurd sector size.
  if (shift !== 9 && shift !== 12) return null;
  if (miniShift !== 6) return null;

  const sec = 1 << shift;
  const mini = 1 << miniShift;
  const nFat = u32(0x2c);
  const dirStart = u32(0x30);
  const cutoff = u32(0x38);
  const miniFatStart = u32(0x3c);
  const nMiniFat = u32(0x40);
  const difatStart = u32(0x44);
  const nDifat = u32(0x48);

  const ctx: Ctx = { b: bytes, dv, sec, mini, cutoff, fat: [], miniFat: [], miniSectors: [], entries: [] };

  // --- DIFAT: 109 in the header, then the chain ---
  const difat: number[] = [];
  for (let i = 0; i < 109; i++) { const v = u32(0x4c + i * 4); if (v <= MAXREGSECT) difat.push(v); }
  {
    const per = sec / 4 - 1;
    const seen = new Set<number>();
    let ds = difatStart;
    let guard = 0;
    while (ds <= MAXREGSECT && guard++ <= nDifat + 8) {
      if (seen.has(ds)) break;                                  // cyclic DIFAT
      if ((ds + 1) * sec + sec > bytes.length) break;
      seen.add(ds);
      const base = (ds + 1) * sec;
      for (let i = 0; i < per; i++) { const v = u32(base + i * 4); if (v <= MAXREGSECT) difat.push(v); }
      ds = u32(base + per * 4);
    }
  }
  for (const fs of difat.slice(0, nFat)) {
    if ((fs + 1) * sec + sec > bytes.length) continue;
    for (let i = 0; i < sec / 4; i++) ctx.fat.push(u32((fs + 1) * sec + i * 4));
  }
  if (ctx.fat.length === 0) return null;

  for (const s of chain(ctx, miniFatStart).slice(0, Math.max(nMiniFat, 0) || undefined)) {
    for (let i = 0; i < sec / 4; i++) ctx.miniFat.push(u32(offsetOf(ctx, s) + i * 4));
  }

  // --- directory entries ---
  for (const s of chain(ctx, dirStart)) {
    for (let i = 0; i < sec / 128; i++) {
      const p = offsetOf(ctx, s) + i * 128;
      if (p + 128 > bytes.length) break;
      // ★ Cap total directory entries collected, independent of the chain's
      //  own visited-set — a long-but-acyclic chain (or a huge file) can
      //  still enumerate more entries than any real .msg has.
      if (ctx.entries.length >= MAX_DIRECTORY_ENTRIES) break;
      const nameLen = u16(p + 64);
      const type = bytes[p + 66];
      const name = nameLen > 2 && nameLen <= 64
        ? new TextDecoder("utf-16le").decode(bytes.subarray(p, p + nameLen - 2))
        : "";
      ctx.entries.push({
        name, type,
        left: u32(p + 68), right: u32(p + 72), child: u32(p + 76),
        start: u32(p + 116), size: u32(p + 120),
      });
    }
  }
  if (ctx.entries.length === 0) return null;
  ctx.miniSectors = chain(ctx, ctx.entries[0].start);
  return ctx;
}

function readEntryBytes(ctx: Ctx, e: RawEntry): Uint8Array {
  // ★ Clamp BEFORE allocating. The size field is attacker-controlled; a real
  //  entry can claim 4 GB. Bound it by the file and by the hard ceiling.
  const size = Math.min(e.size, ctx.b.length, MAX_CFBF_STREAM_BYTES);
  if (size <= 0) return new Uint8Array(0);
  const out = new Uint8Array(size);
  let written = 0;

  if (e.size < ctx.cutoff) {
    const seen = new Set<number>();
    let m = e.start;
    while (m <= MAXREGSECT && written < size) {
      if (seen.has(m)) break;
      seen.add(m);
      const secIdx = Math.floor((m * ctx.mini) / ctx.sec);
      const within = (m * ctx.mini) % ctx.sec;
      const phys = ctx.miniSectors[secIdx];
      if (phys === undefined) break;
      const from = offsetOf(ctx, phys) + within;
      const n = Math.min(ctx.mini, size - written);
      if (from + n > ctx.b.length) break;
      out.set(ctx.b.subarray(from, from + n), written);
      written += n;
      m = ctx.miniFat[m] ?? FREESECT;
    }
    return out.subarray(0, written);
  }

  for (const s of chain(ctx, e.start)) {
    const n = Math.min(ctx.sec, size - written);
    if (n <= 0) break;
    const from = offsetOf(ctx, s);
    if (from + n > ctx.b.length) break;
    out.set(ctx.b.subarray(from, from + n), written);
    written += n;
  }
  return out.subarray(0, written);
}

/** Walk the red-black directory tree, producing PATH -> bytes. */
export function readCfbfTree(bytes: Uint8Array): Map<string, Uint8Array> {
  const ctx = buildContext(bytes);
  const out = new Map<string, Uint8Array>();
  if (!ctx) return out;
  const visited = new Set<number>();
  const walk = (idx: number, path: string): void => {
    if (idx > MAXREGSECT || idx >= ctx.entries.length) return;
    if (visited.has(idx)) return;                 // cyclic directory tree
    visited.add(idx);
    const e = ctx.entries[idx];
    walk(e.left, path);
    walk(e.right, path);
    const full = path ? `${path}/${e.name}` : e.name;
    if (e.type === 2) out.set(full, readEntryBytes(ctx, e));
    if (e.type === 1 || e.type === 5) walk(e.child, full);
  };
  walk(ctx.entries[0].child, "");
  return out;
}

/** Flat view, for callers that genuinely only want top-level streams.
 *  ★ Prefer readCfbfTree — see the header note about duplicate names. */
export function readCfbfStreams(bytes: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [path, data] of readCfbfTree(bytes)) {
    if (!path.includes("/")) out.set(path, data);
  }
  return out;
}
