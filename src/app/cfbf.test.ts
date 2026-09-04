import { describe, it, expect } from "vitest";
import { readCfbfStreams, readCfbfTree } from "./cfbf";
import { buildCfbf, type CfbfEntryInput } from "./__fixtures__/cfbf-writer";

const enc = (s: string) => new TextEncoder().encode(s.padEnd(5000, " "));
const tiny = () => new TextEncoder().encode("x".repeat(8));

/** A hostile header whose DIFAT chain names ONE valid FAT sector over and over.
 *  Every sector in the file is a DIFAT sector; all of its pointer slots name
 *  FAT sector 0 and its last slot chains to the next sector. `nFat` and
 *  `nDifat` are set to MAXREGSECT so no HEADER field bounds the walk — that is
 *  the point: the only sound bound is the file's own length.
 *  ★ A 4096-byte sector is used because it is the worse of the two legal
 *  shifts: 1023 pointer slots x 1024 FAT entries per pointer = 256 `ctx.fat`
 *  slots per input BYTE, against 32 at a 512-byte sector. That is what keeps
 *  this fixture at 768 KB instead of the 6 MB the same proof needs at shift 9. */
function difatAmplifier(totalBytes: number): Uint8Array {
  const SEC = 4096;
  const MAXREGSECT = 0xfffffffa;
  const ENDOFCHAIN = 0xfffffffe;
  const FREESECT = 0xffffffff;
  const buf = new Uint8Array(totalBytes);
  const dv = new DataView(buf.buffer);
  buf.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  dv.setUint16(0x1e, 12, true);          // sector shift — 4096-byte sectors
  dv.setUint16(0x20, 6, true);           // mini shift
  dv.setUint32(0x2c, MAXREGSECT, true);  // nFat: attacker-set, bounds nothing
  dv.setUint32(0x30, ENDOFCHAIN, true);  // dirStart: no directory to read
  dv.setUint32(0x38, 4096, true);        // mini-stream cutoff
  dv.setUint32(0x3c, ENDOFCHAIN, true);  // miniFatStart
  dv.setUint32(0x40, 0, true);           // nMiniFat
  dv.setUint32(0x44, 0, true);           // difatStart = sector 0
  dv.setUint32(0x48, MAXREGSECT, true);  // nDifat: attacker-set too
  for (let i = 0; i < 109; i++) dv.setUint32(0x4c + i * 4, FREESECT, true);
  const per = SEC / 4 - 1;
  const sectors = Math.floor(totalBytes / SEC) - 1;
  for (let s = 0; s < sectors; s++) {
    const base = (s + 1) * SEC;
    for (let i = 0; i < per; i++) dv.setUint32(base + i * 4, 0, true);
    dv.setUint32(base + per * 4, s + 1 < sectors ? s + 1 : ENDOFCHAIN, true);
  }
  return buf;
}

/** One storage per level, each holding a stream plus the next level down —
 *  the shape whose PATH keys grow quadratically: N levels each contribute a
 *  key naming all of their ancestors.
 *  ★ Names are 9 characters so a key at depth D is exactly 10D - 1 characters,
 *  which is what makes the totals below arithmetic rather than approximate.
 *  ★★ The streams are 8 bytes, BELOW the writer's 4096-byte mini-stream cutoff,
 *  and `buildCfbf` writes no mini stream — so every VALUE here reads back empty
 *  (measured). That is fine and deliberate: this fixture exists to exercise the
 *  KEYS, and keeping each stream to one sector is what holds a depth-2,000
 *  fixture to 1.5 MB. Do not add a value assertion to a test using it. */
function deepNest(depth: number): CfbfEntryInput[] {
  let node: CfbfEntryInput | null = null;
  for (let d = depth; d >= 1; d--) {
    const children: CfbfEntryInput[] = [{ name: `strm${String(d).padStart(5, "0")}`, data: tiny() }];
    if (node) children.push(node);
    node = { name: `stor${String(d).padStart(5, "0")}`, children };
  }
  return [node!];
}

/** Repoint EVERY directory entry at the FIRST entry's sector chain and make
 *  each of them claim 4 GB. `buildCfbf` gives every stream sectors of its own,
 *  so nothing it emits can exercise the CUMULATIVE bound — the per-entry
 *  "clamp to what this chain can deliver" already covers that shape. This is
 *  the shape that needs a budget: N entries each LEGITIMATELY delivering the
 *  same sectors, so no per-entry clamp can see the total.
 *  ★ It patches a `buildCfbf` output in place rather than extending the writer,
 *  so the directory layout assumed here (contiguous sectors from the header's
 *  dirStart, four 128-byte entries per 512-byte sector, `start` at +116 and
 *  `size` at +120) is the writer's — check `cfbf-writer.ts` if this stops
 *  finding entries. */
function shareOneChain(bytes: Uint8Array, entryCount: number): Uint8Array {
  const SEC = 512;
  const out = bytes.slice();
  const dv = new DataView(out.buffer);
  const off = (sector: number) => (sector + 1) * SEC;
  const dirStart = dv.getUint32(0x30, true);
  const entryAt = (i: number) => off(dirStart + Math.floor(i / 4)) + (i % 4) * 128;
  const sharedStart = dv.getUint32(entryAt(1) + 116, true);   // index 0 is the Root Entry
  for (let i = 1; i <= entryCount; i++) {
    dv.setUint32(entryAt(i) + 116, sharedStart, true);
    dv.setUint32(entryAt(i) + 120, 0xffffff00, true);
  }
  return out;
}

describe("readCfbfStreams", () => {
  it("round-trips named streams", () => {
    const streams = readCfbfStreams(buildCfbf([{ name: "Alpha", data: enc("one") }]));
    expect(streams.has("Alpha")).toBe(true);
    expect(new TextDecoder().decode(streams.get("Alpha")!).trim()).toBe("one");
  });

  // ★★★ THE MEASURED DEFECT. Duplicate names across storages are normal in a
  //  real .msg — a probe that flattened the tree attributed a
  //  __nameid_version1.0 stream to the message body and reported a body that
  //  did not exist. Paths, never bare names.
  it("distinguishes same-named streams in different storages", () => {
    const tree = readCfbfTree(buildCfbf([
      { name: "S1", children: [{ name: "Dup", data: enc("in-s1") }] },
      { name: "S2", children: [{ name: "Dup", data: enc("in-s2") }] },
    ]));
    expect(tree.get("S1/Dup")).toBeDefined();
    expect(tree.get("S2/Dup")).toBeDefined();
    expect(new TextDecoder().decode(tree.get("S1/Dup")!).trim()).toBe("in-s1");
  });
});

describe("cfbf guards", () => {
  it("aborts a cyclic FAT chain instead of hanging", () => {
    expect(() => readCfbfStreams(buildCfbf([{ name: "A", data: enc("x") }], { cyclicFat: true }))).not.toThrow();
  });

  it("aborts a cyclic directory tree", () => {
    expect(() => readCfbfTree(buildCfbf([{ name: "A", data: enc("x") }], { cyclicDirTree: true }))).not.toThrow();
  });

  // ★★★ `MAX_CFBF_STREAM_BYTES` CANNOT BE PINNED BY ANY FIXTURE, AND THAT IS
  //  ARITHMETIC, not a complaint about fixture size. `readEntryBytes` takes
  //  `Math.min(e.size, sectors.length * ctx.sec, budget, ctx.b.length,
  //  MAX_CFBF_STREAM_BYTES)`. `chain()` pushes a sector only while
  //  `s < ctx.fat.length`, and `buildContext` never lets `ctx.fat` grow past
  //  `floor(bytes.length / sec) - 1` — so `sectors.length * ctx.sec` is always
  //  at most `ctx.b.length - ctx.sec`, strictly BELOW the file length, and
  //  `budget` starts at the file length. The 64 MB term can therefore only be
  //  the smallest of the five on a file LARGER THAN 64 MB. Confirming that
  //  would cost a 64 MB fixture to observe a term that changes nothing for any
  //  input the app can produce. Re-verified by mutation 2026-09-04: dropping
  //  the term leaves this file green. `cfbf.ts`'s own comment on the constant
  //  concedes the same thing; this is the proof rather than the observation.
  //  ★★ WHAT THIS TEST DOES DISCRIMINATE is the chain-derived clamp — the term
  //  that actually stops a 4 GB declared size from being allocated, which is
  //  what the title claims. `.buffer.byteLength` is load-bearing and `.length`
  //  is not: `out.subarray(0, written)` returns the same 5,120-byte VIEW with
  //  the clamp removed, onto a buffer that is then the whole file. MEASURED,
  //  not reasoned — with the clamp deleted a `.length` assertion for 5,120
  //  PASSES on the line above a `.buffer.byteLength` one that fails with 6,656.
  it("clamps an absurd declared stream size rather than allocating it", () => {
    const streams = readCfbfStreams(buildCfbf([{ name: "A", data: enc("x") }], { hugeStreamSize: true }));
    const a = streams.get("A");
    expect(a).toBeDefined();
    // The entry declares ~4 GB; its chain is ten 512-byte sectors (5,000 bytes
    // of data). The ALLOCATION must follow the chain, never the declaration.
    expect(a!.buffer.byteLength).toBe(10 * 512);
  });

  // ★★★ THE FIXTURE IS SELF-CONSISTENT AT THE ILLEGAL SIZE, WHICH IS THE ONLY
  //  WAY THIS ASSERTION CAN SEE THE SHIFT CHECK. Until 2026-09-04 it declared
  //  shift 7 over a 512-byte LAYOUT, so the resulting garbage offsets were
  //  rejected by whichever downstream bound met them first and `.size` was 0
  //  with the shift check deleted (measured twice, open-followups §356).
  //  `buildCfbf` now lays the WHOLE file out at 1024-byte sectors — an illegal
  //  MS-CFB sector size, but internally consistent — so nothing downstream has
  //  anything to object to and only `shift !== 9 && shift !== 12` can reject
  //  it. Verified RED 2026-09-04 by deleting that line: the file reads back one
  //  5,000-byte stream.
  //  ★ The 512-byte control is the anti-vacuity floor: without it, a fixture
  //  that stopped being readable for some unrelated reason would restore
  //  exactly the vacuity this replaced, and every gate would stay green.
  it("rejects an illegal sector shift", () => {
    const items = [{ name: "A", data: enc("x") }];
    expect(readCfbfStreams(buildCfbf(items)).size).toBe(1);
    expect(readCfbfStreams(buildCfbf(items, { illegalSectorShift: true })).size).toBe(0);
  });

  // ★★★ `not.toThrow()` COULD NEVER FAIL HERE, WHICH IS WHY THE ASSERTION IS
  //  NOW ABOUT BYTES. The old fixture linked to sector `totalSectors + 500`;
  //  with every bound in `chain()` deleted, `ctx.fat[s]` is `undefined`,
  //  `undefined <= MAXREGSECT` is false and the loop exits cleanly, so the test
  //  passed against both guards removed (open-followups §356). The fixture now
  //  under-declares `nFat` as 1 and links A's chain to the file's LAST sector:
  //  one 512-byte FAT sector describes 128 sectors, the file has 133, so sector
  //  132 is inside the file (the offset bound passes) and past `ctx.fat.length`
  //  (only the length bound rejects it). Deleting the length bound makes A
  //  absorb sector 132 — 1,024 bytes, half of them the filler's "Z"s. Verified
  //  RED 2026-09-04 on both assertions.
  //  ★★★ THE OFFSET BOUND BESIDE IT IS UNREACHABLE AND NO FIXTURE CAN CHANGE
  //  THAT — it is dominated, not merely hard to reach. `buildContext` pushes to
  //  `ctx.fat` only under `ctx.fat.length < fileSectors` (nothing else pushes:
  //  `grep -n "fat.push" src/app/cfbf.ts`), so `ctx.fat.length <= fileSectors =
  //  floor(b.length / sec) - 1`. The offset bound fires exactly when
  //  `(s + 2) * sec > b.length`, i.e. when `s >= floor(b.length / sec) - 1 =
  //  fileSectors >= ctx.fat.length` — every such `s` has already tripped the
  //  length bound one line above. Keep the offset bound as a standing check on
  //  that invariant; do NOT annotate it as untested-but-testable.
  it("stops a chain that runs past the FAT the header declares", () => {
    const filler = new TextEncoder().encode("Z".repeat(120 * 512));
    const bytes = buildCfbf([{ name: "A", data: enc("x") }, { name: "Filler", data: filler }], { chainPastEnd: true });
    const a = readCfbfStreams(bytes).get("A");
    expect(a).toBeDefined();
    expect(a!.length).toBe(512);                                  // A's own first sector, and nothing after it
    expect(new TextDecoder().decode(a!)).not.toContain("Z");      // never another stream's bytes
    // ★ And the writer refuses to emit the undersized version of this fixture,
    //  whose link would land INSIDE the declared FAT and quietly restore the
    //  vacuity above — a fixture that cannot reach its guard must fail loudly.
    expect(() => buildCfbf([{ name: "A", data: enc("x") }], { chainPastEnd: true })).toThrow(/declared FAT/);
  });

  it("returns an empty map for a non-CFBF file rather than guessing", () => {
    expect(readCfbfStreams(new TextEncoder().encode("not a compound file")).size).toBe(0);
  });
});

describe("cfbf resource bounds", () => {
  // ★★★ MEASURED DoS, NOT A HYPOTHETICAL. Before the file-derived FAT bound,
  //  repeated FAT-sector pointers each pushed another sector's worth of numbers
  //  onto `ctx.fat`: at a 512-byte sector 1 MB of input became 543 MB of heap
  //  in 299 ms, 4 MB became 1038 MB, and 6 MB threw `RangeError: Invalid array
  //  length` out of Array.push — a THROW escaping a reader whose contract is
  //  partial results, reachable through the 64 MB mail ceiling.
  //  ★★ WHAT THIS ASSERTION CAN AND CANNOT DO. Every FAT slot past the file's
  //  own sector count is unreachable through `chain`'s offset check, so the fix
  //  changes no returned BYTE at any input and there is nothing else to assert
  //  on. It also discriminates the PAIR of guards, not either half: dedup alone
  //  and the `fileSectors` cap alone each suppress the growth, so a mutation of
  //  one survives. Verified RED by restoring the pre-fix block verbatim, which
  //  turns this into `RangeError: Invalid array length`.
  it("does not amplify a DIFAT that repeats one FAT sector pointer", () => {
    const bytes = difatAmplifier(768 * 1024);
    let tree: Map<string, Uint8Array> | undefined;
    expect(() => { tree = readCfbfTree(bytes); }).not.toThrow();
    expect(tree?.size).toBe(0);          // dirStart is ENDOFCHAIN: nothing to read
  });

  // ★★★ MEASURED DoS. `readCfbfTree`'s walk used to recurse on `left` and
  //  `right` BEFORE doing any work, so its depth was the SIBLING COUNT — and
  //  siblings are a linked list, not a balanced red-black tree, in this repo's
  //  own writer (`cfbf-writer.ts` chains `E[idxs[i]].right = idxs[i + 1]`) and
  //  in any hostile .msg. Measured under node 24 on this machine with the
  //  pre-fix reader: 8,600 sibling storages walked and 8,700 threw `RangeError:
  //  Maximum call stack size exceeded`, from a 1.1 MB file.
  //  ★★ 12,000 IS DELIBERATE HEADROOM OVER THAT 8,700, not a measurement: the
  //  threshold moves with frame size, with the engine, and with the host — a
  //  browser gives less stack than node, so the reachable count there is lower.
  //  Do NOT tune this down towards the measured threshold; the fixture is
  //  1.6 MB and the test runs in well under a second either way.
  //  ★ The stream hangs off the LAST sibling — the deepest point of the old
  //  recursion — so a reader that silently truncated the walk instead of
  //  overflowing would fail this too, rather than passing with an empty map.
  const SIBLINGS = 12_000;
  it("walks a long sibling chain iteratively rather than once per frame", () => {
    const items: CfbfEntryInput[] = [];
    for (let i = 0; i < SIBLINGS - 1; i++) items.push({ name: `s${i}` });
    items.push({ name: `s${SIBLINGS - 1}`, children: [{ name: "Leaf", data: enc("deep") }] });
    const tree = readCfbfTree(buildCfbf(items));
    expect(tree.size).toBe(1);
    expect(new TextDecoder().decode(tree.get(`s${SIBLINGS - 1}/Leaf`)!).trim()).toBe("deep");
  });

  // ★★★ MEASURED QUADRATIC, AND THE ONE BOUND HERE WHOSE ABSENCE CANNOT THROW.
  //  `readCfbfTree` keys its Map by PATH, rebuilding each emitted stream's path
  //  from every ancestor's name — O(N²) characters for O(N) bytes of input.
  //  Measured 2026-09-03 on the uncapped reader with THIS fixture: depth 250 ->
  //  0.32 M key chars from 190 KB, 500 -> 1.26 M from 379 KB, 1,000 -> 5.01 M
  //  from 757 KB, 2,000 -> 20.03 M from 1,513 KB (4.0x per doubling).
  //  `checkAttachmentSize` admits 64 MB of mail, extrapolating to tens of GB.
  //  ★★ NO `not.toThrow()` COULD HAVE CAUGHT THIS, which is why the assertion
  //  counts characters instead. The deepest single key stays far under V8's
  //  string limit, so the process OOM-ABORTS rather than throwing — and an OOM
  //  abort is not catchable at any call site.
  //  ★ The three assertions discriminate three different failures: the char
  //  budget catches the cap being removed (20.03 M against 20,000 here), the
  //  segment count catches it being applied to SIBLINGS instead of children (a
  //  long sibling list would then be truncated and deep nesting would not), and
  //  the shallow lookup catches a cap that swallowed the whole tree — an empty
  //  map satisfies the other two.
  //  Verified RED against the uncapped walk: 20,028,000 key characters.
  const DEEP = 2_000;
  it("caps nesting depth so path keys cannot grow quadratically", () => {
    const tree = readCfbfTree(buildCfbf(deepNest(DEEP)));
    let chars = 0;
    let maxSegments = 0;
    for (const k of tree.keys()) {
      chars += k.length;
      maxSegments = Math.max(maxSegments, k.split("/").length);
    }
    expect(chars).toBeLessThan(20_000);
    expect(maxSegments).toBe(32);              // MAX_CFBF_DEPTH, spelled out
    expect(tree.has("stor00001/strm00001")).toBe(true);
  });

  // ★★★ MEASURED: 1,000 entries in a 631 KB file retained 616 MB (~1000x).
  //  `readEntryBytes` sized its buffer from the DECLARED size clamped only by
  //  the file's total length, and `out.subarray(...)` keeps its whole backing
  //  store alive — so every entry that lied about its size retained one
  //  file-sized buffer. The invariant asserted here is the one that makes the
  //  fix sound: a compound file cannot hold more stream bytes than it is long,
  //  because streams occupy disjoint sectors.
  //  ★ `.buffer.byteLength`, not `.length`, is the whole point — the pre-fix
  //  reader returned SHORT views onto huge buffers, so a `.length` assertion
  //  passes against the defect.
  it("retains no more stream bytes in total than the file is long", () => {
    const items: CfbfEntryInput[] = [];
    for (let i = 0; i < 200; i++) items.push({ name: `s${i}`, data: tiny() });
    const bytes = buildCfbf(items, { hugeStreamSize: true });
    const streams = readCfbfStreams(bytes);
    expect(streams.size).toBe(200);
    let retained = 0;
    for (const v of streams.values()) retained += v.buffer.byteLength;
    expect(retained).toBeLessThanOrEqual(bytes.length);
  });

  // ★★★ THE SAME INVARIANT, AGAINST THE SHAPE THE TEST ABOVE CANNOT REACH, and
  //  it exists because the obvious single test was measured NOT to pin the
  //  cumulative budget: deleting `budget` from readEntryBytes' `Math.min` left
  //  every other test in this file green. Every stream `buildCfbf` emits
  //  owns its sectors, so the per-entry "what can this chain deliver" clamp
  //  bounds the total there for free. Point 200 entries at ONE 100 KB chain and
  //  each of them delivers 100 KB LEGITIMATELY — 20 MB out of a 228 KB file,
  //  which only a cumulative cap can stop.
  it("bounds the total even when every entry shares one long chain", () => {
    const items: CfbfEntryInput[] = [{ name: "s0", data: new TextEncoder().encode("L".repeat(100_000)) }];
    for (let i = 1; i < 200; i++) items.push({ name: `s${i}`, data: tiny() });
    const bytes = shareOneChain(buildCfbf(items), items.length);
    const streams = readCfbfStreams(bytes);
    expect(streams.size).toBe(200);
    let retained = 0;
    for (const v of streams.values()) retained += v.buffer.byteLength;
    expect(retained).toBeLessThanOrEqual(bytes.length);
  });
});
