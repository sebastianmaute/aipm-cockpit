import { describe, it, expect } from "vitest";
import { applyDocMutation, type DocState } from "./document-mutations";
import { deletedDocumentVersions } from "./document-versions";
import { MAX_BLOCKS_PER_DOC, MAX_DOCUMENTS, type ProjectDocument } from "./document-model";

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

  // ★★★ THE POINT OF THE MARKER. Without it the old id is absent from
  // `documents` forever, so the deleted-documents list shows a phantom entry
  // for a document the user has already restored — and each further Restore
  // mints another copy.
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
