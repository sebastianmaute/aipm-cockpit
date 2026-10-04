// open-followups §668 — the journal decode refuses a journal whose document slice fails to sanitize,
// rather than applying it WITHOUT its documents (whose save would write the project without documents
// over the stored ones).
import { afterEach, describe, expect, it, vi } from "vitest";

// Forces the documents rich-field pass to throw (the no-DOM DOMPurify failure), as
// local-file-backend.test.ts does, delegating to the real pass unless the flag is set.
const richThrow = vi.hoisted(() => ({ on: false }));
vi.mock("./document-rich-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./document-rich-fields")>();
  return {
    ...actual,
    sanitizeDocumentRichFields: (doc: Parameters<typeof actual.sanitizeDocumentRichFields>[0]) => {
      if (richThrow.on) throw new TypeError("DOMPurify.sanitize is not a function");
      return actual.sanitizeDocumentRichFields(doc);
    },
  };
});
vi.mock("./diagnostics", () => ({ logDiag: vi.fn() }));

import { journalWorkspace } from "./use-unload-journal";
import type { UnloadJournal } from "./unload-journal";

const journal: UnloadJournal = {
  v: 1, projectKey: "browser", tabId: "t", savedAt: 1, baseFingerprint: "",
  workspace: JSON.stringify({
    tasks: [{ id: 7, taskName: "Kept" }], raid: [],
    documents: [{ id: 1, title: "Status report", blocks: [{ type: "paragraph", html: "<p>reaches DOMPurify</p>" }], createdAt: "2026-08-06T00:00:00.000Z", updatedAt: "2026-08-06T00:00:00.000Z" }],
  }),
};

afterEach(() => { richThrow.on = false; });

describe("journalWorkspace (§668)", () => {
  it("decodes a sound journal with its documents", () => {
    const ws = journalWorkspace(journal);
    expect(ws?.tasks.map((t) => t.id)).toEqual([7]);
    expect(ws?.documents).toHaveLength(1);
  });

  it("refuses the whole journal when its documents fail to sanitize, never returning it without them", () => {
    richThrow.on = true;
    expect(journalWorkspace(journal)).toBeNull();
  });
});
