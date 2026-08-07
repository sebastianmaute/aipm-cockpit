import { describe, it, expect } from "vitest";
import { applyDocMutation, type DocState } from "./document-mutations";
import { deletedDocumentVersions } from "./document-versions";
import type { ProjectDocument } from "./document-model";

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
