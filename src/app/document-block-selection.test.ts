import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  selectionAfterMove,
  selectionAfterInsert,
  selectionAfterDelete,
} from "./document-block-selection";

/** The array `selectionAfterMove` is specified against — `reorderIds`' splice,
 *  spelled out here rather than imported so the expectations are readable as
 *  data. Remove at `from`, insert at the target's PRE-removal index. */
const moved = <T>(items: readonly T[], from: number, to: number): T[] => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

describe("selectionAfterMove", () => {
  // ★★★ THE DEFECT THIS EXISTS FOR. The selection is a bare INDEX, so a move
  //  that leaves it pointing at the same NUMBER points it at a DIFFERENT
  //  block — and in a document of paragraphs the old index is still a
  //  paragraph, so the "is it still a paragraph?" fallback in
  //  document-editor.tsx never fires. The user moves the block they selected
  //  and watches a different one expand.
  it("follows the moved block itself", () => {
    expect(selectionAfterMove(0, 0, 2)).toBe(2);
    expect(selectionAfterMove(2, 2, 0)).toBe(0);
  });

  // ★★ EXHAUSTIVE over a 4-item list rather than a handful of cases: the
  //  arithmetic has two independent shifts (splice-out, splice-in) and an
  //  off-by-one in either survives any single example. Every (from, to,
  //  chosen) triple is checked against where the block actually lands.
  it("agrees with the splice for every position in a four-block list", () => {
    const ids = [0, 1, 2, 3];
    for (const from of ids) {
      for (const to of ids) {
        const after = moved(ids, from, to);
        for (const chosen of ids) {
          expect({ from, to, chosen, got: selectionAfterMove(chosen, from, to) }).toEqual({
            from,
            to,
            chosen,
            got: after.indexOf(chosen),
          });
        }
      }
    }
  });

  it("leaves an unset selection unset", () => {
    expect(selectionAfterMove(null, 0, 2)).toBeNull();
  });
});

describe("selectionAfterInsert", () => {
  it("shifts a selection at or after the insert point up by one", () => {
    expect(selectionAfterInsert(2, 0, "heading")).toBe(3);
    expect(selectionAfterInsert(2, 2, "heading")).toBe(3);
  });

  it("leaves a selection before the insert point alone", () => {
    expect(selectionAfterInsert(1, 2, "heading")).toBe(1);
  });

  it("leaves an unset selection unset", () => {
    expect(selectionAfterInsert(null, 0, "heading")).toBeNull();
  });

  // ★★★ §199. A narrow pane collapses every paragraph but the selected one
  //  behind an "Edit this block" button — so shifting the OLD selection past
  //  an inserted paragraph handed the user a fresh seeded paragraph they
  //  could not type into. The fix: an inserted paragraph BECOMES the
  //  selection, regardless of where the old selection was.
  it("selects the new block when a paragraph is inserted", () => {
    expect(selectionAfterInsert(0, 2, "paragraph")).toBe(2);
    expect(selectionAfterInsert(3, 1, "paragraph")).toBe(1);
    expect(selectionAfterInsert(null, 0, "paragraph")).toBe(0);
  });

  // ★ PARAGRAPH ONLY. `document-editor.tsx`'s selection model admits nothing
  //  else: `resolvedSelection` re-checks `type === "paragraph"` and the
  //  collapse prop is read by the paragraph row alone, so selecting an
  //  inserted heading/table/etc. would be resolved away on the very next
  //  render — a no-op. Every OTHER addable kind therefore keeps the plain
  //  shift-past-the-insert-point rule.
  it("keeps the plain shift-past rule for every non-paragraph kind", () => {
    for (const kind of ["heading", "bullets", "table", "dataSection", "pageBreak"] as const) {
      expect(selectionAfterInsert(2, 0, kind)).toBe(3);
      expect(selectionAfterInsert(0, 2, kind)).toBe(0);
      expect(selectionAfterInsert(null, 0, kind)).toBeNull();
    }
  });
});

describe("selectionAfterDelete", () => {
  it("shifts a selection after the deleted block down by one", () => {
    expect(selectionAfterDelete(2, 0)).toBe(1);
  });

  it("leaves a selection before the deleted block alone", () => {
    expect(selectionAfterDelete(1, 2)).toBe(1);
  });

  // ★★ FALL BACK, never adopt the neighbour. Keeping the number would silently
  //  hand the selection to whichever block slid into that slot — the same
  //  wrong-block class the move case fixes, and here the user asked for a
  //  DELETE, which is the one op after which "something else is now selected"
  //  reads as data loss.
  it("clears a selection ON the deleted block rather than adopting its successor", () => {
    expect(selectionAfterDelete(2, 2)).toBeNull();
  });

  it("leaves an unset selection unset", () => {
    expect(selectionAfterDelete(null, 0)).toBeNull();
  });
});

// open-followups §345. The module header promises NO React, NO DOM, NO i18n,
// and `vitest.config.ts` runs every test under jsdom, so a value import that
// dragged i18n or DOMPurify in would fail nothing. This source scan is the only
// thing that can see it: every import (and re-export) must be type-only.
// ★ cwd-relative path, as in document-model.test.ts's scan.
describe("document-block-selection stays dependency-free", () => {
  const src = readFileSync("src/app/document-block-selection.ts", "utf8");
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("has only `import type` statements", () => {
    const imports = codeOnly.match(/^\s*import\b[^;]*;/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0); // anti-vacuity: the scan found today's import
    for (const stmt of imports) expect(stmt).toMatch(/^\s*import\s+type\b/);
  });

  it("has no value re-export and no dynamic import", () => {
    expect(codeOnly).not.toMatch(/^\s*export\s+(?!type\b)(?:\*|\{[^}]*\})\s*from\b/m);
    expect(codeOnly).not.toMatch(/\bimport\s*\(/);
  });
});
