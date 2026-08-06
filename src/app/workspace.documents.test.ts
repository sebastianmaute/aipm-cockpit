import { describe, it, expect } from "vitest";
import { jsonToWorkspace, workspaceToJson } from "./workspace";
import type { ProjectDocument } from "./document-model";

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
