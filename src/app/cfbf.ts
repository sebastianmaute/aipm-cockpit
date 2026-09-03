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
//
// ★★★ BOTH HALVES OF THAT SENTENCE WERE FALSE UNTIL 2026-09-03, and each half
// was a remotely reachable DoS on attacker-supplied mail (checkAttachmentSize
// admits 64 MB). Measured under node 24, not reasoned:
//   · DIFAT -> FAT amplification. Repeated FAT-sector pointers were not
//     deduplicated and nothing bounded `ctx.fat` by the file, so ~32 array
//     slots grew per input byte at a 512-byte sector (256 at 4096 bytes):
//     1 MB in -> 543 MB heap / 299 ms, 4 MB -> 1038 MB / 1707 ms, 6 MB ->
//     `RangeError: Invalid array length` out of Array.push.
//   · Directory recursion. readCfbfTree's walk recursed on `left` and `right`
//     BEFORE doing any work, so its depth equalled the SIBLING COUNT — and
//     siblings are routinely a linked list rather than a balanced red-black
//     tree (this repo's own fixture writer emits exactly that shape). 8,600
//     sibling storages walked; 8,700 threw `RangeError: Maximum call stack
//     size exceeded`, from a 1.1 MB file. Browser stacks are smaller than
//     node's, so the reachable threshold is lower than that.
//   · Per-entry retention. readEntryBytes sized its allocation from the
//     declared size alone, and `out.subarray` keeps its WHOLE backing store
//     alive, so N entries each claiming 4 GB retained N file-sized buffers:
//     1,000 entries in a 631 KB file retained 616 MB (~1000x).
// ★★★ EVERY BOUND ADDED FOR THOSE IS DERIVED FROM THE INPUT'S OWN LENGTH,
// never from a header field: `nFat`, `nDifat`, `cutoff` and every directory
// size are attacker-set, which is why the pre-existing `difat.slice(0, nFat)`
// bounded nothing. Do not reintroduce a bound that trusts one.
//
// ★★★ ONE AMPLIFICATION IS STILL OPEN, AND THE SENTENCE AT THE TOP IS EXACT
// ABOUT WHY THAT IS STILL COMPATIBLE WITH IT: no path here THROWS any more,
// but the returned Map's KEYS are not bounded by anything. A path string is
// rebuilt per emitted stream from all of its ancestors' names, so a directory
// nested N deep with a stream at every level costs O(N²) characters while
// costing only O(N) bytes of input. Measured 2026-09-03 on the FIXED reader:
// depth 500 -> 1.1 MB of keys from a 380 KB file, 1,000 -> 4.6 MB from 758 KB,
// 2,000 -> 19.7 MB from 1.5 MB (quadratic, ~4.2x per doubling). Extrapolated
// to the 64 MB mail ceiling that is tens of GB, i.e. an OOM abort rather than
// a catchable throw. `budget` below bounds stream BYTES and does nothing for
// this. Fixing it needs a bound on nesting depth or on total key length, and
// picking one is a judgement about how deep a legitimate embedded-message
// chain goes — deliberately NOT decided here. Do not read the contract above
// as covering it.

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const MAXREGSECT = 0xfffffffa;
const FREESECT = 0xffffffff;
/** Hard ceiling on any one stream, whatever the directory entry claims.
 *  ★ NO UNIT TEST CAN KILL A MUTANT ON THIS CLAMP. It bounds the UPFRONT
 *  `new Uint8Array(size)` allocation from an attacker-controlled size field —
 *  not the RETURNED length, which readEntryBytes truncates to what the FAT
 *  chain actually delivers regardless of this clamp (a corrupted size with
 *  only a few real sectors behind it still returns a few sectors' worth of
 *  bytes either way). Measured, and re-verified 2026-09-03: dropping this
 *  clamp entirely does not fail any test here.
 *  ★★★ ITS STATED REASON CHANGED ON 2026-09-03 AND THE OLD ONE IS NOW FALSE.
 *  It used to say the risk this guards is "cumulative memory pressure across
 *  many entries/calls" — that risk was REAL (1,000 entries in a 631 KB file
 *  retained 616 MB) and this constant never bounded it, since it caps ONE
 *  entry. readCfbfTree's `budget` bounds the total now, and readEntryBytes
 *  clamps each entry to what its own chain can deliver, so both of those sit
 *  BELOW this ceiling for any input the app can hand it — `checkAttachmentSize`
 *  admits 64 MB of mail and `budget` starts at the input's length. What is left
 *  is a backstop for a caller that passes a larger buffer than mail ever is.
 *  Keep it, but do not cite it as the thing that bounds anything today. */
export const MAX_CFBF_STREAM_BYTES = 64 * 1024 * 1024;
/** Hard ceiling on the number of directory entries walked. A cyclic or
 *  adversarially large directory chain must not let the walk grow unbounded
 *  even with a visited-set (each visited sector still yields up to 4 entries).
 *  ★ NO UNIT TEST CAN KILL A MUTANT ON THIS CAP either — proving it needs a
 *  fixture with on the order of 200,000 directory entries (tens of MB just
 *  for the directory stream), which isn't worth carrying as a synthetic
 *  fixture. Keep it anyway: `chain()`'s visited-set only bounds a SECTOR from
 *  being read twice, not the total entries a long-but-acyclic, otherwise
 *  file-length-legal chain can enumerate. */
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
  // ★★★ NO SYNTHETIC FIXTURE CAN KILL A MUTANT ON THIS BLOCK. Deleting it
  //  outright leaves every test in cfbf.test.ts green — measured, not
  //  assumed. The failure it guards against only appears past ~7.1 MB of FAT
  //  (109 header pointers × a 512-byte sector), where a header-only reader
  //  returns an EMPTY DIRECTORY SILENTLY rather than an error (measured on a
  //  real 17.8 MB Outlook .msg, which needed two chained DIFAT sectors). A
  //  synthetic fixture that size is not worth carrying in this repo.
  //  ★★★ TASK 16's REAL INLINED .msg FIXTURE DOES NOT PROVE THIS BLOCK
  //  EITHER — it is 82KB, nowhere near the ~7.1 MB threshold. Measured, not
  //  assumed: reverting this DIFAT-chain block to the header-only 109
  //  entries still leaves msg-integration.test.ts fully green. That gap is
  //  accepted and recorded in msg-integration.test.ts rather than closed —
  //  see the comment there. Only a second, ~8 MB+ fixture forcing a chained
  //  DIFAT sector would prove this block; nothing in this repo does yet.
  // ★★★ THE ONLY HONEST BOUND HERE IS THE FILE'S OWN SECTOR COUNT. A FAT
  //  describes sectors; a sector that does not fit in the file cannot be read
  //  (`chain` rejects it on the offset check anyway), so a FAT longer than the
  //  file has sectors is pure waste, and one FAT sector's worth of pointers
  //  repeated N times is pure amplification. `nFat` bounded neither: it is a
  //  header field, and `difat.slice(0, nFat)` is capped by `difat.length` the
  //  moment nFat is large. Dedup the pointers (a repeat describes no sector the
  //  first mention did not) and cap both lists by `fileSectors`.
  //  ★★ The amplification is only observable as RESOURCE USE — every FAT slot
  //  past `fileSectors` is unreachable through `chain`'s offset check, so
  //  neither the dedup nor the cap has any effect on the BYTES this module
  //  returns, at any input. The regression test in cfbf.test.ts can therefore
  //  only assert that the reader does not blow up; it discriminates the PAIR,
  //  not either half (each alone suppresses the growth).
  const fileSectors = Math.max(0, Math.floor(bytes.length / sec) - 1);
  const maxFatSectors = Math.ceil(fileSectors / (sec / 4));
  const difat: number[] = [];
  const seenFatSector = new Set<number>();
  const addFatSector = (v: number): void => {
    if (v > MAXREGSECT || difat.length >= maxFatSectors || seenFatSector.has(v)) return;
    seenFatSector.add(v);
    difat.push(v);
  };
  for (let i = 0; i < 109; i++) addFatSector(u32(0x4c + i * 4));
  {
    const per = sec / 4 - 1;
    const seen = new Set<number>();
    let ds = difatStart;
    let guard = 0;
    while (ds <= MAXREGSECT && guard++ <= nDifat + 8 && difat.length < maxFatSectors) {
      if (seen.has(ds)) break;                                  // cyclic DIFAT
      if ((ds + 1) * sec + sec > bytes.length) break;
      seen.add(ds);
      const base = (ds + 1) * sec;
      for (let i = 0; i < per; i++) addFatSector(u32(base + i * 4));
      ds = u32(base + per * 4);
    }
  }
  // ★ nFat still truncates, exactly as `difat.slice(0, nFat)` did — a real
  //  writer sets it correctly and a too-small value has always meant a short
  //  FAT here. It is kept as a narrowing bound only; `fileSectors` is what
  //  makes the loop safe.
  const fatSectors = Math.min(nFat, difat.length);
  for (let k = 0; k < fatSectors && ctx.fat.length < fileSectors; k++) {
    const base = (difat[k] + 1) * sec;
    if (base + sec > bytes.length) continue;
    for (let i = 0; i < sec / 4 && ctx.fat.length < fileSectors; i++) ctx.fat.push(u32(base + i * 4));
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

function readEntryBytes(ctx: Ctx, e: RawEntry, budget: number): Uint8Array {
  // ★★★ CLAMP TO WHAT THE FILE CAN ACTUALLY DELIVER, not merely to the file's
  //  total LENGTH — that was the bug. `e.size` is attacker-controlled and a
  //  real entry can claim 4 GB, so the old `Math.min(e.size, ctx.b.length, …)`
  //  allocated one FILE-SIZED buffer per entry; because the return is
  //  `out.subarray(…)`, which keeps its whole backing store alive, a directory
  //  of such entries retained that buffer N times over. Measured on the
  //  unfixed reader: 1,000 entries in a 631 KB file retained 616 MB.
  //  The chain (or the mini stream) is walked FIRST so the allocation is the
  //  smaller of what was declared and what those sectors can hold; `budget` is
  //  readCfbfTree's cumulative cap, so N entries sharing ONE long chain cannot
  //  each legitimately deliver a file's worth of bytes either.
  const useMini = e.size < ctx.cutoff;
  const sectors = useMini ? ctx.miniSectors : chain(ctx, e.start);
  const size = Math.min(e.size, sectors.length * ctx.sec, budget, ctx.b.length, MAX_CFBF_STREAM_BYTES);
  if (size <= 0) return new Uint8Array(0);
  const out = new Uint8Array(size);
  let written = 0;

  if (useMini) {
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

  for (const s of sectors) {
    const n = Math.min(ctx.sec, size - written);
    if (n <= 0) break;
    const from = offsetOf(ctx, s);
    if (from + n > ctx.b.length) break;
    out.set(ctx.b.subarray(from, from + n), written);
    written += n;
  }
  return out.subarray(0, written);
}

/** One unit of the directory walk. `emit` false = the old `walk(idx, path)`
 *  entry; `emit` true = the work that used to follow the two recursive calls. */
type WalkFrame = { idx: number; path: string; emit: boolean };

/** Walk the red-black directory tree, producing PATH -> bytes. */
export function readCfbfTree(bytes: Uint8Array): Map<string, Uint8Array> {
  const ctx = buildContext(bytes);
  const out = new Map<string, Uint8Array>();
  if (!ctx) return out;
  // ★ A compound file cannot legitimately hold more stream bytes than it is
  //  itself long — streams occupy disjoint sectors, and a mini stream is a
  //  slice of the root's own sectors. Without this, N directory entries all
  //  pointing at ONE long chain each deliver a file's worth of bytes and the
  //  returned Map retains N x the input.
  let budget = bytes.length;
  const visited = new Set<number>();
  // ★★★ ITERATIVE, NOT RECURSIVE, AND THAT IS A SECURITY PROPERTY. The old
  //  `walk` recursed on `left` then `right` before doing any work, so its
  //  depth was the SIBLING COUNT — and a sibling list chained through `right`
  //  is exactly what this repo's fixture writer emits and what a hostile .msg
  //  would. Measured: 8,600 siblings walked, 8,700 threw `RangeError: Maximum
  //  call stack size exceeded` from a 1.1 MB file; browsers give less stack
  //  than node, so treat that number as an upper bound on the safe depth.
  //  ★★ THE VISIT ORDER IS PRESERVED EXACTLY and callers depend on it (paths
  //  like "S1/Dup", duplicate names across storages). A node is emitted only
  //  after BOTH its subtrees, and its children are walked immediately after it
  //  is emitted — so frames are pushed in REVERSE of the old call order,
  //  because the stack is LIFO. Swapping the two `visit` pushes reverses the
  //  sibling order; hoisting the `emit` push after them turns the post-order
  //  into a pre-order.
  const stack: WalkFrame[] = [{ idx: ctx.entries[0].child, path: "", emit: false }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    if (!frame.emit) {
      if (frame.idx > MAXREGSECT || frame.idx >= ctx.entries.length) continue;
      if (visited.has(frame.idx)) continue;       // cyclic directory tree
      visited.add(frame.idx);
      const e = ctx.entries[frame.idx];
      stack.push({ idx: frame.idx, path: frame.path, emit: true });
      stack.push({ idx: e.right, path: frame.path, emit: false });
      stack.push({ idx: e.left, path: frame.path, emit: false });
      continue;
    }
    const e = ctx.entries[frame.idx];
    const full = frame.path ? `${frame.path}/${e.name}` : e.name;
    if (e.type === 2) {
      const data = readEntryBytes(ctx, e, budget);
      budget -= data.length;
      out.set(full, data);
    }
    if (e.type === 1 || e.type === 5) stack.push({ idx: e.child, path: full, emit: false });
  }
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
