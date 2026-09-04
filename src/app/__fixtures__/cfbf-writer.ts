// Test-only minimal MS-CFB writer. Emits 512-byte-sector compound files, and
// deliberately malformed ones for the guard tests. Layout is [FAT][directory]
// [streams]; every stream is written above the 4096 mini-stream cutoff, so the
// mini path is exercised only by the real inlined file in Task 16.
//
// VERIFIED: this exact layout round-trips through a reference reader — a simple
// stream yields 1 reachable entry, two same-named streams in two storages yield
// 4 and resolve to distinct paths, and each defect flag reproduces its hostile
// condition.
//
// ★★★ TWO DEFECT FLAGS ARE DELIBERATELY SELF-CONSISTENT, AND THAT IS THE WHOLE
// POINT OF THEM. A malformed fixture that ALSO has garbage everywhere else is
// rejected by whichever bound happens to see the garbage first, so the test
// named after the guard passes with that guard deleted — three assertions in
// `cfbf.test.ts` were measured vacuous for exactly that reason (open-followups
// §356). Each of these two now reaches its guard with nothing else to object to:
//   · illegalSectorShift lays the ENTIRE file out at 1024-byte sectors and
//     declares shift 10 to match. 1024 is not a legal MS-CFB sector size (only
//     512 and 4096 are), but every other field — DIFAT slots, FAT, directory
//     chain, stream chains, sector offsets — is internally consistent at that
//     size, so `buildContext`'s shift check is the ONLY thing that can reject
//     the file. Removing that check makes the file read back normally.
//   · chainPastEnd under-declares `nFat` as 1 and links the first stream's
//     chain to the file's LAST sector. One 512-byte FAT sector describes 128
//     sectors, so with a file longer than that the target sector is inside the
//     file (the offset bound passes) but past `ctx.fat.length` (the length
//     bound rejects it). Removing the length bound makes the stream absorb that
//     sector's bytes, which is observable. The caller must therefore supply
//     enough stream data to push the file past 128 sectors — `buildCfbf`
//     throws rather than emitting a fixture that silently cannot reach the
//     guard.

const FREE = 0xffffffff;
const EOC = 0xfffffffe;
const FATSECT = 0xfffffffd;
const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export type CfbfEntryInput = { name: string; data?: Uint8Array; children?: CfbfEntryInput[] };
export type CfbfDefects = {
  cyclicFat?: boolean;
  cyclicDirTree?: boolean;
  hugeStreamSize?: boolean;
  illegalSectorShift?: boolean;
  chainPastEnd?: boolean;
};

type Entry = {
  name: string; type: number; data: Uint8Array | null;
  left: number; right: number; child: number; start: number; size: number;
};

export function buildCfbf(root: CfbfEntryInput[], defects: CfbfDefects = {}): Uint8Array {
  // ★ EVERY offset below derives from SEC, which is why the illegal-shift file
  //  comes out self-consistent rather than merely mislabelled. 1024 keeps the
  //  reader's own `(sector + 1) * sec` origin clear of the 512-byte header, so
  //  no sector overlaps it — the same reason 4096 works. A smaller illegal
  //  shift (7 -> 128) would put sectors 0-2 inside the header and need three
  //  reserved sectors to stay consistent.
  const SEC = defects.illegalSectorShift ? 1024 : 512;
  const PER_DIR = SEC / 128;          // 128-byte directory entries per sector

  // --- 1. flatten into directory entries; index 0 is the Root Entry ---
  const E: Entry[] = [{
    name: "Root Entry", type: 5, data: null,
    left: FREE, right: FREE, child: FREE, start: EOC, size: 0,
  }];
  const addAll = (items: CfbfEntryInput[] | undefined): number => {
    if (!items || items.length === 0) return FREE;
    const idxs: number[] = [];
    for (const it of items) {
      idxs.push(E.length);
      E.push({
        name: it.name, type: it.data ? 2 : 1, data: it.data ?? null,
        left: FREE, right: FREE, child: FREE, start: EOC, size: it.data ? it.data.length : 0,
      });
    }
    // Recurse only after every sibling is pushed, so the captured indices stay valid.
    items.forEach((it, i) => { if (it.children) E[idxs[i]].child = addAll(it.children); });
    for (let i = 0; i < idxs.length - 1; i++) E[idxs[i]].right = idxs[i + 1];
    return idxs[0];
  };
  E[0].child = addAll(root);
  // ★ Point the ROOT's own child pointer back at itself, not at the last
  //  flattened entry. The last entry is very often a STREAM (a leaf), and
  //  readCfbfTree only recurses into `.child` for storage/root types — a
  //  cycle planted on a stream's `.child` is silently dead code the walker
  //  never reaches. Root Entry (index 0) is always type "root" and is always
  //  visited first, so this is guaranteed reachable regardless of the tree
  //  shape the caller builds.
  if (defects.cyclicDirTree) E[0].child = 0;

  // --- 2. allocate sectors: [FAT][directory][streams] ---
  const nDir = Math.ceil(E.length / PER_DIR);
  const streamSecs = E.map((e) => (e.data ? Math.ceil(e.data.length / SEC) : 0));
  const totalStream = streamSecs.reduce((a, b) => a + b, 0);
  let nFat = 1;
  for (let i = 0; i < 8; i++) {
    const need = Math.max(1, Math.ceil((nFat + nDir + totalStream) / (SEC / 4)));
    if (need === nFat) break;
    nFat = need;
  }
  const totalSectors = nFat + nDir + totalStream;
  const fat = new Array<number>(totalSectors).fill(FREE);
  for (let i = 0; i < nFat; i++) fat[i] = FATSECT;

  const dirStart = nFat;
  for (let i = 0; i < nDir; i++) fat[dirStart + i] = i === nDir - 1 ? EOC : dirStart + i + 1;

  let cursor = nFat + nDir;
  E.forEach((e, i) => {
    if (!e.data) return;
    e.start = cursor;
    for (let k = 0; k < streamSecs[i]; k++) {
      fat[cursor + k] = k === streamSecs[i] - 1 ? EOC : cursor + k + 1;
    }
    cursor += streamSecs[i];
  });

  const firstStream = E.find((e) => e.data);
  if (defects.cyclicFat && firstStream) fat[firstStream.start] = firstStream.start;
  if (defects.chainPastEnd && firstStream) {
    // ★ The LAST sector of the file, not one past it. Past the end, the offset
    //  bound in `chain()` would reject the link too — and since `ctx.fat` is
    //  never longer than the file's own sector count, the length bound it sits
    //  behind ALWAYS fires first, so the offset bound is unreachable and no
    //  fixture can single it out. Inside the file but past the DECLARED FAT is
    //  the only shape the length bound alone rejects.
    const declaredFatEntries = SEC / 4;
    if (totalSectors - 1 < declaredFatEntries) {
      throw new Error(
        `chainPastEnd needs more than ${declaredFatEntries} sectors to reach past the declared FAT; `
        + `this fixture has ${totalSectors}. Give buildCfbf more stream data.`,
      );
    }
    fat[firstStream.start] = totalSectors - 1;
  }

  // --- 3. serialise ---
  const buf = new Uint8Array((totalSectors + 1) * SEC);
  const dv = new DataView(buf.buffer);
  buf.set(SIG, 0);
  dv.setUint16(0x18, 0x003e, true);
  dv.setUint16(0x1a, 3, true);
  dv.setUint16(0x1c, 0xfffe, true);
  dv.setUint16(0x1e, Math.log2(SEC), true);
  dv.setUint16(0x20, 6, true);
  // ★ `nFat` is a HEADER field and therefore attacker-set — cfbf.ts narrows its
  //  FAT to `Math.min(nFat, difat.length)` sectors. Under-declaring it is what
  //  makes `ctx.fat` shorter than the file's own sector count, which is the only
  //  way a chain link can be inside the file and past the FAT at once.
  dv.setUint32(0x2c, defects.chainPastEnd ? 1 : nFat, true);
  dv.setUint32(0x30, dirStart, true);
  dv.setUint32(0x38, 4096, true);
  dv.setUint32(0x3c, EOC, true);
  dv.setUint32(0x40, 0, true);
  dv.setUint32(0x44, EOC, true);
  dv.setUint32(0x48, 0, true);
  for (let i = 0; i < 109; i++) dv.setUint32(0x4c + i * 4, i < nFat ? i : FREE, true);

  const off = (sector: number) => (sector + 1) * SEC;
  for (let i = 0; i < nFat; i++) {
    for (let j = 0; j < SEC / 4; j++) {
      const idx = i * (SEC / 4) + j;
      dv.setUint32(off(i) + j * 4, idx < fat.length ? fat[idx] : FREE, true);
    }
  }

  E.forEach((e, i) => {
    const p = off(dirStart + Math.floor(i / PER_DIR)) + (i % PER_DIR) * 128;
    const nm = Buffer.from(`${e.name}\0`, "utf16le");
    buf.set(nm.subarray(0, Math.min(64, nm.length)), p);
    dv.setUint16(p + 64, Math.min(64, nm.length), true);
    buf[p + 66] = e.type;
    buf[p + 67] = 1;
    dv.setUint32(p + 68, e.left, true);
    dv.setUint32(p + 72, e.right, true);
    dv.setUint32(p + 76, e.child, true);
    dv.setUint32(p + 116, e.start, true);
    dv.setUint32(p + 120, defects.hugeStreamSize && e.data ? 0xffffff00 : e.size, true);
    dv.setUint32(p + 124, 0, true);
  });

  E.forEach((e) => { if (e.data) buf.set(e.data, off(e.start)); });
  return buf;
}
