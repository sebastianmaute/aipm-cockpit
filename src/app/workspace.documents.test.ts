import { describe, it, expect, vi, beforeEach } from "vitest";
import { isWorkspaceEmpty, jsonToWorkspace, workspaceToJson, type Workspace } from "./workspace";
import { clearDiagLog, readDiagLog } from "./diagnostics";
import {
  MAX_BLOCKS_PER_DOC,
  MAX_DOCUMENTS,
  type DocTruncationDiag,
  type ProjectDocument,
} from "./document-model";

/** ★★ Forces the documents rich-field pass to throw, for the containment tests
 *  at the bottom of this file. It delegates to the REAL implementation unless
 *  the flag is set, so every other test in this file still exercises the
 *  genuine DOMPurify pass. (A `node` environment is NOT an alternative: there a
 *  missing DOM throws `DomUnavailableError`, which every storage load path
 *  rethrows, so it would test §97 rather than containment — and the
 *  script-stripping tests above need a DOM to mean anything.)
 *
 *  ★ What it simulates is a sanitizer that throws for any reason OTHER than a
 *  missing DOM. This TypeError USED to be the missing-DOM throw (a DOMPurify that
 *  never bound a window), but since §97 `sanitize-html.ts` throws the named
 *  `DomUnavailableError` instead, and every storage load path rethrows that one
 *  rather than containing it (the unload-journal decode is the deliberate
 *  exception: it treats any throw as a corrupt journal and keeps the key) — pinned in `dom-unavailable.load-paths.test.ts`, in the
 *  node environment. See open-followups §97 for why only a PARAGRAPH block
 *  reaches the pass. */
let forceRichFieldThrow = false;
vi.mock("./document-rich-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./document-rich-fields")>();
  return {
    ...actual,
    sanitizeDocumentRichFields: (doc: ProjectDocument) => {
      if (forceRichFieldThrow) throw new TypeError("simulated rich-field sanitizer failure");
      return actual.sanitizeDocumentRichFields(doc);
    },
  };
});

// ★★★ FILE-SCOPED, not describe-scoped. `forceRichFieldThrow` is module state,
// and the containment describe below sets it to `true` inside three test
// bodies. Its own `beforeEach` reset only covers ITS tests, so in source order
// — containment last — nothing else ever sees the flag left on. Under
// `npm run test:shuffle` (the local reproduction of CI's BLOCKING
// unit-tests-shuffled job, which shuffles tests WITHIN a file, not just file
// order) a containment test can run first, and every later `load()` then
// throws `WorkspaceParseError: shape`. Measured: 6 failures in this file at
// the pinned seed while the unshuffled suite was fully green.
// ★ Reset here rather than in an `afterEach` beside each setter: a test that
// throws before its own cleanup would still leak, and this way a new describe
// added later inherits the reset without anyone remembering to.
beforeEach(() => {
  forceRichFieldThrow = false;
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

function load(extra: Record<string, unknown> = {}, diag?: DocTruncationDiag) {
  const ws = jsonToWorkspace(JSON.stringify({ ...EMPTY, ...extra }), { strict: true, diag });
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

  it("reports cap truncation through an optional diag", () => {
    // ★★ open-followups §103: the cap truncated and recorded NOTHING, so the
    // next autosave committed the loss on all six write paths. The count is the
    // RAW TAIL past the cap (an upper bound), not a count of valid documents.
    const documents = Array.from({ length: MAX_DOCUMENTS + 4 }, (_, i) => ({
      ...DOC,
      id: i + 1,
      title: `Doc ${i + 1}`,
      blocks: [],
    }));
    const diag: DocTruncationDiag = {};
    const ws = load({ documents }, diag);
    expect(ws.documents).toHaveLength(MAX_DOCUMENTS);
    expect(diag.truncatedEntries).toBe(4);
  });

  it("leaves the diag untouched when nothing was capped", () => {
    // CONTROL: without this, a threading bug that stamped a constant would
    // satisfy the assertion above.
    const diag: DocTruncationDiag = {};
    load({ documents: [DOC] }, diag);
    expect(diag.truncatedEntries).toBeUndefined();
  });
});

describe("workspace JSON — a throwing documents sanitize is CONTAINED", () => {
  // ★★★ The finding this pins (open-followups §97): the documents rich-field
  // pass is DOM-dependent (as are the task, RAID, change and milestone passes),
  // and it had no local catch. A throw therefore reached jsonToWorkspace's outer catch-all, which
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
    // ★ A local catch that says nothing just moves the silence. This test
    // covers only the diagnostics-ring half of the report; since §620 the SAME
    // throw ALSO reaches `decodeFailedSlices` when a `diag` is passed — see
    // "also records documents in decodeFailedSlices" below. logDiag is a no-op
    // when `window` is undefined. (A script that loads this path with no DOM
    // no longer reaches this containment at all: since §97 the missing DOM
    // throws `DomUnavailableError`, which is rethrown. The sample generator
    // installs JSDOM first — open-followups §151.)
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

  // §620 — a THROW is also a slice this load never got to keep, so it goes to
  // BOTH channels now: the diagnostics ring above (for an operator reading
  // logs) AND `decodeFailedSlices` (for a caller's save guard, which the ring
  // is not reachable from). Pins the `push("documents")` in the catch block
  // beside `logDiag` — deleting it leaves every OTHER test in this describe
  // green, since none of them read `diag`.
  it("also records documents in decodeFailedSlices (non-strict, diag present)", () => {
    forceRichFieldThrow = true;
    const diag: DocTruncationDiag = {};
    jsonToWorkspace(json(), { diag });
    expect(diag.decodeFailedSlices).toEqual(["documents"]);
  });

  it("reports instead of throwing when strict comes WITH a diag (§635)", () => {
    // The local JSON file and SharePoint JSON load with { strict: true, diag }.
    // A caller that passes an accumulator wants the loss REPORTED, so it can
    // pause saving like every other backend does, not a failed load. The
    // strict-without-diag test above keeps the generator's loud failure.
    forceRichFieldThrow = true;
    const diag: DocTruncationDiag = {};
    const ws = jsonToWorkspace(json(), { strict: true, diag });
    expect(diag.decodeFailedSlices).toEqual(["documents"]);
    expect(ws.tasks).toHaveLength(1);
    expect(ws.documents).toBeUndefined();
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

  it("emits NO documentVersions key when absent", () => {
    const ws = load();
    expect(ws.documentVersions).toBeUndefined();
    expect(workspaceToJson(ws)).not.toMatch(/"documentVersions"/);
  });

  // ★★ The test above (and "drops junk" below) route through load(), which
  //    decodes via jsonToWorkspace FIRST — and that path already collapses a
  //    present-but-empty array to `undefined` before workspaceToJson ever
  //    runs. So nothing in this file called workspaceToJson with a genuinely
  //    PRESENT empty array: a mutant that dropped workspaceToJson's OWN
  //    `.length` check (keeping only the truthiness check) still passed every
  //    test here, because it would only misfire on an input this file never
  //    produced. Build the Workspace object directly — bypassing
  //    jsonToWorkspace — to put a real empty array in front of the guard.
  it("workspaceToJson itself omits the key for a directly-constructed empty array", () => {
    const ws: Workspace = { ...load(), documentVersions: [] };
    expect(workspaceToJson(ws)).not.toMatch(/"documentVersions"/);
  });

  it("drops junk rather than failing the whole load", () => {
    const ws = load({ documentVersions: [{ nope: true }] });
    expect(ws.documentVersions).toBeUndefined();
  });

  it("reports per-version block truncation through the SAME diag", () => {
    // ★ The versions call site is threaded separately from documents, and both
    // write into ONE accumulator — a version that loses blocks must be counted
    // even though the DOCUMENT cap was never reached. The `truncatedEntries`
    // assertion is what makes that a distinct channel rather than a second
    // reading of the documents test: the two counters must not cross-contaminate.
    const blocks = Array.from({ length: MAX_BLOCKS_PER_DOC + 3 }, (_, i) => ({
      type: "heading" as const,
      level: 1,
      text: `H${i}`,
    }));
    const diag: DocTruncationDiag = {};
    const ws = load({ documentVersions: [{ ...VERSION, blocks }] }, diag);
    expect(ws.documentVersions?.[0].blocks).toHaveLength(MAX_BLOCKS_PER_DOC);
    expect(diag.truncatedBlocks).toBe(3);
    expect(diag.truncatedEntries).toBeUndefined();
  });
});

// §620 — the documentVersions rich-field pass shares the SAME containment
// shape as documents just above (it runs through the same mocked
// `sanitizeDocumentRichFields`), so a throw there is now recorded through
// BOTH channels too: the diagnostics ring (`workspace.documentVersionsDropped`)
// and `decodeFailedSlices`. Pins the `push("documentVersions")` in workspace.ts
// beside its own `logDiag` call — deleting it leaves every other test in this
// file green.
describe("workspace JSON — a throwing documentVersions sanitize is CONTAINED", () => {
  const versionJson = () => JSON.stringify({ ...EMPTY, documentVersions: [VERSION] });

  beforeEach(() => {
    forceRichFieldThrow = false;
    clearDiagLog();
  });

  it("keeps the rest of the workspace when the sanitize throws (non-strict)", () => {
    forceRichFieldThrow = true;
    const ws = jsonToWorkspace(versionJson());
    expect(ws.tasks).toHaveLength(1);
    expect(ws.documentVersions).toBeUndefined();
  });

  it("records the loss in the diagnostics log instead of swallowing it", () => {
    forceRichFieldThrow = true;
    jsonToWorkspace(versionJson());
    expect(readDiagLog().map((e) => e.code)).toContain("workspace.documentVersionsDropped");
  });

  it("STILL throws in strict mode — the loud failure is not weakened", () => {
    forceRichFieldThrow = true;
    expect(() => jsonToWorkspace(versionJson(), { strict: true })).toThrow();
  });

  it("does not contain anything when the sanitize succeeds", () => {
    const ws = jsonToWorkspace(versionJson());
    expect(ws.tasks).toHaveLength(1);
    expect(ws.documentVersions).toHaveLength(1);
    expect(readDiagLog().map((e) => e.code)).not.toContain("workspace.documentVersionsDropped");
  });

  it("also records documentVersions in decodeFailedSlices (non-strict, diag present)", () => {
    forceRichFieldThrow = true;
    const diag: DocTruncationDiag = {};
    jsonToWorkspace(versionJson(), { diag });
    expect(diag.decodeFailedSlices).toEqual(["documentVersions"]);
  });

  it("reports instead of throwing when strict comes WITH a diag (§635)", () => {
    forceRichFieldThrow = true;
    const diag: DocTruncationDiag = {};
    const ws = jsonToWorkspace(versionJson(), { strict: true, diag });
    expect(diag.decodeFailedSlices).toEqual(["documentVersions"]);
    expect(ws.tasks).toHaveLength(1);
    expect(ws.documentVersions).toBeUndefined();
  });
});
