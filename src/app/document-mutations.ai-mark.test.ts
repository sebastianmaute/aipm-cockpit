import { describe, it, expect } from "vitest";
import { applyDocMutation, type DocMutation, type DocState } from "./document-mutations";
import type { DocVersion, DocVersionSource } from "./document-versions";
import type { ProjectDocument } from "./document-model";

const PLAIN: ProjectDocument = {
  id: 1,
  title: "Status report",
  blocks: [{ type: "paragraph", html: "<p>on track</p>" }],
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-01T08:00:00.000Z",
};
const MARKED: ProjectDocument = { ...PLAIN, aiGenerated: true };

let nextDoc = 100;
let nextVer = 200;
const ctx = (source: DocVersionSource) => ({
  now: "2026-08-06T09:00:00.000Z",
  source,
  mintDocId: () => nextDoc++,
  mintVersionId: () => nextVer++,
});
const st = (doc: ProjectDocument, versions: readonly DocVersion[] = []): DocState => ({ documents: [doc], versions });
const OPS: DocMutation = { kind: "ops", id: 1, ops: [{ op: "append", block: { type: "paragraph", html: "<p>x</p>" } }] };
const marked = (d: ProjectDocument | undefined) => d?.aiGenerated === true;

describe("AI mark — the one rule", () => {
  it("an AI create is marked", () => {
    const r = applyDocMutation({ documents: [], versions: [] }, { kind: "create", title: "New" }, ctx("ai"));
    expect(marked(r.documents[0])).toBe(true);
  });
  it("a person's create is not marked", () => {
    const r = applyDocMutation({ documents: [], versions: [] }, { kind: "create", title: "New" }, ctx("user"));
    expect(marked(r.documents[0])).toBe(false);
  });
  it("AI ops mark the document", () => {
    const r = applyDocMutation(st(PLAIN), OPS, ctx("ai"));
    expect(r.changed).toBe(true);
    expect(marked(r.documents[0])).toBe(true);
  });
  it("AI rename marks the document", () => {
    const r = applyDocMutation(st(PLAIN), { kind: "rename", id: 1, title: "Other" }, ctx("ai"));
    expect(marked(r.documents[0])).toBe(true);
  });
  it("an AI duplicate of an unmarked document is marked", () => {
    const r = applyDocMutation(st(PLAIN), { kind: "duplicate", id: 1, title: "Copy" }, ctx("ai"));
    expect(marked(r.documents[1])).toBe(true);
    expect(marked(r.documents[0])).toBe(false);
  });
  it("a person's duplicate of a marked document is marked", () => {
    const r = applyDocMutation(st(MARKED), { kind: "duplicate", id: 1, title: "Copy" }, ctx("user"));
    expect(marked(r.documents[1])).toBe(true);
  });
  it("AI link and unlink never mark", () => {
    const ref = { kind: "task", id: 5 } as never;
    const linked = applyDocMutation(st(PLAIN), { kind: "link", id: 1, ref }, ctx("ai"));
    expect(linked.changed).toBe(true);
    expect(marked(linked.documents[0])).toBe(false);
    const unlinked = applyDocMutation({ documents: linked.documents, versions: [] }, { kind: "unlink", id: 1, ref }, ctx("ai"));
    expect(unlinked.changed).toBe(true);
    expect(marked(unlinked.documents[0])).toBe(false);
  });
  it("a person's ops and rename keep an existing mark", () => {
    const a = applyDocMutation(st(MARKED), OPS, ctx("user"));
    expect(marked(a.documents[0])).toBe(true);
    const b = applyDocMutation(st(MARKED), { kind: "rename", id: 1, title: "Other" }, ctx("user"));
    expect(marked(b.documents[0])).toBe(true);
  });
  it("the before-image of a marked document carries the flag", () => {
    const r = applyDocMutation(st(MARKED), { kind: "rename", id: 1, title: "Other" }, ctx("user"));
    expect(r.versions[0].aiGenerated).toBe(true);
    const plain = applyDocMutation(st(PLAIN), { kind: "rename", id: 1, title: "Other" }, ctx("user"));
    expect("aiGenerated" in plain.versions[0]).toBe(false);
  });
  it("a person's restore of an unmarked old version keeps the current mark", () => {
    const old: DocVersion = { id: 7, documentId: 1, title: "Old", blocks: [], savedAt: "2026-08-02T00:00:00.000Z", source: "user", op: "update" };
    const r = applyDocMutation(st(MARKED, [old]), { kind: "restore", versionId: 7 }, ctx("user"));
    expect(r.changed).toBe(true);
    expect(marked(r.documents[0])).toBe(true);
  });
  it("restoring a marked version onto an unmarked document marks it", () => {
    const old: DocVersion = { id: 7, documentId: 1, title: "Old", blocks: [], savedAt: "2026-08-02T00:00:00.000Z", source: "user", op: "update", aiGenerated: true };
    const r = applyDocMutation(st(PLAIN, [old]), { kind: "restore", versionId: 7 }, ctx("user"));
    expect(marked(r.documents[0])).toBe(true);
  });
  it("removeAiMark by a person unmarks and writes one before-image", () => {
    const r = applyDocMutation(st(MARKED), { kind: "removeAiMark", id: 1 }, ctx("user"));
    expect(r.changed).toBe(true);
    expect("aiGenerated" in r.documents[0]).toBe(false);
    expect(r.versions).toHaveLength(1);
    expect(r.versions[0]).toMatchObject({ op: "update", source: "user", aiGenerated: true });
  });
  it("removeAiMark by the AI is rejected and changes nothing", () => {
    const s = st(MARKED);
    const r = applyDocMutation(s, { kind: "removeAiMark", id: 1 }, ctx("ai"));
    expect(r.changed).toBe(false);
    expect(r.rejected.length).toBeGreaterThan(0);
    expect(r.documents).toBe(s.documents);
  });
  it("removeAiMark on an unmarked document is rejected", () => {
    const r = applyDocMutation(st(PLAIN), { kind: "removeAiMark", id: 1 }, ctx("user"));
    expect(r.changed).toBe(false);
    expect(r.rejected.length).toBeGreaterThan(0);
  });
  it("after removal an AI ops marks the document again", () => {
    const removed = applyDocMutation(st(MARKED), { kind: "removeAiMark", id: 1 }, ctx("user"));
    const again = applyDocMutation({ documents: removed.documents, versions: removed.versions }, OPS, ctx("ai"));
    expect(marked(again.documents[0])).toBe(true);
  });
  it("deleting a marked document then restoring it recreates it marked, with a marked marker row", () => {
    const del = applyDocMutation(st(MARKED), { kind: "delete", id: 1 }, ctx("user"));
    expect(del.versions[0].aiGenerated).toBe(true);
    const r = applyDocMutation({ documents: del.documents, versions: del.versions }, { kind: "restore", versionId: del.versions[0].id }, ctx("user"));
    expect(r.changed).toBe(true);
    expect(marked(r.documents[0])).toBe(true);
    const markerRow = r.versions.find((v) => v.op === "restored");
    expect(markerRow?.aiGenerated).toBe(true);
  });
  it("an AI restore of an unmarked version onto an unmarked document marks it", () => {
    const old: DocVersion = { id: 7, documentId: 1, title: "Old", blocks: [], savedAt: "2026-08-02T00:00:00.000Z", source: "user", op: "update" };
    const r = applyDocMutation(st(PLAIN, [old]), { kind: "restore", versionId: 7 }, ctx("ai"));
    expect(r.changed).toBe(true);
    expect(marked(r.documents[0])).toBe(true);
  });
  it("duplicate and delete before-images of a marked document carry the flag", () => {
    const dup = applyDocMutation(st(MARKED), { kind: "duplicate", id: 1, title: "Copy" }, ctx("user"));
    expect(dup.versions[0]).toMatchObject({ op: "duplicate", aiGenerated: true });
    const del = applyDocMutation(st(MARKED), { kind: "delete", id: 1 }, ctx("user"));
    expect(del.versions[0]).toMatchObject({ op: "delete", aiGenerated: true });
  });
});
