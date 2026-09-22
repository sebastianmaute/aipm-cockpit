import { describe, expect, it } from "vitest";
import {
  abbreviateUnique,
  count,
  judgeRemap,
  parseCommitMap,
  planRemap,
  remap,
} from "./remap-commit-citations.mjs";

const OLD_A = "a".repeat(40);
const NEW_A = "1".repeat(40);
const OLD_C = "c".repeat(40);
const NEW_C = "3".repeat(40);

describe("remap", () => {
  it("preserves the citation count even when a citation cannot be mapped", () => {
    const map = new Map([["aaaaaaa", "1111111"]]);
    const out = remap("see `aaaaaaa` and `bbbbbbb`", map);
    expect(out).toContain("1111111");
    expect(out).toContain("bbbbbbb"); // untouched, not dropped
    expect(count(out)).toBe(2); // the failure mode that matters
  });

  it("rewrites every occurrence, and only inside backticks", () => {
    const map = new Map([["aaaaaaa", "1111111"]]);
    const out = remap("`aaaaaaa` bare aaaaaaa `aaaaaaa`", map);
    expect(out).toBe("`1111111` bare aaaaaaa `1111111`");
  });

  it("does not chain: a replacement that equals another mapped token is not re-mapped", () => {
    const map = new Map([
      ["aaaaaaa", "ccccccc"],
      ["ccccccc", "3333333"],
    ]);
    expect(remap("`aaaaaaa` `ccccccc`", map)).toBe("`ccccccc` `3333333`");
  });
});

describe("count", () => {
  it("counts backticked lowercase hex of 7 to 40 characters only", () => {
    const text = "`abcdef1` `abcdef` `ABCDEF1` `" + "a".repeat(41) + "` `" + "b".repeat(40) + "`";
    expect(count(text)).toBe(2);
  });
});

describe("parseCommitMap", () => {
  it("skips the header and reads old → new pairs", () => {
    const m = parseCommitMap(`old                                      new\n${OLD_A} ${NEW_A}\n`);
    expect(m.get(OLD_A)).toBe(NEW_A);
    expect(m.size).toBe(1);
  });
});

describe("abbreviateUnique", () => {
  it("keeps the cited length when that prefix is unambiguous", () => {
    expect(abbreviateUnique(NEW_A, 8, () => false)).toBe("11111111");
  });

  it("lengthens until the prefix names exactly one object", () => {
    const ambiguous = new Set(["1111111", "11111111"]);
    expect(abbreviateUnique(NEW_A, 7, (p) => ambiguous.has(p))).toBe("111111111");
  });
});

describe("planRemap", () => {
  it("maps resolving tokens and lists dangling ones instead of inventing a target", () => {
    const { map, dangling, unmapped } = planRemap({
      tokens: ["aaaaaaa", "ccccccccc", "bbbbbbb"],
      oldFull: new Map([
        ["aaaaaaa", OLD_A],
        ["ccccccccc", OLD_C],
      ]),
      commitMap: new Map([
        [OLD_A, NEW_A],
        [OLD_C, NEW_C],
      ]),
      isAmbiguous: () => false,
    });
    expect(map.get("aaaaaaa")).toBe("1111111");
    expect(map.get("ccccccccc")).toBe("333333333"); // the cited length is kept
    expect(dangling).toEqual(["bbbbbbb"]);
    expect(unmapped).toEqual([]);
  });

  it("reports a resolving token the commit map does not cover", () => {
    const { map, unmapped } = planRemap({
      tokens: ["aaaaaaa"],
      oldFull: new Map([["aaaaaaa", OLD_A]]),
      commitMap: new Map(),
      isAmbiguous: () => false,
    });
    expect(map.size).toBe(0);
    expect(unmapped).toEqual(["aaaaaaa"]);
  });
});

describe("judgeRemap", () => {
  const base = { beforeTotal: 3, afterTotal: 3, expected: 2, resolvedAfter: 2 };

  it("passes when the total holds and every remapped citation resolves", () => {
    expect(judgeRemap(base).ok).toBe(true);
  });

  it("fails a silent drop, which the resolve check alone cannot see", () => {
    expect(judgeRemap({ ...base, afterTotal: 2 }).ok).toBe(false);
  });

  it("fails when a remapped citation does not resolve to its new commit", () => {
    expect(judgeRemap({ ...base, resolvedAfter: 1 }).ok).toBe(false);
  });
});
