import { describe, it, expect } from "vitest";
import { forEachTagPair, replaceTagPairs, type TagPairSpec } from "./tag-pair-walk";

const SPEC: TagPairSpec = {
  openPattern: "<(w:tbl)\\b",
  closeName: (m) => m[1],
  hasAttributes: true,
};

describe("forEachTagPair", () => {
  it("visits each pair with its inner text", () => {
    const pairs: string[] = [];
    forEachTagPair("<w:tbl>a</w:tbl><w:tbl>b</w:tbl>", SPEC, (p) => {
      pairs.push(p.inner);
      return true;
    });
    expect(pairs).toEqual(["a", "b"]);
  });

  it("stops when visit returns false", () => {
    const pairs: string[] = [];
    forEachTagPair("<w:tbl>a</w:tbl><w:tbl>b</w:tbl>", SPEC, (p) => {
      pairs.push(p.inner);
      return false;
    });
    expect(pairs).toEqual(["a"]);
  });

  it("leaves an unclosed open tag alone instead of consuming the rest", () => {
    const pairs: string[] = [];
    forEachTagPair("<w:tbl>unclosed", SPEC, (p) => {
      pairs.push(p.inner);
      return true;
    });
    expect(pairs).toEqual([]);
  });

  it("retires a close name that is missing, so cost stays linear", () => {
    // 20k unclosed opens: quadratic scanning would take seconds, linear is ms.
    const input = "<w:tbl ".repeat(20_000);
    const start = performance.now();
    forEachTagPair(input, SPEC, () => true);
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe("replaceTagPairs", () => {
  it("replaces each pair and keeps the text around it", () => {
    const out = replaceTagPairs("x<w:tbl>a</w:tbl>y", SPEC, (p) => "[" + p.inner + "]");
    expect(out).toBe("x[a]y");
  });
});
