import { beforeAll, describe, expect, it } from "vitest";
import { applyOps } from "./document-ops";
import { displayRejected } from "./document-refusal-text";
import { loadI18n, t } from "./i18n";
import type { DocBlock } from "./document-model";

// §186: the concurrent-writer refusal reached users as raw engine English.
describe("displayRejected", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  const para = (html: string): DocBlock => ({ type: "paragraph", html });

  /** Real engine reasons for all three guarded ops, so a reworded engine
   *  string reddens this rather than leaving a fixture string matching. */
  function conflictReasons(): string[] {
    const stale = para("old");
    const blocks = [para("new-a"), para("new-b"), para("new-c")];
    const rejected: string[] = [];
    applyOps(
      blocks,
      [
        { op: "replace", index: 0, block: para("x"), expect: stale },
        { op: "delete", index: 1, expect: stale },
        { op: "move", from: 2, to: 0, expect: stale },
      ],
      rejected,
    );
    return rejected;
  }

  it("maps every guarded op's conflict to one translated sentence", () => {
    const reasons = conflictReasons();
    expect(reasons).toHaveLength(3);
    expect(displayRejected("en-US", reasons)).toEqual([t("en-US", "documentsBlockConflictNotSaved")]);
    expect(displayRejected("de", reasons)).toEqual([t("de", "documentsBlockConflictNotSaved")]);
  });

  it("passes any other reason through, keeping the conflict in its first position", () => {
    const [conflict] = conflictReasons();
    const other = "op 1: insert requires a block";
    expect(displayRejected("en-US", [other, conflict, "tail", conflict])).toEqual([
      other,
      t("en-US", "documentsBlockConflictNotSaved"),
      "tail",
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(displayRejected("en-US", [])).toEqual([]);
  });
});
