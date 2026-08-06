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
import type { ProjectDocument } from "./document-model";

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
          // Only sanitizeDocumentRichFields (DOMPurify) strips the script.
          { type: "paragraph", html: "<p>Hello</p><script>alert(1)</script>" },
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
        blocks: [{ type: "paragraph", html: "<p>Hello</p>" }],
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      },
    ]);
  });

  it("keeps documents undefined when the stored blob is all junk", async () => {
    await idbSet(KV_DOCUMENTS_KEY, [null, 7, { id: 0, title: "no id" }, "nope"]);

    const back = await new BrowserBackend().load();

    expect(back.documents).toBeUndefined();
  });
});
