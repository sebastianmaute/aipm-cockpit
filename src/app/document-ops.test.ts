import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { applyOps, type DocOp } from "./document-ops";
import { blockToken } from "./document-block-token";
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

  // ★ Names the destination so it distinguishes WHICH of the two range guards
  //  fired, unlike the `from` test above — `Number.isInteger(op.to)` survived
  //  deletion otherwise: the remaining range check passes a fractional `to`,
  //  `from !== to` holds, and `splice(1.5, 0, moved)` truncates to 1 and
  //  applies with no rejection.
  it("refuses a non-integer `to`", () => {
    const { next, rejected } = run([{ op: "move", from: 0, to: 1.5 }]);
    expect(next).toBeNull();
    expect(rejected[0]).toContain("move to 1.5 out of range");
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

describe("expectHash", () => {
  const LIVE = P("live"), STALE = P("stale"), AI = P("ai");

  it("refuses a replace whose expectHash does not match, and leaves the block UNCHANGED", () => {
    // ★★ Asserts on the BLOCK, not merely on a rejection. A test that only
    //  checks the refusal message passes against code that pushed the message
    //  AFTER writing.
    // ★★★ THE SECOND OP IS LOAD-BEARING, and the obvious one-op version of
    //  this test is VACUOUS: applyOps copies its input (`next = [...blocks]`),
    //  so asserting the CALLER's array is untouched is true however the engine
    //  behaves, and a wholly-refused batch returns null with no array to read.
    //  The append makes the batch partially apply, so there IS a result whose
    //  index 0 can be checked against the live block.
    const appended = P("appended");
    const { next, rejected } = run(
      [
        { op: "replace", index: 0, block: AI, expectHash: blockToken(STALE) },
        { op: "append", block: appended },
      ],
      [LIVE],
    );
    expect(next).toEqual([LIVE, appended]);
    expect(rejected[0]).toMatch(/changed by another writer/);
  });

  it("applies a replace whose expectHash matches", () => {
    const { next, rejected } = run([{ op: "replace", index: 0, block: AI, expectHash: blockToken(LIVE) }], [LIVE]);
    expect(next).not.toBeNull();
    expect(next?.[0]).toEqual(AI);
    expect(rejected).toEqual([]);
  });

  it("reads the EVOLVING list, not the original", () => {
    // ★★★ This is why the check cannot live in the tool layer. After op 0
    //  deletes index 0, the block the model tokenised as index 1 IS index 0.
    const { next, rejected } = run(
      [
        { op: "delete", index: 0, expectHash: blockToken(A) },
        { op: "replace", index: 0, block: C, expectHash: blockToken(B) },
      ],
      [A, B],
    );
    expect(rejected).toEqual([]);
    expect(next).toEqual([C]);
  });

  it("refuses a delete and a move on mismatch too", () => {
    const stale = blockToken(STALE);

    const del = run([{ op: "delete", index: 0, expectHash: stale }], [LIVE]);
    expect(del.next).toBeNull();
    expect(del.rejected[0]).toMatch(/changed by another writer/);

    const mov = run([{ op: "move", from: 0, to: 1, expectHash: stale }], [LIVE, P("x")]);
    expect(mov.next).toBeNull();
    expect(mov.rejected[0]).toMatch(/changed by another writer/);
  });

  it("an ABSENT expectHash still applies — the engine stays permissive", () => {
    // ★★★ document-ops.ts's stated contract: an absent precondition must never
    //  be read as "expected nothing". The hand block editor shares this engine
    //  and omits the field. Strictness lives in the TOOL layer.
    const { next, rejected } = run([{ op: "replace", index: 0, block: AI }], [LIVE]);
    expect(next).toEqual([AI]);
    expect(rejected).toEqual([]);
  });

  it("checks BOTH preconditions when both are supplied", () => {
    // ★ `expect` MATCHES here on purpose, so only the hash check can refuse —
    //  a mismatching `expect` would let the pre-existing check kill this test
    //  and it would pin nothing new.
    const { next, rejected } = run(
      [{ op: "replace", index: 0, block: AI, expect: LIVE, expectHash: blockToken(STALE) }],
      [LIVE],
    );
    expect(next).toBeNull();
    expect(rejected[0]).toMatch(/changed by another writer/);
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
