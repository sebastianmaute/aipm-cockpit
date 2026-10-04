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

// Post-merge review (§668 / M4) — a slice that PARSES but does not decode is sanitized to nothing, so
// strict alone would apply the journal without it. Any failed slice refuses the whole journal.
describe("journalWorkspace refuses a journal with any slice that does not decode", () => {
  const withSlice = (extra: Record<string, unknown>): UnloadJournal => ({ ...journal, workspace: JSON.stringify({ tasks: [{ id: 7, taskName: "Kept" }], raid: [], ...extra }) });
  it.each([
    ["documents garbled", { documents: "x" }],
    ["documents in a shape a newer build wrote", { documents: [{ foo: 1 }] }],
    ["documentVersions in a foreign shape", { documentVersions: [{ foo: 1 }] }],
    ["the activity log garbled", { activityLog: "x" }],
    ["a meta slice garbled", { steeringCommittee: "x" }],
    ["an entity list whose every row is in a foreign shape", { milestones: [{ foo: 1 }] }],
    ["another entity list emptied the same way", { stakeholders: [{ foo: 1 }, { bar: 2 }] }],
    // These three are re-seeded or rebuilt by the decode's final migration, so they never come back empty.
    ["disciplines in a foreign shape (re-seeded with presets after decoding)", { disciplines: [{ foo: 1 }] }],
    ["grades in a foreign shape (re-seeded with presets after decoding)", { grades: [{ foo: 1 }] }],
    ["resources in a foreign shape (rebuilt from task names after decoding)", { resources: [{ foo: 1 }] }],
  ])("%s", (_label, extra) => {
    expect(journalWorkspace(withSlice(extra))).toBeNull();
  });

  it("still accepts a journal whose slices all decode", () => {
    expect(journalWorkspace(withSlice({}))?.tasks.map((t) => t.id)).toEqual([7]);
  });
});
