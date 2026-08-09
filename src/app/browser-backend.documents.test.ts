// The IndexedDB backend's `documents` path. Documents ride the KV store like
// knowledgeItems and insights — no new object store, no DB version bump.
//
// Two properties are load-bearing here and neither is visible from a plain
// round-trip:
//   1. BOTH sanitizers run on load, in order — sanitizeProjectDocuments
//      (structural, DOM-free) THEN sanitizeDocumentRichFields (the DOMPurify
//      allow-list). Only the structural one running is a silent stored-XSS
//      hole, and a clean fixture cannot tell the two apart.
//   2. Empty means ABSENT: the save DELETES the KV key rather than writing an
//      empty array, so a cleared document list cannot resurrect on reload.
//      A load-side assertion alone passes either way (an empty array sanitizes
//      back to undefined), so the key itself is read.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { BrowserBackend } from "./browser-backend";
import { idbGet, idbSet } from "./idb";
import { emptyWorkspace, type Workspace } from "./workspace";
import { MAX_DOCUMENTS, type ProjectDocument } from "./document-model";

// Mirrors the private KV_DOCUMENTS_KEY. Not exported by the backend, and the
// literal IS the storage contract — a rename would be a data-migration event.
const KV_DOCUMENTS_KEY = "documents";

const DOC: ProjectDocument = {
  id: 1,
  title: "Steering deck",
  blocks: [
    { type: "heading", level: 2, text: "Status" },
    { type: "paragraph", html: "<p>On <strong>track</strong>.</p>" },
    { type: "pageBreak" },
  ],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T09:30:00.000Z",
};

function wsWith(documents?: readonly ProjectDocument[]): Workspace {
  const ws = emptyWorkspace();
  return documents ? { ...ws, documents } : ws;
}

describe("BrowserBackend — documents", () => {
  beforeEach(() => {
    // Fresh in-memory IDB per test so saves don't leak across cases. Same
    // reset idiom as browser-backend.test.ts. Without it, "keeps documents
    // undefined when none were saved" would pass against a broken
    // implementation whenever it ran after the round-trip test.
    globalThis.indexedDB = new IDBFactory();
  });

  it("saves and reloads documents", async () => {
    await new BrowserBackend().save(wsWith([DOC]));

    const back = await new BrowserBackend().load();

    expect(back.documents).toEqual([DOC]);
  });

  it("keeps documents undefined when none were saved", async () => {
    const back = await new BrowserBackend().load();

    expect(back.documents).toBeUndefined();
  });

  it("deletes the KV key when the document list is cleared, rather than writing []", async () => {
    const backend = new BrowserBackend();
    await backend.save(wsWith([DOC]));
    expect(await idbGet(KV_DOCUMENTS_KEY)).toBeDefined();

    await backend.save(wsWith([]));

    // Read the key itself: an empty array written here would sanitize back to
    // undefined on load, so the load-side assertion below cannot see it.
    expect(await idbGet(KV_DOCUMENTS_KEY)).toBeUndefined();
    expect((await new BrowserBackend().load()).documents).toBeUndefined();
  });

  it("deletes the KV key when documents is absent entirely", async () => {
    const backend = new BrowserBackend();
    await backend.save(wsWith([DOC]));

    await backend.save(wsWith());

    expect(await idbGet(KV_DOCUMENTS_KEY)).toBeUndefined();
  });

  it("never writes the KV key for a workspace that never had documents", async () => {
    // Distinct from the case above: that one proves a WRITTEN key is removed,
    // this one proves a save on a virgin DB does not create the slot at all.
    await new BrowserBackend().save(wsWith());

    expect(await idbGet(KV_DOCUMENTS_KEY)).toBeUndefined();
  });

  it("runs BOTH sanitizers on load — structural first, then the HTML allow-list", async () => {
    // A hostile/corrupt blob written straight into the KV slot, as an import or
    // a second tab could leave behind. Each defect is caught by exactly ONE of
    // the two sanitizers, so a missing sanitizer fails this test.
    await idbSet(KV_DOCUMENTS_KEY, [
      {
        id: 3,
        title: "Injected",
        blocks: [
          // Only sanitizeProjectDocuments drops an unknown block type.
          { type: "totallyBogus", payload: "keep me" },
          // Only sanitizeDocumentRichFields (DOMPurify) strips the script. The
          // surrounding prose and its markup must SURVIVE — asserting merely
          // that "script" is gone would be satisfied by html === "", which is
          // what a wrongly-wired KEEP_CONTENT:false sanitizer produces.
          {
            type: "paragraph",
            html: "<p>Hello <strong>world</strong></p><script>alert(1)</script>",
          },
        ],
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      },
      // Only sanitizeProjectDocuments drops a titleless document.
      { id: 4, title: "   ", blocks: [] },
    ]);

    const back = await new BrowserBackend().load();

    expect(back.documents).toEqual([
      {
        id: 3,
        title: "Injected",
        blocks: [{ type: "paragraph", html: "<p>Hello <strong>world</strong></p>" }],
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      },
    ]);
  });

  it("publishes cap truncation on lastLoadTruncation", async () => {
    // The over-cap array has to be seeded DIRECTLY: save() caps too, so a
    // round-trip through save() would only ever write MAX_DOCUMENTS and the
    // load could not truncate anything.
    const ISO = "2026-08-06T00:00:00.000Z";
    const docs = Array.from({ length: MAX_DOCUMENTS + 6 }, (_, i) => ({
      id: i + 1,
      title: `Doc ${i + 1}`,
      blocks: [],
      createdAt: ISO,
      updatedAt: ISO,
    }));
    await idbSet(KV_DOCUMENTS_KEY, docs);

    const backend = new BrowserBackend();
    const ws = await backend.load();

    expect(ws.documents).toHaveLength(MAX_DOCUMENTS);
    expect(backend.lastLoadTruncation).toEqual({ entries: 6, blocks: 0 });
  });

  it("republishes zero on a later clean load, rather than leaving the previous count standing", async () => {
    // A stale non-zero count is worse than none: the consumer would raise a
    // data-loss warning about a workspace that lost nothing. Same backend
    // instance, so only a per-load republish can clear it.
    const ISO = "2026-08-06T00:00:00.000Z";
    await idbSet(
      KV_DOCUMENTS_KEY,
      Array.from({ length: MAX_DOCUMENTS + 4 }, (_, i) => ({
        id: i + 1,
        title: `Doc ${i + 1}`,
        blocks: [],
        createdAt: ISO,
        updatedAt: ISO,
      })),
    );
    const backend = new BrowserBackend();
    await backend.load();
    expect(backend.lastLoadTruncation.entries).toBe(4);

    // Fresh store, well inside the cap.
    globalThis.indexedDB = new IDBFactory();
    await idbSet(KV_DOCUMENTS_KEY, [DOC]);
    const back = await backend.load();

    expect(back.documents).toHaveLength(1);
    expect(backend.lastLoadTruncation).toEqual({ entries: 0, blocks: 0 });
  });

  it("keeps documents undefined when the stored blob is all junk", async () => {
    await idbSet(KV_DOCUMENTS_KEY, [null, 7, { id: 0, title: "no id" }, "nope"]);

    const back = await new BrowserBackend().load();

    expect(back.documents).toBeUndefined();
  });
});
