// Documents ride the `meta` table as ONE JSON blob (like insights) — they have
// no table of their own, so `TABLE_NAMES` (derived from ENTITY_SPECS) is
// deliberately untouched and its guard test stays green unmodified.
import { describe, it, expect } from "vitest";
import {
  TABLE_NAMES, workspaceToStatements, rowsToWorkspace, dirtyWorkspaceTables,
  type PipelineResultLike,
} from "./turso-schema";
import { tenantWorkspaceToStatements } from "./turso-tenant-schema";
import { emptyWorkspace } from "./workspace";
import type { ProjectDocument } from "./document-model";

const DOC: ProjectDocument = {
  id: 1,
  title: "Steering deck",
  blocks: [
    { type: "heading", level: 1, text: "Status" },
    { type: "paragraph", html: "<p>Safe body</p>" },
    { type: "pageBreak" },
  ],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

/** The stored JSON payload of the `documents` meta row, or undefined if none was
 *  emitted. Works on BOTH backends: the tenant INSERT appends a project_id arg
 *  after the same (key, value) pair, so args[0]/args[1] line up either way. */
function documentsPayload(stmts: { args?: { value?: string }[] }[]): string | undefined {
  return stmts.find((s) => s.args?.[0]?.value === "documents")?.args?.[1]?.value;
}

/** Rebuild SELECT results from the INSERTs a save emitted (round-trip). */
function resultsFromStatements(stmts: { sql: string; args?: { value?: string }[] }[]): PipelineResultLike[] {
  const byTable: Record<string, { cols: string[]; rows: { value: string }[][] }> = {};
  for (const s of stmts) {
    const m = /^INSERT INTO (\w+) \(([^)]+)\) VALUES/.exec(s.sql);
    if (!m) continue;
    const table = m[1];
    const cols = m[2].split(", ").map((c) => c.replace(/"/g, ""));
    (byTable[table] ??= { cols, rows: [] }).rows.push((s.args ?? []).map((a) => ({ value: a.value ?? "" })));
  }
  return TABLE_NAMES.map((t) => ({
    type: "ok",
    response: { type: "execute", result: { cols: (byTable[t]?.cols ?? []).map((name) => ({ name })), rows: byTable[t]?.rows ?? [] } },
  }));
}

/** Hand-built results carrying only the given meta key/value rows. */
function metaOnlyResults(pairs: readonly (readonly [string, string])[]): PipelineResultLike[] {
  return TABLE_NAMES.map((t) => ({
    type: "ok",
    response: {
      type: "execute",
      result: t === "meta"
        ? { cols: [{ name: "key" }, { name: "value" }], rows: pairs.map(([k, v]) => [{ value: k }, { value: v }]) }
        : { cols: [], rows: [] },
    },
  }));
}

describe("turso single-DB — documents save", () => {
  it("writes a documents meta row when documents exist", () => {
    const json = JSON.stringify(workspaceToStatements({ ...emptyWorkspace(), documents: [DOC] }));
    expect(json).toContain('"documents"');
    expect(json).toContain("INSERT INTO meta");
    expect(json).toContain("Steering deck");
  });

  it("writes no documents meta row when the array is empty", () => {
    expect(JSON.stringify(workspaceToStatements({ ...emptyWorkspace(), documents: [] }))).not.toContain('"documents"');
  });

  it("writes no documents meta row when the field is absent", () => {
    expect(JSON.stringify(workspaceToStatements(emptyWorkspace()))).not.toContain('"documents"');
  });

  it("skips the documents row when meta is not dirty", () => {
    const stmts = workspaceToStatements({ ...emptyWorkspace(), documents: [DOC] }, new Set(["tasks"]));
    expect(JSON.stringify(stmts)).not.toContain('"documents"');
  });
});

describe("turso multi-tenant — documents save", () => {
  it("writes a documents meta row when documents exist", () => {
    const json = JSON.stringify(tenantWorkspaceToStatements({ ...emptyWorkspace(), documents: [DOC] }, "p1"));
    expect(json).toContain('"documents"');
    expect(json).toContain("Steering deck");
  });

  it("writes no documents meta row when the array is empty", () => {
    expect(JSON.stringify(tenantWorkspaceToStatements({ ...emptyWorkspace(), documents: [] }, "p1"))).not.toContain('"documents"');
  });

  it("skips the documents row when meta is not dirty", () => {
    const stmts = tenantWorkspaceToStatements({ ...emptyWorkspace(), documents: [DOC] }, "p1", new Set(["tasks"]));
    expect(documentsPayload(stmts)).toBeUndefined();
  });

  it("stores BYTE-IDENTICAL payload to the single-DB backend", () => {
    // ★ Parity is the property that matters here: the load side is SHARED
    // (rowsToWorkspace), so the tenant backend can only be correct if it stores
    // exactly what the single-DB backend stores. Nothing else in the suite
    // compares the two, and golden-workspace pins neither (CSV/MD only).
    const ws = { ...emptyWorkspace(), documents: [DOC] };
    const single = documentsPayload(workspaceToStatements(ws));
    const tenant = documentsPayload(tenantWorkspaceToStatements(ws, "p1"));
    expect(single).toBeDefined();
    expect(tenant).toBe(single);
  });

  it("round-trips the tenant payload through the SHARED load", () => {
    const ws = { ...emptyWorkspace(), documents: [DOC] };
    const payload = documentsPayload(tenantWorkspaceToStatements(ws, "p1"));
    const back = rowsToWorkspace(metaOnlyResults([["documents", payload ?? ""]]));
    expect(back.documents).toEqual([DOC]);
  });
});

describe("turso — documents dirty detection", () => {
  it("marks meta dirty when the documents reference changes", () => {
    // ★ ONE `base`, spread into both: two separate emptyWorkspace() calls give
    // every field a fresh reference, so `meta` goes dirty via status/features
    // and this passes with the documents line DELETED. Measured, not theorised —
    // the first draft of this test was green against the unimplemented code.
    const base = emptyWorkspace();
    const prev = { ...base, documents: [DOC] };
    const next = { ...base, documents: [{ ...DOC, title: "Renamed" }] };
    expect([...dirtyWorkspaceTables(prev, next)]).toContain("meta");
  });

  it("does NOT mark meta dirty when the documents reference is identical", () => {
    // ★ Control: proves the dirty check is reference-based, not a false positive
    // from some other field. Without this the assertion above passes even if
    // `meta` were marked dirty unconditionally — a vacuous pair.
    const docs = [DOC];
    const base = emptyWorkspace();
    const prev = { ...base, documents: docs };
    const next = { ...base, documents: docs };
    expect([...dirtyWorkspaceTables(prev, next)]).not.toContain("meta");
  });

  it("adds no table other than meta for a documents-only change", () => {
    // documents has NO table of its own — it rides `meta`.
    const base = emptyWorkspace();
    const dirty = [...dirtyWorkspaceTables({ ...base, documents: [DOC] }, { ...base, documents: [{ ...DOC, title: "x" }] })];
    expect(dirty).toEqual(["meta"]);
    expect(TABLE_NAMES).not.toContain("documents");
  });
});

describe("turso — documents load", () => {
  it("round-trips documents through save → load", () => {
    const ws = { ...emptyWorkspace(), documents: [DOC] };
    const back = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws)));
    expect(back.documents).toEqual([DOC]);
  });

  it("leaves documents undefined when none were stored", () => {
    expect(rowsToWorkspace(metaOnlyResults([])).documents).toBeUndefined();
  });

  it("leaves documents undefined on a malformed blob instead of throwing", () => {
    let out: ReturnType<typeof rowsToWorkspace> | undefined;
    expect(() => { out = rowsToWorkspace(metaOnlyResults([["documents", "{not json"]])); }).not.toThrow();
    expect(out?.documents).toBeUndefined();
  });

  it("runs the HTML allow-list, not only the structural sanitizer", () => {
    // The structural sanitizer is DOM-free and CANNOT strip markup, so a load
    // that called only sanitizeProjectDocuments would store the script verbatim.
    //
    // ★★ THREE assertions, and the two positive ones are what give the negative
    // one meaning. `not.toContain("<script>")` alone is satisfied by html === "",
    // which is exactly what a destructively-wired sanitizer produces — so it
    // cannot tell a correct wiring from one that ate the user's prose:
    //   · "Safe body" surviving rules out the block being dropped or blanked.
    //   · "Kept heading" surviving rules out KEEP_CONTENT:false (sanitizeNoteHtml
    //     DELETES the text inside a non-allow-listed tag; sanitizeTemplateHtml
    //     UNWRAPS the tag and keeps the words). h3 is on neither allow-list, so
    //     the tag goes either way and only the TEXT distinguishes them.
    const hostile: ProjectDocument = {
      ...DOC,
      blocks: [{
        type: "paragraph",
        html: "<p>Safe body</p><h3>Kept heading</h3><script>alert(1)</script>",
      }],
    };
    const ws = rowsToWorkspace(metaOnlyResults([["documents", JSON.stringify([hostile])]]));
    const block = ws.documents?.[0]?.blocks[0];
    expect(block).toBeDefined();
    expect(block?.type).toBe("paragraph");
    const html = block?.type === "paragraph" ? block.html : "";
    expect(html).toContain("Safe body");
    expect(html).toContain("Kept heading");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
  });
});
