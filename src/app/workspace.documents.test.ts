import { describe, it, expect, vi, beforeEach } from "vitest";
import { isWorkspaceEmpty, jsonToWorkspace, workspaceToJson } from "./workspace";
import { clearDiagLog, readDiagLog } from "./diagnostics";
import type { ProjectDocument } from "./document-model";

/** ★★ Forces the documents rich-field pass to throw, for the containment tests
 *  at the bottom of this file. It delegates to the REAL implementation unless
 *  the flag is set, so every other test in this file still exercises the
 *  genuine DOMPurify pass — flipping this whole file to the `node` environment
 *  would have been more faithful to the cause but would break the
 *  script-stripping tests above, which need a DOM to mean anything.
 *
 *  ★ The CAUSE being simulated is real and was measured outside vitest: with no
 *  DOM, `sanitizeTemplateHtml` calls a DOMPurify that never bound a window and
 *  throws exactly this TypeError. See open-followups §97 for the measurement
 *  and for why only a PARAGRAPH block reaches it. */
let forceRichFieldThrow = false;
vi.mock("./document-rich-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./document-rich-fields")>();
  return {
    ...actual,
    sanitizeDocumentRichFields: (doc: ProjectDocument) => {
      if (forceRichFieldThrow) throw new TypeError("DOMPurify.sanitize is not a function");
      return actual.sanitizeDocumentRichFields(doc);
    },
  };
});

/** ★★ A SENTINEL task rides in every fixture, and every test asserts it survived.
 *  Without it these tests are vacuous: `jsonToWorkspace` SWALLOWS a bad shape and
 *  returns `emptyWorkspace()`, whose `documents` is undefined — so "drops a
 *  malformed document" would pass just as well if the whole parse had bailed.
 *  `{ strict: true }` turns that silent fallback into a throw, and the sentinel
 *  proves we are looking at the parsed workspace rather than an empty one. */
const SENTINEL = { id: 1, title: "Sentinel" };

const EMPTY = {
  tasks: [SENTINEL],
  raid: [],
  absences: [],
  shifts: [],
  resources: [],
  roles: [],
  disciplines: [],
  grades: [],
  plan: {},
};

const DOC = {
  id: 1,
  title: "Status report",
  blocks: [{ type: "heading", level: 1, text: "March" }],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

function load(extra: Record<string, unknown> = {}) {
  const ws = jsonToWorkspace(JSON.stringify({ ...EMPTY, ...extra }), { strict: true });
  // The control assertion. If this ever fails, every `documents` expectation
  // below is measuring emptyWorkspace() rather than the load path.
  expect(ws.tasks).toHaveLength(1);
  return ws;
}

function paragraphHtml(doc: ProjectDocument | undefined, index = 0): string {
  const block = doc?.blocks[index];
  if (!block || block.type !== "paragraph") {
    throw new Error(`expected a paragraph at ${index}, got ${block?.type ?? "nothing"}`);
  }
  return block.html;
}

describe("workspace JSON — documents", () => {
  it("round-trips a document", () => {
    const ws = load({ documents: [DOC] });
    expect(ws.documents).toEqual([DOC]);

    const json = workspaceToJson(ws);
    expect(json).toMatch(/"documents"/);
    const back = jsonToWorkspace(json, { strict: true });
    expect(back.documents).toEqual([DOC]);
  });

  it("emits NO documents key when absent (byte-stable for legacy files)", () => {
    const ws = load();
    expect(ws.documents).toBeUndefined();
    expect(workspaceToJson(ws)).not.toMatch(/"documents"/);
  });

  it("emits NO documents key for an explicitly EMPTY array", () => {
    // ★ Distinct from the absent case: a file carrying `documents: []` must not
    // start emitting the key, or the first save after opening it changes bytes.
    const ws = load({ documents: [] });
    expect(ws.documents).toBeUndefined();
    expect(workspaceToJson(ws)).not.toMatch(/"documents"/);
  });

  it("drops a malformed document rather than throwing", () => {
    // id 0 and a blank title both fail sanitizeProjectDocuments' structural rules.
    const ws = load({ documents: [{ id: 0, title: "" }] });
    expect(ws.documents).toBeUndefined();
  });

  it("keeps the valid documents when only SOME are malformed", () => {
    // ★ Guards the whole-list-or-nothing failure mode: a single bad row must not
    // take the good ones with it. The test above cannot see that difference.
    const ws = load({ documents: [{ id: 0, title: "" }, DOC] });
    expect(ws.documents).toEqual([DOC]);
  });

  it("strips script from paragraph html on load, KEEPING the surrounding text", () => {
    // ★★ This is the test that proves BOTH sanitizers are wired, in order.
    // sanitizeProjectDocuments is DOM-free and stores this verbatim, so a load
    // path that ran only the structural pass persists the <script>.
    const ws = load({
      documents: [{ ...DOC, blocks: [{ type: "paragraph", html: "<p>a</p><script>x()</script>" }] }],
    });
    const html = paragraphHtml(ws.documents?.[0]);
    expect(html).not.toMatch(/script/i);
    // ★ Without this the assertion above is satisfied by html === "", which is
    // also what a wrongly-wired KEEP_CONTENT:false sanitizer would produce.
    expect(html).toContain("a");
  });

  it("survives the script through a full save/load round trip", () => {
    // Storage is what matters: the stripped value must be what gets WRITTEN, not
    // something re-cleaned on every read.
    const ws = load({
      documents: [{ ...DOC, blocks: [{ type: "paragraph", html: "<p>a</p><script>x()</script>" }] }],
    });
    expect(workspaceToJson(ws)).not.toMatch(/script/i);
  });

  it("does not mutate the loaded documents array when serializing", () => {
    // ★ Every Workspace array is ReadonlyArray because Turso's dirty-table save
    // detects change by REFERENCE EQUALITY — an in-place edit silently skips
    // that table's save. Emit must read, never rewrite.
    const ws = load({ documents: [DOC] });
    const before = ws.documents;
    workspaceToJson(ws);
    expect(ws.documents).toBe(before);
    expect(ws.documents).toEqual([DOC]);
  });
});

describe("workspace JSON — a throwing documents sanitize is CONTAINED", () => {
  // ★★★ The finding this pins (open-followups §97): the documents rich-field
  // pass is the only DOM-dependent step in this decoder, and it had no local
  // catch. A throw therefore reached jsonToWorkspace's outer catch-all, which
  // answers a non-strict load with `emptyWorkspace()` — so a JSON project file
  // came back with ZERO tasks. Not "documents missing": EVERYTHING missing,
  // silently. The other three load paths (CSV, Markdown, Turso) already wrap
  // this call locally and lose only the documents.
  const PARAGRAPH_DOC = {
    ...DOC,
    blocks: [{ type: "paragraph", html: "<p>reaches DOMPurify</p>" }],
  };
  const json = () => JSON.stringify({ ...EMPTY, documents: [PARAGRAPH_DOC] });

  beforeEach(() => {
    forceRichFieldThrow = false;
    clearDiagLog();
  });

  it("keeps the rest of the workspace when the sanitize throws (non-strict)", () => {
    forceRichFieldThrow = true;
    const ws = jsonToWorkspace(json());
    // The whole point. Before the fix this was 0 — the task, and every other
    // register in the file, was discarded because one document could not be
    // sanitized.
    expect(ws.tasks).toHaveLength(1);
    expect(ws.tasks[0].id).toBe(SENTINEL.id);
    // Documents are the only casualty, and the key stays OFF rather than
    // becoming an empty array (matching the malformed-document behaviour above).
    expect(ws.documents).toBeUndefined();
  });

  it("records the loss in the diagnostics log instead of swallowing it", () => {
    // ★ A local catch that says nothing just moves the silence. There is no
    // ImportDiag on this signature, so the app's diagnostics ring is the
    // channel; logDiag is a no-op when `window` is undefined, which keeps the
    // bare-node sample generator working.
    forceRichFieldThrow = true;
    jsonToWorkspace(json());
    const codes = readDiagLog().map((e) => e.code);
    expect(codes).toContain("workspace.documentsDropped");
  });

  it("STILL throws in strict mode — the loud failure is not weakened", () => {
    // ★★ Containment must not turn an existing loud failure quiet. The sample
    // generator decodes with { strict: true } precisely so a bad load fails the
    // build instead of writing a near-empty artifact.
    forceRichFieldThrow = true;
    expect(() => jsonToWorkspace(json(), { strict: true })).toThrow();
  });

  it("does not contain anything when the sanitize succeeds", () => {
    // CONTROL: with the flag off the same fixture must load normally, so the
    // three tests above are measuring the throw and not the fixture.
    const ws = jsonToWorkspace(json());
    expect(ws.tasks).toHaveLength(1);
    expect(ws.documents).toHaveLength(1);
    expect(readDiagLog().map((e) => e.code)).not.toContain("workspace.documentsDropped");
  });
});

// ★★ The LOAD guard refuses an incoming empty workspace only when the CURRENT
//    one is non-empty. Before documents joined isWorkspaceEmpty, a project whose
//    only content was documents read as empty, so the guard did not fire: a
//    transient empty read applied, wiped them, and autosave persisted it.
//    "Only documents" is an ordinary state — drafting a charter before any task
//    exists — which is why this belongs here even though the sibling JSON-blob
//    slices (insights, knowledgeItems, timelogLinks) are deliberately absent.
//
//    ★ These call isWorkspaceEmpty DIRECTLY rather than through jsonToWorkspace:
//      the loader seeds reference data, so no JSON input produces a workspace
//      that is empty by this predicate, and routing through it would measure the
//      loader instead of the guard.
describe("isWorkspaceEmpty — documents", () => {
  const bare = {
    tasks: [], raid: [], absences: [], shifts: [], resources: [],
    roles: [], disciplines: [], grades: [], budgets: [], milestones: [],
    changes: [], stakeholders: [], calendarEvents: [],
  } as unknown as Parameters<typeof isWorkspaceEmpty>[0];

  it("does NOT treat a documents-only workspace as empty", () => {
    expect(isWorkspaceEmpty({ ...bare, documents: [DOC] } as typeof bare)).toBe(false);
  });

  // Control: a predicate that simply returned false would satisfy the assertion
  // above while destroying the guard entirely.
  it("still treats a workspace with no content at all as empty", () => {
    expect(isWorkspaceEmpty(bare)).toBe(true);
  });
});

const VERSION = {
  id: 1,
  documentId: 7,
  title: "Old title",
  blocks: [{ type: "paragraph" as const, html: "<p>before</p>" }],
  savedAt: "2026-08-01T09:00:00.000Z",
  source: "ai" as const,
  op: "update" as const,
};

describe("workspace JSON — documentVersions", () => {
  it("round-trips a version", () => {
    const ws = load({ documentVersions: [VERSION] });
    expect(ws.documentVersions).toEqual([VERSION]);

    const json = workspaceToJson(ws);
    expect(json).toMatch(/"documentVersions"/);
    const back = jsonToWorkspace(json, { strict: true });
    expect(back.documentVersions).toEqual([VERSION]);
  });

  it("emits no key at all when empty", () => {
    const ws = load({ documentVersions: [] });
    expect(ws.documentVersions).toBeUndefined();
    expect(workspaceToJson(ws)).not.toMatch(/"documentVersions"/);
  });

  it("emits NO documentVersions key when absent", () => {
    const ws = load();
    expect(ws.documentVersions).toBeUndefined();
    expect(workspaceToJson(ws)).not.toMatch(/"documentVersions"/);
  });

  it("drops junk rather than failing the whole load", () => {
    const ws = load({ documentVersions: [{ nope: true }] });
    expect(ws.documentVersions).toBeUndefined();
  });
});
