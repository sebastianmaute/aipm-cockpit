import { describe, it, expect } from "vitest";
import { applyDocMutation, type DocState } from "./document-mutations";
import { deletedDocumentVersions } from "./document-versions";
import { MAX_BLOCKS_PER_DOC, MAX_DOCUMENTS, type DocBlock, type ProjectDocument } from "./document-model";
import { MAX_LINKS_PER_DOC } from "./document-ref";

const DOC: ProjectDocument = {
  id: 1,
  title: "Status report",
  blocks: [
    { type: "heading", level: 1, text: "Week 12" },
    { type: "paragraph", html: "<p>on track</p>" },
  ],
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:00:00.000Z",
};

const state = (over: Partial<DocState> = {}): DocState => ({ documents: [DOC], versions: [], ...over });

let nextDoc = 100;
let nextVer = 200;
const ctx = () => ({
  now: "2026-08-06T09:00:00.000Z",
  source: "ai" as const,
  mintDocId: () => nextDoc++,
  mintVersionId: () => nextVer++,
});

describe("applyDocMutation — versions", () => {
  it("create writes no version — nothing was replaced", () => {
    const out = applyDocMutation(state(), { kind: "create", title: "New" }, ctx());
    expect(out.versions).toEqual([]);
    expect(out.documents).toHaveLength(2);
  });

  it("rename snapshots the PRIOR title, not the new one", () => {
    const out = applyDocMutation(state(), { kind: "rename", id: 1, title: "Renamed" }, ctx());
    expect(out.versions).toHaveLength(1);
    expect(out.versions[0].title).toBe("Status report");
    expect(out.versions[0].op).toBe("rename");
    expect(out.documents[0].title).toBe("Renamed");
  });

  it("delete snapshots before removing", () => {
    const out = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    expect(out.documents).toEqual([]);
    expect(out.versions[0].blocks).toEqual(DOC.blocks);
    expect(out.versions[0].op).toBe("delete");
  });

  it("a no-op returns the SAME references and changed:false", () => {
    const s = state();
    const out = applyDocMutation(s, { kind: "rename", id: 999, title: "x" }, ctx());
    expect(out.documents).toBe(s.documents);
    expect(out.versions).toBe(s.versions);
    expect(out.changed).toBe(false);
  });
});

describe("applyDocMutation — ops", () => {
  it("applies ops against the EVOLVING array", () => {
    const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op: "delete", index: 0 }, { op: "delete", index: 0 }] }, ctx());
    expect(out.documents[0].blocks).toEqual([]);
  });

  it("appends, inserts and replaces", () => {
    const out = applyDocMutation(state(), {
      kind: "ops", id: 1,
      ops: [
        { op: "append", block: { type: "pageBreak" } },
        { op: "insert", index: 0, block: { type: "heading", level: 2, text: "Intro" } },
        { op: "replace", index: 1, block: { type: "heading", level: 3, text: "Week 13" } },
      ],
    }, ctx());
    expect(out.documents[0].blocks.map((b) => b.type)).toEqual(["heading", "heading", "paragraph", "pageBreak"]);
    expect(out.documents[0].blocks[1]).toEqual({ type: "heading", level: 3, text: "Week 13" });
  });

  // ★★★ POSITION IS THE ASSERTION, NOT COUNT — and until these two landed
  // NOTHING in the repo pinned it. Every in-range `insert` and `delete` fixture
  // in this file used `index: 0`, and the property test asserted block COUNT,
  // which cannot separate "inserted at N" from "inserted at 0". Measured:
  // `next.splice(op.index, 0, op.block)` → `splice(0, 0, …)` and
  // `next.splice(op.index, 1)` → `splice(0, 1)` BOTH shipped green across all
  // 26 document test files. (`replace` was caught only because line 71's
  // fixture happened to use a non-zero index — the sole one on the branch.)
  //
  // ★★ It is the AI's `update_document` write path: the model addresses blocks
  // positionally against a document it was told to read first, so a misapplied
  // index silently corrupts a user's document AND the before-image records the
  // corruption as a legitimate edit. Seeded with three DISTINCT block types so
  // the resulting ORDER is decidable — an all-pageBreak fixture would pass
  // either way.
  it("inserts at a NON-ZERO index rather than at the front", () => {
    const start: DocState = {
      documents: [{ ...DOC, blocks: [
        { type: "heading", level: 1, text: "A" },
        { type: "paragraph", html: "<p>b</p>" },
        { type: "pageBreak" },
      ] }],
      versions: [],
    };
    const mark: DocBlock = { type: "heading", level: 2, text: "MARK" };
    const out = applyDocMutation(start, { kind: "ops", id: 1, ops: [{ op: "insert", index: 2, block: mark }] }, ctx());
    expect(out.documents[0].blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "heading", "pageBreak"]);
    expect(out.documents[0].blocks[2]).toEqual(mark);
  });

  it("deletes at a NON-ZERO index rather than at the front", () => {
    const start: DocState = {
      documents: [{ ...DOC, blocks: [
        { type: "heading", level: 1, text: "A" },
        { type: "paragraph", html: "<p>b</p>" },
        { type: "pageBreak" },
      ] }],
      versions: [],
    };
    const out = applyDocMutation(start, { kind: "ops", id: 1, ops: [{ op: "delete", index: 1 }] }, ctx());
    expect(out.documents[0].blocks.map((b) => b.type)).toEqual(["heading", "pageBreak"]);
    expect(out.documents[0].blocks[0]).toEqual({ type: "heading", level: 1, text: "A" });
  });

  it("rejects an out-of-range index and reports it", () => {
    const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op: "replace", index: 9, block: { type: "pageBreak" } }] }, ctx());
    expect(out.rejected).toHaveLength(1);
    expect(out.changed).toBe(false);
    expect(out.documents).toEqual(state().documents);
  });

  // ★ THE GUARD THAT MATTERS. Seeded with REAL prior blocks, so a
  // preserve-vs-erase bug cannot pass.
  it("leaves stored blocks untouched when every op is rejected", () => {
    const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op: "delete", index: 42 }, { op: "replace", index: 7, block: { type: "pageBreak" } }] }, ctx());
    expect(out.documents[0].blocks).toEqual(DOC.blocks);
    expect(out.versions).toEqual([]);
  });

  it("replaceAll swaps the whole array and snapshots the prior one", () => {
    const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op: "replaceAll", blocks: [{ type: "pageBreak" }] }] }, ctx());
    expect(out.documents[0].blocks).toEqual([{ type: "pageBreak" }]);
    expect(out.versions[0].blocks).toEqual(DOC.blocks);
  });
});

describe("applyDocMutation — restore", () => {
  it("restores a live document IN PLACE", () => {
    const renamed = applyDocMutation(state(), { kind: "rename", id: 1, title: "Renamed" }, ctx());
    const restored = applyDocMutation(renamed, { kind: "restore", versionId: renamed.versions[0].id }, ctx());
    expect(restored.documents[0].id).toBe(1);
    expect(restored.documents[0].title).toBe("Status report");
    // Restoring is itself revertible: it snapshots what it replaced.
    expect(restored.versions.some((v) => v.title === "Renamed")).toBe(true);
  });

  it("restores a DELETED document under a NEW id", () => {
    const deleted = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    const restored = applyDocMutation(deleted, { kind: "restore", versionId: deleted.versions[0].id }, ctx());
    expect(restored.documents).toHaveLength(1);
    expect(restored.documents[0].id).not.toBe(1);
    expect(restored.documents[0].blocks).toEqual(DOC.blocks);
  });

  it("does not consume the version it restored", () => {
    const deleted = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    const vid = deleted.versions[0].id;
    const restored = applyDocMutation(deleted, { kind: "restore", versionId: vid }, ctx());
    expect(restored.versions.some((v) => v.id === vid)).toBe(true);
  });

  it("a restore of an unknown version id is a no-op", () => {
    const s = state();
    const out = applyDocMutation(s, { kind: "restore", versionId: 999999 }, ctx());
    expect(out.documents).toBe(s.documents);
    expect(out.versions).toBe(s.versions);
    expect(out.changed).toBe(false);
    expect(out.rejected).toHaveLength(1);
  });
});

describe("applyDocMutation — duplicate", () => {
  it("copies with a NEW id and the given title, and snapshots the SOURCE state against the copy", () => {
    const out = applyDocMutation(state(), { kind: "duplicate", id: 1, title: "Copy of Status report" }, ctx());
    expect(out.documents).toHaveLength(2);
    const copy = out.documents.find((d) => d.id !== 1);
    expect(copy).toBeDefined();
    expect(copy?.title).toBe("Copy of Status report");
    expect(copy?.blocks).toEqual(DOC.blocks);
    // Original is untouched.
    expect(out.documents.find((d) => d.id === 1)).toEqual(DOC);
    // The version is written AGAINST THE COPY, not the source, and holds the
    // source's title — reverting it undoes just the copy's given title.
    expect(out.versions).toHaveLength(1);
    expect(out.versions[0].documentId).toBe(copy?.id);
    expect(out.versions[0].title).toBe("Status report");
    expect(out.versions[0].op).toBe("duplicate");
  });

  it("a duplicate of an unknown document id is a no-op", () => {
    const s = state();
    const out = applyDocMutation(s, { kind: "duplicate", id: 999, title: "x" }, ctx());
    expect(out.documents).toBe(s.documents);
    expect(out.changed).toBe(false);
  });

  it("rejects a whitespace-only duplicate title without minting anything", () => {
    const s = state();
    const out = applyDocMutation(s, { kind: "duplicate", id: 1, title: "   " }, ctx());
    expect(out.documents).toBe(s.documents);
    expect(out.changed).toBe(false);
    expect(out.rejected).toEqual(["title must not be empty"]);
  });
});

describe("applyDocMutation — title normalization", () => {
  it("rejects a whitespace-only create title", () => {
    const s = state();
    const out = applyDocMutation(s, { kind: "create", title: "   " }, ctx());
    expect(out.documents).toBe(s.documents);
    expect(out.changed).toBe(false);
    expect(out.rejected).toEqual(["title must not be empty"]);
  });

  it("rejects a whitespace-only rename title", () => {
    const s = state();
    const out = applyDocMutation(s, { kind: "rename", id: 1, title: "\t \n" }, ctx());
    expect(out.documents).toBe(s.documents);
    expect(out.changed).toBe(false);
    expect(out.rejected).toEqual(["title must not be empty"]);
  });

  it("caps a title at MAX_TITLE_CHARS, matching document-model.ts's sanitizer", () => {
    const long = "x".repeat(250);
    const out = applyDocMutation(state(), { kind: "create", title: long }, ctx());
    const created = out.documents.find((d) => d.id !== 1);
    expect(created?.title).toHaveLength(200);
  });

  it("trims a title the same way the sanitizer would, so create cannot disagree with reload", () => {
    const out = applyDocMutation(state(), { kind: "create", title: "  Padded  " }, ctx());
    const created = out.documents.find((d) => d.id !== 1);
    expect(created?.title).toBe("Padded");
  });

  it("renaming to the SAME effective title (after cap/trim) is a no-op", () => {
    const s = state();
    const out = applyDocMutation(s, { kind: "rename", id: 1, title: "  Status report  " }, ctx());
    expect(out.documents).toBe(s.documents);
    expect(out.versions).toBe(s.versions);
    expect(out.changed).toBe(false);
  });
});

describe("applyDocMutation — ops edge cases", () => {
  it("an ops mutation against an unknown document id is a no-op", () => {
    const s = state();
    const out = applyDocMutation(s, { kind: "ops", id: 999, ops: [{ op: "append", block: { type: "pageBreak" } }] }, ctx());
    expect(out.documents).toBe(s.documents);
    expect(out.changed).toBe(false);
    expect(out.rejected).toEqual(["document #999 not found"]);
  });

  it("a title-only ops call (no block ops) still counts as a change", () => {
    const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [], title: "Retitled" }, ctx());
    expect(out.changed).toBe(true);
    expect(out.documents[0].title).toBe("Retitled");
    expect(out.documents[0].blocks).toEqual(DOC.blocks);
    expect(out.versions[0].op).toBe("update");
  });

  it("rejects a whitespace-only ops title but still applies valid block ops", () => {
    const out = applyDocMutation(state(), {
      kind: "ops", id: 1, ops: [{ op: "append", block: { type: "pageBreak" } }], title: "   ",
    }, ctx());
    expect(out.changed).toBe(true);
    expect(out.documents[0].title).toBe(DOC.title);
    expect(out.rejected).toEqual(["title must not be empty"]);
  });

  it("an ops title identical to the current one does not count as a change on its own", () => {
    const s = state();
    const out = applyDocMutation(s, { kind: "ops", id: 1, ops: [], title: "Status report" }, ctx());
    expect(out.documents).toBe(s.documents);
    expect(out.changed).toBe(false);
  });

  it("rejects an out-of-range insert index", () => {
    const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op: "insert", index: 99, block: { type: "pageBreak" } }] }, ctx());
    expect(out.changed).toBe(false);
    expect(out.rejected).toEqual(["op 0: insert index 99 out of range 0..2"]);
  });
});

describe("restoring a deleted document closes its tombstone", () => {
  it("writes a restored marker against the OLD id", () => {
    const deleted = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    const restored = applyDocMutation(deleted, { kind: "restore", versionId: deleted.versions[0].id }, ctx());
    const marker = restored.versions.find((v) => v.op === "restored");
    expect(marker).toBeDefined();
    expect(marker!.documentId).toBe(1);
    expect(restored.documents[0].id).not.toBe(1);
  });

  // ★★★ THE POINT OF THE MARKER — AND ONLY THIS POINT. Without it the old id
  // is absent from `documents` forever, so the deleted-documents list shows a
  // phantom entry for a document the user has already restored.
  //
  // ★★★ AN EARLIER VERSION OF THIS COMMENT ALSO CLAIMED THE MARKER STOPPED
  // "each further Restore minting another copy". IT DOES NOT, AND THAT
  // SENTENCE WAS THE DANGEROUS HALF: the marker hides the ROW, it does nothing
  // to the OPERATION. Measured against the code as it stood: restoring the same
  // tombstone versionId four times produced four identical documents,
  // `changed:true` and `rejected:[]` every time. What actually makes restore
  // idempotent is the pair of engine guards pinned in "restore is idempotent"
  // below, added later. Anyone building a surface on top of these version rows
  // would reasonably have trusted the old wording and shipped the duplicate.
  it("no longer reports the document as deleted", () => {
    const deleted = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    expect(deletedDocumentVersions(deleted.versions, deleted.documents)).toHaveLength(1);

    const restored = applyDocMutation(deleted, { kind: "restore", versionId: deleted.versions[0].id }, ctx());
    expect(deletedDocumentVersions(restored.versions, restored.documents)).toEqual([]);
  });

  it("reports it again if the recreated document is itself deleted", () => {
    const deleted = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    const restored = applyDocMutation(deleted, { kind: "restore", versionId: deleted.versions[0].id }, ctx());
    const again = applyDocMutation(restored, { kind: "delete", id: restored.documents[0].id }, ctx());
    expect(deletedDocumentVersions(again.versions, again.documents).map((v) => v.documentId)).toEqual([
      restored.documents[0].id,
    ]);
  });

  it("still does not consume the version it restored", () => {
    const deleted = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    const versionId = deleted.versions[0].id;
    const restored = applyDocMutation(deleted, { kind: "restore", versionId }, ctx());
    expect(restored.versions.some((v) => v.id === versionId)).toBe(true);
  });
});

// ★★★ EVERY FIX BELOW SAT IN A REGION THAT HAD NO TEST. That is the pattern,
// not a coincidence: each one was a silent success — a wipe, a cap bypass, an
// ignored op, a duplicate mint — and a silent success is precisely what an
// untested branch looks like from the outside.
describe("applyOps — an omitted field is not an empty one", () => {
  // ★★★ MEASURED THROUGH THE REAL AI CHAIN, and the engine ALONE does not
  // reproduce it: reaching applyOps directly, `{op:"replaceAll"}` with no
  // `blocks` threw `TypeError: op.blocks is not iterable`. The silent WIPE
  // needed use-document-tools' per-op `sanitizeAiDocBlocks(op.blocks)` in
  // front of it, which turns the missing field into `[]`. Two doors, one
  // defect — chat-tools-documents.test.ts guards the model's, this one guards
  // every other caller's.
  it("refuses a replaceAll whose blocks field is missing, rather than wiping", () => {
    const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op: "replaceAll" } as never] }, ctx());
    expect(out.changed).toBe(false);
    expect(out.documents[0].blocks).toEqual(DOC.blocks);
    expect(out.rejected).toEqual(["op 0: replaceAll requires a blocks array"]);
  });

  it("refuses a replaceAll whose blocks field is null", () => {
    const out = applyDocMutation(
      state(),
      { kind: "ops", id: 1, ops: [{ op: "replaceAll", blocks: null } as never] },
      ctx(),
    );
    expect(out.changed).toBe(false);
    expect(out.rejected).toEqual(["op 0: replaceAll requires a blocks array"]);
  });

  // ★★★ THE CONTROL, and it is what keeps the guard honest. An explicit
  // `replaceAll: []` is a REAL request — "clear this document" — and the
  // before-image preserves what it replaced, so it is recoverable. A guard
  // written as a truthiness check would reject this too, breaking a legitimate
  // operation while every case above still passed.
  it("still applies an EXPLICIT empty replaceAll, and snapshots what it cleared", () => {
    const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op: "replaceAll", blocks: [] }] }, ctx());
    expect(out.changed).toBe(true);
    expect(out.documents[0].blocks).toEqual([]);
    expect(out.versions[0].blocks).toEqual(DOC.blocks);
  });

  // ★★ WORSE THAN A THROW, because it succeeded: it pushed a literal
  // `undefined` into the block array and reported `changed:true`, so the
  // document carried a hole that serialises as `null` and that `sanitizeBlock`
  // silently drops on the next load. The block count the user saw was never
  // the count they kept.
  it.each(["append", "insert", "replace"] as const)(
    "refuses a %s with no block rather than storing a hole",
    (op) => {
      const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op, index: 0 } as never] }, ctx());
      expect(out.changed).toBe(false);
      expect(out.documents[0].blocks).toEqual(DOC.blocks);
      expect(out.rejected).toEqual([`op 0: ${op} requires a block`]);
    },
  );

  // ★★ An off-enum op fell straight through the switch: not applied, and —
  // nothing having been pushed — not reported either. `changed:false,
  // rejected:[]` is "I did nothing and have nothing to say about it", which
  // the tool layer cannot turn into anything the model can act on.
  it("reports an unknown op instead of ignoring it in silence", () => {
    const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op: "teleport" } as never] }, ctx());
    expect(out.changed).toBe(false);
    expect(out.rejected).toEqual(['op 0: unknown op "teleport"']);
  });

  it("keeps applying the GOOD ops beside a refused one", () => {
    // ★ Partial application is the existing contract (a bad index already
    // behaves this way) and runDocumentTool depends on it. Without this, a fix
    // that refused the whole batch on one malformed op would pass everything
    // above.
    const out = applyDocMutation(
      state(),
      { kind: "ops", id: 1, ops: [{ op: "append" } as never, { op: "append", block: { type: "pageBreak" } }] },
      ctx(),
    );
    expect(out.changed).toBe(true);
    expect(out.documents[0].blocks).toHaveLength(DOC.blocks.length + 1);
    expect(out.rejected).toEqual(["op 0: append requires a block"]);
  });
});

describe("applyDocMutation — the count caps are enforced HERE, not only on reload", () => {
  const many = (n: number): ProjectDocument[] =>
    Array.from({ length: n }, (_, i) => ({ ...DOC, id: i + 1, title: `Doc ${i + 1}` }));
  const blocks = (n: number) => Array.from({ length: n }, () => ({ type: "pageBreak" as const }));

  // ★★★ THE POINT: sanitizeProjectDocuments `break`s at MAX_DOCUMENTS, so the
  // documents it drops are the LAST in the array — the ones just created. The
  // engine allowed 205, the reload kept 200, and nothing errored in between.
  // Create a document, see it, reload, it is gone.
  it("refuses a create past MAX_DOCUMENTS with a reason", () => {
    const out = applyDocMutation(
      { documents: many(MAX_DOCUMENTS), versions: [] },
      { kind: "create", title: "One more" },
      ctx(),
    );
    expect(out.changed).toBe(false);
    expect(out.rejected).toEqual([`document limit reached (${MAX_DOCUMENTS})`]);
  });

  it("refuses a duplicate past MAX_DOCUMENTS", () => {
    const out = applyDocMutation(
      { documents: many(MAX_DOCUMENTS), versions: [] },
      { kind: "duplicate", id: 1, title: "Copy" },
      ctx(),
    );
    expect(out.changed).toBe(false);
    expect(out.rejected).toEqual([`document limit reached (${MAX_DOCUMENTS})`]);
  });

  it("still allows a create one BELOW the cap", () => {
    // ★ The control. An off-by-one refusing at 199 would satisfy both cases
    // above while making the last slot permanently unreachable.
    const out = applyDocMutation(
      { documents: many(MAX_DOCUMENTS - 1), versions: [] },
      { kind: "create", title: "Fits" },
      ctx(),
    );
    expect(out.changed).toBe(true);
    expect(out.documents).toHaveLength(MAX_DOCUMENTS);
  });

  it("refuses a create whose blocks exceed MAX_BLOCKS_PER_DOC", () => {
    const out = applyDocMutation(
      { documents: [], versions: [] },
      { kind: "create", title: "Big", blocks: blocks(MAX_BLOCKS_PER_DOC + 1) },
      ctx(),
    );
    expect(out.changed).toBe(false);
    expect(out.rejected).toEqual([`block limit exceeded (${MAX_BLOCKS_PER_DOC + 1} > ${MAX_BLOCKS_PER_DOC})`]);
  });

  // ★★ THE PER-CALL CAP IN sanitizeAiDocBlocks CANNOT SEE THIS. It bounds ONE
  // call's blocks, so repeated appends walked straight past the limit —
  // measured at 600 from six 100-block calls. The cap has to be tested against
  // the RESULT, which is what this pins.
  it("refuses ops that would grow a document past MAX_BLOCKS_PER_DOC", () => {
    const start: DocState = { documents: [{ ...DOC, blocks: blocks(MAX_BLOCKS_PER_DOC) }], versions: [] };
    const out = applyDocMutation(start, { kind: "ops", id: 1, ops: [{ op: "append", block: { type: "pageBreak" } }] }, ctx());
    expect(out.changed).toBe(false);
    expect(out.documents[0].blocks).toHaveLength(MAX_BLOCKS_PER_DOC);
    expect(out.rejected).toEqual([`block limit exceeded (${MAX_BLOCKS_PER_DOC + 1} > ${MAX_BLOCKS_PER_DOC})`]);
  });

  // ★★★ THE TRAP THIS AVOIDS. A document already over the cap — loaded from a
  // file that carried more — must still be shrinkable. A guard written as a
  // plain "result > cap" would refuse the very `delete` that brings it back
  // under, turning the cap into a state with no way out.
  it("still lets an ALREADY over-cap document shrink", () => {
    const start: DocState = { documents: [{ ...DOC, blocks: blocks(MAX_BLOCKS_PER_DOC + 100) }], versions: [] };
    const out = applyDocMutation(start, { kind: "ops", id: 1, ops: [{ op: "delete", index: 0 }] }, ctx());
    expect(out.changed).toBe(true);
    expect(out.documents[0].blocks).toHaveLength(MAX_BLOCKS_PER_DOC + 99);
    expect(out.rejected).toEqual([]);
  });

  // ★ Refusing the BLOCK half must not refuse a supplied title — the same
  // partial-application shape runDocumentTool's "rename plus one bad op is not
  // a refusal" clause depends on.
  it("lets a rename land even when the block half is over-cap", () => {
    const start: DocState = { documents: [{ ...DOC, blocks: blocks(MAX_BLOCKS_PER_DOC) }], versions: [] };
    const out = applyDocMutation(
      start,
      { kind: "ops", id: 1, ops: [{ op: "append", block: { type: "pageBreak" } }], title: "Renamed anyway" },
      ctx(),
    );
    expect(out.changed).toBe(true);
    expect(out.documents[0].title).toBe("Renamed anyway");
    expect(out.documents[0].blocks).toHaveLength(MAX_BLOCKS_PER_DOC);
    expect(out.rejected).toHaveLength(1);
  });

  it("refuses a create whose blocks are a non-array, but allows the field to be omitted", () => {
    const bad = applyDocMutation(
      { documents: [], versions: [] },
      { kind: "create", title: "X", blocks: "nope" as never },
      ctx(),
    );
    expect(bad.changed).toBe(false);
    expect(bad.rejected).toEqual(["blocks must be an array"]);
    // ★ The control: `undefined` is the ONE legal non-array and means "no
    // blocks" — the field is optional and most creates omit it.
    const ok = applyDocMutation({ documents: [], versions: [] }, { kind: "create", title: "Y" }, ctx());
    expect(ok.changed).toBe(true);
    expect(ok.documents[0].blocks).toEqual([]);
  });
});

describe("restore is idempotent", () => {
  const deletedState = () => {
    const deleted = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    return { deleted, tombstoneId: deleted.versions[0].id };
  };

  // ★★★ THE MARKER FIXED THE LIST, NOT THE OPERATION — and the older comment
  // in this file reads as though it fixed both ("each further Restore mints
  // another copy" sounds like something the marker prevents; it does not).
  // Measured before this guard: restoring the same tombstone id four times
  // produced four identical documents, `changed:true` and `rejected:[]` every
  // time. Nothing offered it only because `deletedDocumentVersions` filters
  // markers out — safety rested entirely on a derived VIEW.
  it("refuses a second restore of the same tombstone", () => {
    const { deleted, tombstoneId } = deletedState();
    const first = applyDocMutation(deleted, { kind: "restore", versionId: tombstoneId }, ctx());
    expect(first.changed).toBe(true);
    expect(first.documents).toHaveLength(1);

    const second = applyDocMutation(first, { kind: "restore", versionId: tombstoneId }, ctx());
    expect(second.changed).toBe(false);
    expect(second.documents).toHaveLength(1);
    expect(second.rejected).toEqual(["document #1 has already been restored"]);
  });

  // ★★ A MARKER IS NOT A SNAPSHOT — it is the one op that is explicitly not a
  // before-image. Restoring one measured as a second copy of the document AND
  // a second marker. This is a SEPARATE guard from the one above, not a
  // duplicate of it: re-delete the recreated document and the group is
  // legitimately "still deleted" again, so the idempotence check passes and
  // only this one stands between an old marker and another duplicate.
  it("refuses to restore a restore-marker", () => {
    const { deleted, tombstoneId } = deletedState();
    const restored = applyDocMutation(deleted, { kind: "restore", versionId: tombstoneId }, ctx());
    const marker = restored.versions.find((v) => v.op === "restored");
    expect(marker).toBeDefined();

    const out = applyDocMutation(restored, { kind: "restore", versionId: marker!.id }, ctx());
    expect(out.changed).toBe(false);
    expect(out.documents).toHaveLength(1);
    expect(out.rejected).toEqual([`version #${marker!.id} is a restore marker, not a snapshot`]);
  });

  // ★★★ THE CONTROLS. Both guards refuse; a "fix" that refused restore
  // outright would satisfy every assertion above and silently delete the
  // feature.
  it("still restores a document deleted a SECOND time", () => {
    const { deleted, tombstoneId } = deletedState();
    const restored = applyDocMutation(deleted, { kind: "restore", versionId: tombstoneId }, ctx());
    const again = applyDocMutation(restored, { kind: "delete", id: restored.documents[0].id }, ctx());
    const newTombstone = again.versions.find(
      (v) => v.op === "delete" && v.documentId === restored.documents[0].id,
    );
    expect(newTombstone).toBeDefined();

    const out = applyDocMutation(again, { kind: "restore", versionId: newTombstone!.id }, ctx());
    expect(out.changed).toBe(true);
    expect(out.documents).toHaveLength(1);
  });

  it("still restores a LIVE document in place", () => {
    const renamed = applyDocMutation(state(), { kind: "rename", id: 1, title: "Renamed" }, ctx());
    const out = applyDocMutation(renamed, { kind: "restore", versionId: renamed.versions[0].id }, ctx());
    expect(out.changed).toBe(true);
    expect(out.documents[0].title).toBe("Status report");
  });
});

describe("title uniqueness is enforced by the ENGINE, not by one surface", () => {
  // ★★★ WCAG 2.4.6. `documents-list.tsx` names every per-row control
  // `<verb> – <title>` and the row-title button IS the title, so two equal
  // titles are five pairs of identical accessible names. The axe gate cannot
  // see it — it scans a statically seeded app and never clicks anything.
  it("suffixes a create that would collide with an existing title", () => {
    const out = applyDocMutation(state(), { kind: "create", title: "Status report" }, ctx());
    expect(out.documents.map((d) => d.title)).toEqual(["Status report", "Status report 2"]);
  });

  it("suffixes a duplicate rather than letting the copy inherit the exact title", () => {
    const out = applyDocMutation(state(), { kind: "duplicate", id: 1, title: "Status report" }, ctx());
    expect(out.documents[1].title).toBe("Status report 2");
    expect(out.documents[1].blocks).toEqual(DOC.blocks); // still a real copy
  });

  // ★★★ THE RESTORE CASE, which no surface guarded. It recreates a deleted
  // document with the STORED title verbatim, so restoring collides whenever the
  // user has since created a replacement under the same name — and repeated
  // restores used to produce N documents all sharing one title.
  it("suffixes a restore whose stored title is live again", () => {
    const deleted = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    const replaced = applyDocMutation(deleted, { kind: "create", title: "Status report" }, ctx());
    const out = applyDocMutation(replaced, { kind: "restore", versionId: deleted.versions[0].id }, ctx());
    expect(out.changed).toBe(true);
    expect(out.documents.map((d) => d.title)).toEqual(["Status report", "Status report 2"]);
  });

  // ★★★ THE OTHER RESTORE PATH, and it stayed verbatim for a release after the
  // recreate half was fixed — "one door of two" again. Measured before the fix:
  // rename "Charter"→"Charter v2", create a replacement "Charter", restore the
  // rename IN PLACE, and the set came back `["Charter","Charter"]` with
  // `changed:true, rejected:[]`. Two live documents sharing a title is five
  // pairs of identical per-row accessible names (WCAG 2.4.6), and the axe gate
  // structurally cannot see it — it never clicks Restore.
  it("suffixes an IN-PLACE restore whose stored title is live on another document", () => {
    const renamed = applyDocMutation(state(), { kind: "rename", id: 1, title: "Status report v2" }, ctx());
    const replaced = applyDocMutation(renamed, { kind: "create", title: "Status report" }, ctx());
    const out = applyDocMutation(replaced, { kind: "restore", versionId: renamed.versions[0].id }, ctx());
    expect(out.changed).toBe(true);
    // Document 1 is restored in place — same id, suffixed title.
    expect(out.documents.find((d) => d.id === 1)?.title).toBe("Status report 2");
    expect(out.documents.map((d) => d.title)).toEqual(["Status report 2", "Status report"]);
  });

  // ★★★ THE SELF-EXCLUSION, and it is NOT a nicety. Most versions differ from
  // the live document only in BLOCKS, so the ordinary restore restores a title
  // the document already holds. Checked against the unfiltered set it collides
  // with its own row, and a restore that changed no title at all renames the
  // document to "Status report 2" — a corruption introduced by the fix above
  // rather than by the bug it closes. Deliberately seeded with a SECOND
  // document so an implementation that simply skipped uniquification on the
  // in-place path cannot pass this and the collision case together.
  it("does NOT suffix an in-place restore against the document's OWN title", () => {
    const seeded: DocState = { documents: [DOC, { ...DOC, id: 2, title: "Other" }], versions: [] };
    // A blocks-only edit: the title is untouched, so the before-image carries
    // the document's current title.
    const edited = applyDocMutation(seeded, { kind: "ops", id: 1, ops: [{ op: "append", block: { type: "pageBreak" } }] }, ctx());
    expect(edited.versions[0].title).toBe("Status report");

    const out = applyDocMutation(edited, { kind: "restore", versionId: edited.versions[0].id }, ctx());
    expect(out.changed).toBe(true);
    expect(out.documents.find((d) => d.id === 1)?.title).toBe("Status report");
    expect(out.documents.find((d) => d.id === 1)?.blocks).toEqual(DOC.blocks);
  });

  it("leaves a title that does not collide completely alone", () => {
    // ★ The control. A minter that always appended " 2" would satisfy every
    // case above while renaming innocent titles on every write.
    const out = applyDocMutation(state(), { kind: "create", title: "Something else" }, ctx());
    expect(out.documents[1].title).toBe("Something else");
  });

  // ★★★ THE SEAM WITH THE PANE. documents-panel.tsx already uniquifies against
  // its own `freshRef` view and passes the RESULT in, so the engine sees an
  // already-suffixed title and must not suffix it again. Idempotence is what
  // makes the two safe to compose — without it the pane's "Status report 2"
  // would come back as "Status report 2 2" on every create into a populated
  // pane, which is the normal path, not an edge case.
  it("is IDEMPOTENT — an already-unique title passes through unchanged", () => {
    const first = applyDocMutation(state(), { kind: "create", title: "Status report" }, ctx());
    expect(first.documents[1].title).toBe("Status report 2");
    // Exactly what the pane would compute and hand over next.
    const second = applyDocMutation(first, { kind: "create", title: "Status report 3" }, ctx());
    expect(second.documents[2].title).toBe("Status report 3");
  });

  it("suffixes again ONLY when the passed title is genuinely taken", () => {
    // ★ The other half of the seam: when the engine's set is fresher than the
    // pane's, the pane's answer really is stale and a second suffix is correct.
    // Ugly ("… 2 2") and deliberately so — it is a real collision, not a
    // double-application.
    const first = applyDocMutation(state(), { kind: "create", title: "Status report" }, ctx());
    const out = applyDocMutation(first, { kind: "create", title: "Status report 2" }, ctx());
    expect(out.documents[2].title).toBe("Status report 2 2");
  });

  it("walks past every taken suffix, not just the first", () => {
    const seeded: DocState = {
      documents: [DOC, { ...DOC, id: 2, title: "Status report 2" }, { ...DOC, id: 3, title: "Status report 3" }],
      versions: [],
    };
    const out = applyDocMutation(seeded, { kind: "create", title: "Status report" }, ctx());
    expect(out.documents[3].title).toBe("Status report 4");
  });

  it("does NOT touch a rename or an ops title", () => {
    // ★★ DELIBERATE EXCLUSION, pinned so it cannot be "fixed" by accident.
    // Those titles are what a user or model typed FOR THIS DOCUMENT; silently
    // returning something else is worse than the collision, and it would make a
    // rename non-idempotent against itself.
    const seeded: DocState = { documents: [DOC, { ...DOC, id: 2, title: "Other" }], versions: [] };
    const renamed = applyDocMutation(seeded, { kind: "rename", id: 2, title: "Status report" }, ctx());
    expect(renamed.documents[1].title).toBe("Status report");
    const viaOps = applyDocMutation(seeded, { kind: "ops", id: 2, ops: [], title: "Status report" }, ctx());
    expect(viaOps.documents[1].title).toBe("Status report");
  });
});

describe("blocks arrays are not shared between owners", () => {
  // ★★ The module's contract is immutable rearrangement, and it held only
  // SHALLOWLY: measured, a duplicate left `copy.blocks === source.blocks ===
  // version.blocks` — one array with three owners. Nothing mutates blocks in
  // place today, so this was structural risk rather than a live bug, but
  // `toEqual` cannot see aliasing, so a single in-place push added later would
  // rewrite a document AND its own history with no test able to notice.
  it("gives a duplicate its own array, distinct from the source and the version", () => {
    const out = applyDocMutation(state(), { kind: "duplicate", id: 1, title: "Copy" }, ctx());
    const source = out.documents[0];
    const copy = out.documents[1];
    expect(copy.blocks).not.toBe(source.blocks);
    expect(out.versions[0].blocks).not.toBe(source.blocks);
    expect(out.versions[0].blocks).not.toBe(copy.blocks);
    expect(copy.blocks).toEqual(source.blocks); // still equal, just not the same object
  });

  // ★★ `create` WAS THE LAST OWNER-SHARING HOLE. duplicate, both restores and
  // every snapshot copy their input; create stored `m.blocks` verbatim, so the
  // caller kept a live handle on a stored document's block list and one later
  // in-place push would rewrite the workspace from outside the engine. Assert
  // the EFFECT of the copy (a caller-side mutation does not reach the store),
  // not just `not.toBe` — reference inequality alone would also be satisfied by
  // a rebuild that shared the elements' owner semantics for the wrong reason.
  it("gives a create its own array, so the caller cannot mutate the stored document", () => {
    const callerBlocks: DocBlock[] = [{ type: "pageBreak" }];
    const out = applyDocMutation({ documents: [], versions: [] }, { kind: "create", title: "New", blocks: callerBlocks }, ctx());
    expect(out.documents[0].blocks).not.toBe(callerBlocks);
    callerBlocks.push({ type: "heading", level: 1, text: "added after the create" });
    expect(out.documents[0].blocks).toEqual([{ type: "pageBreak" }]);
  });

  it("gives every before-image snapshot its own array", () => {
    const out = applyDocMutation(state(), { kind: "rename", id: 1, title: "Renamed" }, ctx());
    expect(out.versions[0].blocks).not.toBe(DOC.blocks);
    expect(out.versions[0].blocks).toEqual(DOC.blocks);
  });

  it("gives a restored document its own array", () => {
    const deleted = applyDocMutation(state(), { kind: "delete", id: 1 }, ctx());
    const out = applyDocMutation(deleted, { kind: "restore", versionId: deleted.versions[0].id }, ctx());
    expect(out.documents[0].blocks).not.toBe(deleted.versions[0].blocks);
    expect(out.documents[0].blocks).toEqual(DOC.blocks);
  });
});

describe("the block cap reaches BOTH restore paths", () => {
  const blocks = (n: number) => Array.from({ length: n }, () => ({ type: "pageBreak" as const }));
  const over = blocks(MAX_BLOCKS_PER_DOC + 10);
  const version = (over1: Partial<DocState["versions"][number]> = {}) => ({
    id: 5,
    documentId: 1,
    title: "Fat",
    blocks: over,
    savedAt: "2026-08-01T09:00:00.000Z",
    source: "user" as const,
    op: "update" as const,
    ...over1,
  });

  // ★★★ THE THIRD "ONE DOOR OF TWO" IN THIS FILE. MAX_DOCUMENTS reached create,
  // duplicate AND restore-recreate; MAX_BLOCKS_PER_DOC reached create and ops
  // and stopped, so both restore paths wrote an uncapped document — measured at
  // 510 blocks with `changed:true, rejected:[]`. Latent, because every load
  // path caps blocks so no STORED version can exceed it today; live the moment
  // any path yields one.
  it("refuses a restore IN PLACE whose version exceeds the cap", () => {
    const start: DocState = { documents: [{ ...DOC, blocks: [] }], versions: [version()] };
    const out = applyDocMutation(start, { kind: "restore", versionId: 5 }, ctx());
    expect(out.changed).toBe(false);
    expect(out.documents[0].blocks).toEqual([]);
    expect(out.rejected).toEqual([`block limit exceeded (${MAX_BLOCKS_PER_DOC + 10} > ${MAX_BLOCKS_PER_DOC})`]);
  });

  it("refuses a restore that RECREATES a deleted document over the cap", () => {
    const start: DocState = { documents: [], versions: [version({ documentId: 77, op: "delete" })] };
    const out = applyDocMutation(start, { kind: "restore", versionId: 5 }, ctx());
    expect(out.changed).toBe(false);
    expect(out.documents).toEqual([]);
    expect(out.rejected).toEqual([`block limit exceeded (${MAX_BLOCKS_PER_DOC + 10} > ${MAX_BLOCKS_PER_DOC})`]);
  });

  it("still restores a version that fits, on both paths", () => {
    // ★★ THE CONTROL. Both guards refuse; a cap applied unconditionally would
    // satisfy the two cases above and break restore outright — which is the
    // recovery path, so breaking it silently is the worst outcome here.
    const fits = version({ blocks: blocks(3) });
    const inPlace = applyDocMutation(
      { documents: [{ ...DOC, blocks: [] }], versions: [fits] },
      { kind: "restore", versionId: 5 },
      ctx(),
    );
    expect(inPlace.changed).toBe(true);
    expect(inPlace.documents[0].blocks).toHaveLength(3);

    const recreated = applyDocMutation(
      { documents: [], versions: [version({ blocks: blocks(3), documentId: 77, op: "delete" })] },
      { kind: "restore", versionId: 5 },
      ctx(),
    );
    expect(recreated.changed).toBe(true);
    expect(recreated.documents[0].blocks).toHaveLength(3);
  });

  it("still lets an over-cap document be restored to something SMALLER", () => {
    // ★ The shrink escape applies here too: a live document already past the
    // cap must not be frozen out of a restore that improves it.
    const start: DocState = {
      documents: [{ ...DOC, blocks: blocks(MAX_BLOCKS_PER_DOC + 100) }],
      versions: [version({ blocks: blocks(MAX_BLOCKS_PER_DOC + 5) })],
    };
    const out = applyDocMutation(start, { kind: "restore", versionId: 5 }, ctx());
    expect(out.changed).toBe(true);
    expect(out.documents[0].blocks).toHaveLength(MAX_BLOCKS_PER_DOC + 5);
  });
});

describe("a block must be SHAPED like a block, not merely be an object", () => {
  // ★★★ `typeof x === "object"` IS NOT A BLOCK TEST. The first guard refused
  // `42`, `"str"` and `null` but ADMITTED `[]` and `{}` — both stored verbatim
  // and reported as success (measured), then dropped by `sanitizeBlock` on the
  // next load. Same silent-success class as the missing-field case, reached
  // with a differently-malformed value instead of an absent one.
  it.each([
    ["an empty array", []],
    ["an empty object", {}],
    ["an array of blocks", [{ type: "pageBreak" }]],
    ["an object with a non-string type", { type: 7 }],
  ])("refuses %s as a block", (_label, block) => {
    const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op: "append", block } as never] }, ctx());
    expect(out.changed).toBe(false);
    expect(out.documents[0].blocks).toEqual(DOC.blocks);
    expect(out.rejected).toEqual(["op 0: append requires a block"]);
  });

  it("still accepts every real block shape", () => {
    // ★★ THE CONTROL, and it must cover more than one block type: a guard that
    // hard-coded `type === "pageBreak"` would pass a single-shape control while
    // refusing most of the model's legitimate output. This deliberately does NOT
    // validate the type against the known set — that is sanitizeBlock's job, and
    // a second copy of the block registry here is one that can drift.
    for (const block of [
      { type: "pageBreak" },
      { type: "heading", level: 1, text: "H" },
      { type: "paragraph", html: "<p>x</p>" },
    ]) {
      const out = applyDocMutation(state(), { kind: "ops", id: 1, ops: [{ op: "append", block } as never] }, ctx());
      expect(out.changed).toBe(true);
      expect(out.documents[0].blocks.at(-1)).toEqual(block);
    }
  });
});

describe("link / unlink", () => {
  // ★★★ A REFERENCE IS NOT CONTENT — both cases write NO version and leave
  // `updatedAt` alone. `updatedAt` is displayed and is the default sort key,
  // so bumping it on an attach would report a content edit that never
  // happened.
  it("adds the reference, writes NO version and does NOT move updatedAt", () => {
    const out = applyDocMutation(state(), { kind: "link", id: 1, ref: { kind: "task", id: 7, label: "Kickoff" } }, ctx());
    expect(out.changed).toBe(true);
    expect(out.documents[0].linkedEntities).toEqual([{ kind: "task", id: 7, label: "Kickoff" }]);
    expect(out.versions).toHaveLength(0);
    expect(out.documents[0].updatedAt).toBe(DOC.updatedAt);
  });

  // ★ A no-op must return the caller's OWN array reference — the documents
  // slice is dirty-checked by REFERENCE equality, so a rebuilt-but-equal
  // array forces a needless save on every backend.
  it("is idempotent — linking the same (kind, id) again is not a change", () => {
    const once = applyDocMutation(state(), { kind: "link", id: 1, ref: { kind: "task", id: 7 } }, ctx());
    const twice = applyDocMutation(once, { kind: "link", id: 1, ref: { kind: "task", id: 7 } }, ctx());
    expect(twice.changed).toBe(false);
    expect(twice.documents).toBe(once.documents);
  });

  it("refuses past MAX_LINKS_PER_DOC with a reason", () => {
    const full: DocState = {
      documents: [{
        ...DOC,
        linkedEntities: Array.from({ length: MAX_LINKS_PER_DOC }, (_, i) => ({ kind: "task" as const, id: i + 1 })),
      }],
      versions: [],
    };
    const out = applyDocMutation(full, { kind: "link", id: 1, ref: { kind: "raid", id: 1 } }, ctx());
    expect(out.changed).toBe(false);
    expect(out.rejected[0]).toContain("link limit");
  });

  it("unlinks by (kind, id) and drops the field when the last one goes", () => {
    const linked = applyDocMutation(state(), { kind: "link", id: 1, ref: { kind: "task", id: 7 } }, ctx());
    const out = applyDocMutation(linked, { kind: "unlink", id: 1, ref: { kind: "task", id: 7 } }, ctx());
    expect(out.changed).toBe(true);
    expect("linkedEntities" in out.documents[0]).toBe(false);
    expect(out.versions).toHaveLength(0);
  });

  it("unlinking an absent reference is not a change", () => {
    const s = state();
    const out = applyDocMutation(s, { kind: "unlink", id: 1, ref: { kind: "task", id: 7 } }, ctx());
    expect(out.changed).toBe(false);
    expect(out.documents).toBe(s.documents);
  });

  it("rejects an unknown document id", () => {
    const out = applyDocMutation(state(), { kind: "link", id: 404, ref: { kind: "task", id: 7 } }, ctx());
    expect(out.rejected[0]).toContain("#404");
  });

  // ★★★ THE CROSS-KIND CONTROL — unlink-by-(kind,id) is otherwise unpinned
  // against an id-only implementation. An `unlink` filtering on `id` alone
  // would remove BOTH refs below and every case above would still pass.
  it("unlinking one kind at a shared id leaves the other kind's reference alone", () => {
    const withTask = applyDocMutation(state(), { kind: "link", id: 1, ref: { kind: "task", id: 7 } }, ctx());
    const withBoth = applyDocMutation(withTask, { kind: "link", id: 1, ref: { kind: "raid", id: 7 } }, ctx());
    const out = applyDocMutation(withBoth, { kind: "unlink", id: 1, ref: { kind: "raid", id: 7 } }, ctx());
    expect(out.changed).toBe(true);
    expect(out.documents[0].linkedEntities).toEqual([{ kind: "task", id: 7 }]);
  });
});
