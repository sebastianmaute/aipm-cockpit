import { describe, it, expect } from "vitest";
import { readCfbfStreams, readCfbfTree } from "./cfbf";
import { buildCfbf } from "./__fixtures__/cfbf-writer";

const enc = (s: string) => new TextEncoder().encode(s.padEnd(5000, " "));

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

  it("clamps an absurd declared stream size rather than allocating it", () => {
    const streams = readCfbfStreams(buildCfbf([{ name: "A", data: enc("x") }], { hugeStreamSize: true }));
    const a = streams.get("A");
    expect(a === undefined || a.length < 1_000_000).toBe(true);
  });

  it("rejects an illegal sector shift", () => {
    expect(readCfbfStreams(buildCfbf([{ name: "A", data: enc("x") }], { illegalSectorShift: true })).size).toBe(0);
  });

  it("stops a chain that runs past the end of the file", () => {
    expect(() => readCfbfStreams(buildCfbf([{ name: "A", data: enc("x") }], { chainPastEnd: true }))).not.toThrow();
  });

  it("returns an empty map for a non-CFBF file rather than guessing", () => {
    expect(readCfbfStreams(new TextEncoder().encode("not a compound file")).size).toBe(0);
  });
});
