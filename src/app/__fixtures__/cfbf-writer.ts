// Test-only minimal MS-CFB writer. Emits 512-byte-sector compound files, and
// deliberately malformed ones for the guard tests. Layout is [FAT][directory]
// [streams]; every stream is written above the 4096 mini-stream cutoff, so the
// mini path is exercised only by the real inlined file in Task 16.
//
// VERIFIED: this exact layout round-trips through a reference reader — a simple
// stream yields 1 reachable entry, two same-named streams in two storages yield
// 4 and resolve to distinct paths, and each defect flag reproduces its hostile
// condition. illegalSectorShift crashes an UNGUARDED reader with
// ERR_BUFFER_OUT_OF_BOUNDS, which is why cfbf.ts rejects the shift outright.

const SEC = 512;
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
  if (defects.cyclicDirTree && E.length > 1) E[E.length - 1].child = 1;

  // --- 2. allocate sectors: [FAT][directory][streams] ---
  const nDir = Math.ceil(E.length / 4);
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
  if (defects.chainPastEnd && firstStream) fat[firstStream.start] = totalSectors + 500;

  // --- 3. serialise ---
  const buf = new Uint8Array((totalSectors + 1) * SEC);
  const dv = new DataView(buf.buffer);
  buf.set(SIG, 0);
  dv.setUint16(0x18, 0x003e, true);
  dv.setUint16(0x1a, 3, true);
  dv.setUint16(0x1c, 0xfffe, true);
  dv.setUint16(0x1e, defects.illegalSectorShift ? 7 : 9, true);
  dv.setUint16(0x20, 6, true);
  dv.setUint32(0x2c, nFat, true);
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
    const p = off(dirStart + Math.floor(i / 4)) + (i % 4) * 128;
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
