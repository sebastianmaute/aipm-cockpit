import { describe, expect, it } from "vitest";
import { blockToken } from "./document-block-token";
import { blockChanged, type DocBlock } from "./document-model";

describe("blockToken", () => {
  it("agrees with blockChanged that an omitted field and an explicit undefined are one block", () => {
    // ★★★ The two guards run side by side in applyOps. If they disagree about
    //   any pair of blocks, the AI path refuses writes the hand editor accepts.
    const omitted: DocBlock = { type: "bullets", items: ["a"] };
    const explicit: DocBlock = { type: "bullets", items: ["a"], ordered: undefined };
    expect(blockChanged(omitted, explicit)).toBe(false);
    expect(blockToken(omitted)).toBe(blockToken(explicit));
  });

  it("agrees with blockChanged that a PRESENT empty optional differs from an absent one", () => {
    // ★★★ The false-permit case, and the reason every optional carries a
    //   presence flag: `caption ?? ""` would collapse these two into one token
    //   while blockChanged calls them different.
    const absent: DocBlock = { type: "table", columns: ["c"], rows: [["v"]] };
    const empty: DocBlock = { type: "table", columns: ["c"], rows: [["v"]], caption: "" };
    expect(blockChanged(absent, empty)).toBe(true);
    expect(blockToken(absent)).not.toBe(blockToken(empty));
  });

  it("distinguishes two tables differing only in where a row is split", () => {
    // The case a naive concatenation collides: same characters, different shape.
    const a: DocBlock = { type: "table", columns: ["x", "y"], rows: [["ab", "c"]] };
    const b: DocBlock = { type: "table", columns: ["x", "y"], rows: [["a", "bc"]] };
    expect(blockToken(a)).not.toBe(blockToken(b));
  });

  it("distinguishes bullets whose items differ only in where the split falls", () => {
    const a: DocBlock = { type: "bullets", items: ["ab", "c"] };
    const b: DocBlock = { type: "bullets", items: ["a", "bc"] };
    expect(blockToken(a)).not.toBe(blockToken(b));
  });

  it("distinguishes bullets whose items collide without the per-value length", () => {
    // ★★★ THE SPLIT-MOVING FIXTURES ABOVE DO NOT PIN THE LENGTH PREFIX — measured:
    //   dropping it from `field` left them green (0 failed / 7 passed), because
    //   `list` separates elements by index anyway. These two are the pair that
    //   actually collides: both render `items#2:0:x1:y1:z` without the length.
    const a: DocBlock = { type: "bullets", items: ["x1:y", "z"] };
    const b: DocBlock = { type: "bullets", items: ["x", "y1:z"] };
    expect(blockChanged(a, b)).toBe(true);
    expect(blockToken(a)).not.toBe(blockToken(b));
  });

  it("distinguishes table rows that collide without the per-value length", () => {
    const a: DocBlock = { type: "table", columns: ["p", "q"], rows: [["x1:y", "z"]] };
    const b: DocBlock = { type: "table", columns: ["p", "q"], rows: [["x", "y1:z"]] };
    expect(blockChanged(a, b)).toBe(true);
    expect(blockToken(a)).not.toBe(blockToken(b));
  });

  it("distinguishes ordered:false from an absent ordered", () => {
    const absent: DocBlock = { type: "bullets", items: ["a"] };
    const explicitFalse: DocBlock = { type: "bullets", items: ["a"], ordered: false };
    expect(blockChanged(absent, explicitFalse)).toBe(true);
    expect(blockToken(absent)).not.toBe(blockToken(explicitFalse));
  });

  it("gives every block type a distinct token from every other", () => {
    const blocks: DocBlock[] = [
      { type: "heading", level: 1, text: "t" },
      { type: "heading", level: 2, text: "t" },
      { type: "paragraph", html: "<p>t</p>" },
      { type: "bullets", items: ["t"] },
      { type: "table", columns: ["t"], rows: [] },
      { type: "dataSection", key: "tasks" },
      { type: "pageBreak" },
    ];
    const tokens = blocks.map(blockToken);
    expect(new Set(tokens).size).toBe(blocks.length);
  });

  it("is stable across calls", () => {
    const b: DocBlock = { type: "paragraph", html: "<p>hello</p>" };
    expect(blockToken(b)).toBe(blockToken(b));
  });
});
