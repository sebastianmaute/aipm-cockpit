import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyOps, type DocOp } from "./document-ops";
import type { DocBlock } from "./document-model";

const P = (t: string): DocBlock => ({ type: "paragraph", html: `<p>${t}</p>` });
const A = P("a"), B = P("b"), C = P("c");

/** Runs ops against [A,B,C] and returns both halves of the result, so a test
 *  can assert on the refusal REASON and not merely on "it did nothing". */
function run(ops: DocOp[], blocks: readonly DocBlock[] = [A, B, C]) {
  const rejected: string[] = [];
  const next = applyOps(blocks, ops, rejected);
  return { next, rejected };
}

describe("move", () => {
  it("moves a block forwards, closing the gap it left", () => {
    const { next, rejected } = run([{ op: "move", from: 0, to: 2 }]);
    expect(rejected).toEqual([]);
    expect(next).toEqual([B, C, A]);
  });

  it("moves a block backwards", () => {
    const { next, rejected } = run([{ op: "move", from: 2, to: 0 }]);
    expect(rejected).toEqual([]);
    expect(next).toEqual([C, A, B]);
  });

  it("accepts the last index as a destination (move to the end)", () => {
    const { next } = run([{ op: "move", from: 1, to: 2 }]);
    expect(next).toEqual([A, C, B]);
  });

  it("refuses an out-of-range `from`", () => {
    const { next, rejected } = run([{ op: "move", from: 3, to: 0 }]);
    expect(next).toBeNull();
    expect(rejected[0]).toContain("move from 3 out of range 0..2");
  });

  it("refuses an out-of-range `to`", () => {
    const { next, rejected } = run([{ op: "move", from: 0, to: 3 }]);
    expect(next).toBeNull();
    expect(rejected[0]).toContain("move to 3 out of range 0..2");
  });

  it("refuses a non-integer index rather than coercing it", () => {
    const { next, rejected } = run([{ op: "move", from: 1.5, to: 0 }]);
    expect(next).toBeNull();
    expect(rejected[0]).toContain("out of range");
  });

  // ★ `changed` is derived from the applied COUNT, never from comparing the
  //  result, so an applied self-move would mint a version before-image
  //  recording nothing at all.
  it("refuses a self-move instead of applying it", () => {
    const { next, rejected } = run([{ op: "move", from: 1, to: 1 }]);
    expect(next).toBeNull();
    expect(rejected[0]).toContain("move from 1 to 1 is a no-op");
  });

  it("refuses when `expect` no longer matches the block at `from`", () => {
    const { next, rejected } = run([{ op: "move", from: 0, to: 2, expect: P("stale") }]);
    expect(next).toBeNull();
    expect(rejected[0]).toContain("move index 0 was changed by another writer");
  });

  it("applies when `expect` matches", () => {
    const { next } = run([{ op: "move", from: 0, to: 2, expect: P("a") }]);
    expect(next).toEqual([B, C, A]);
  });

  // ★★★ THE REASON `move` IS ONE OP. applyOps validates and applies per-op and
  //  bails wholesale ONLY when nothing applied — so the composed spelling can
  //  delete a block and then fail to put it back. This test is the contrast
  //  that makes the single op load-bearing rather than a convenience.
  it("is atomic where a composed delete+insert is not", () => {
    const composed = run([
      { op: "delete", index: 0 },
      { op: "insert", index: 99, block: A },
    ]);
    expect(composed.next).toEqual([B, C]);          // A is GONE
    expect(composed.rejected).toHaveLength(1);

    const single = run([{ op: "move", from: 0, to: 2 }]);
    expect(single.next).toEqual([B, C, A]);         // A survives
    expect(single.rejected).toEqual([]);
  });
});

describe("delete precondition", () => {
  it("refuses when `expect` no longer matches the block at `index`", () => {
    const { next, rejected } = run([{ op: "delete", index: 1, expect: P("stale") }]);
    expect(next).toBeNull();
    expect(rejected[0]).toContain("delete index 1 was changed by another writer");
  });

  it("applies when `expect` matches", () => {
    const { next } = run([{ op: "delete", index: 1, expect: P("b") }]);
    expect(next).toEqual([A, C]);
  });

  // ★★★ An ABSENT expect must never read as "expected nothing" — every AI and
  //  tool caller omits it and must keep applying. Mutating the guard to
  //  `op.expect === undefined || blockChanged(...)` kills this test.
  it("still applies when `expect` is absent", () => {
    const { next } = run([{ op: "delete", index: 1 }]);
    expect(next).toEqual([A, C]);
  });
});

describe("DOM-free contract", () => {
  it("never calls DOMPurify", () => {
    // ★ document-ops.ts's header declares it DOM-FREE BY CONTRACT, inherited
    //  from document-mutations.ts — this only rearranges already-sanitized
    //  DocBlock values. document-mutations.ts never carried this guard, so the
    //  split inherited the CONTRACT without the ENFORCEMENT; this closes that
    //  gap the same way document-versions.test.ts / document-model.test.ts do.
    //  Comments may name DOMPurify (as this file's own header does); code may
    //  not — hence the comment-strip before the pattern match.
    const src = readFileSync("src/app/document-ops.ts", "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/DOMPurify|dompurify|\bwindow\b|\bdocument\b\s*\./);
  });
});
