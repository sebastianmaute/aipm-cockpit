// Documents ride the `meta` table as ONE JSON blob (like insights) — they have
// no table of their own, so `TABLE_NAMES` (derived from ENTITY_SPECS) is
// deliberately untouched and its guard test stays green unmodified.
import { describe, it, expect, vi } from "vitest";
import {
  TABLE_NAMES, workspaceToStatements, rowsToWorkspace, dirtyWorkspaceTables,
  type PipelineResultLike,
} from "./turso-schema";
import { tenantWorkspaceToStatements } from "./turso-tenant-schema";
import { emptyWorkspace } from "./workspace";
import * as diagnostics from "./diagnostics";
import {
  MAX_BLOCKS_PER_DOC, MAX_DOCUMENTS,
  type DocTruncationDiag, type ProjectDocument,
} from "./document-model";
import type { DocVersion } from "./document-versions";

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

const VERSION: DocVersion = {
  id: 1,
  documentId: 2,
  title: "Prior deck",
  blocks: [
    { type: "heading", level: 1, text: "Status" },
    { type: "paragraph", html: "<p>Safe body</p>" },
    { type: "pageBreak" },
  ],
  savedAt: "2026-08-03T07:00:00.000Z",
  source: "ai",
  // ★ "restored" ON PURPOSE, not "update". `sanitizeDocumentVersions` falls
  // back to "update" for any op outside its OPS list, so an "update" fixture
  // cannot tell a preserved op from a normalised one — it passes either way.
  // "restored" is also the op that carries the most weight: it is the marker
  // `deletedDocumentVersions` reads to distinguish "still deleted" from
  // "already restored", so a backend that lost it would resurrect a phantom
  // deleted document on that backend alone. Every assertion in this file
  // (save, shared load, tenant-vs-single payload equality) now rides it.
  op: "restored",
};

/** The stored JSON payload of the `documents` meta row, or undefined if none was
 *  emitted. Works on BOTH backends: the tenant INSERT appends a project_id arg
 *  after the same (key, value) pair, so args[0]/args[1] line up either way. */
function documentsPayload(stmts: { args?: { value?: string }[] }[]): string | undefined {
  return stmts.find((s) => s.args?.[0]?.value === "documents")?.args?.[1]?.value;
}

/** Same trick as documentsPayload, for the documentVersions meta row. */
function versionsPayload(stmts: { args?: { value?: string }[] }[]): string | undefined {
  return stmts.find((s) => s.args?.[0]?.value === "documentVersions")?.args?.[1]?.value;
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
    //   · "Kept heading" surviving rules out a destructive KEEP_CONTENT:false
    //     wiring, which would delete the text inside a tag it does not allow.
    //     ★★ h3 USED TO BE on no allow-list, so the tag went either way and only
    //     the TEXT could distinguish a keeping sanitizer from a deleting one.
    //     It joined RICH_ALLOWED_TAGS (and so DOCUMENT_ALLOWED_TAGS, which
    //     spreads it), so the `<h3>` tag itself now SURVIVES here — the fixture
    //     no longer separates the two policies, and it does not need to, because
    //     no sanitizer in the repo deletes text any more. The assertion is on
    //     the WORDS and holds under either.
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

  it("reports cap truncation through an optional diag", () => {
    // ★ The decoder is SHARED by both Turso modes, so this one assertion covers
    // the single-DB and the multi-tenant load alike.
    // ★ Sized off MAX_DOCUMENTS rather than a literal — the cap is a tunable
    // constant, and a hardcoded 200 here would silently stop testing the cap
    // the moment it moves. `blocks: []` keeps 200+ documents cheap through the
    // DOMPurify rich-field pass; the cap counts ENTRIES, not blocks.
    const docs = Array.from({ length: MAX_DOCUMENTS + 2 }, (_, i) => ({
      ...DOC, id: i + 1, title: `Doc ${i + 1}`, blocks: [],
    }));
    const diag: DocTruncationDiag = {};
    const ws = rowsToWorkspace(metaOnlyResults([["documents", JSON.stringify(docs)]]), diag);
    expect(ws.documents).toHaveLength(MAX_DOCUMENTS);
    expect(diag.truncatedEntries).toBe(2);
  });

  it("leaves the diag untouched for an under-cap load", () => {
    // ★ CONTROL. Without it the assertion above passes against a decoder that
    // reports truncation unconditionally — which would raise a data-loss
    // warning about every healthy DB, the exact failure this feature exists to
    // avoid making.
    const diag: DocTruncationDiag = {};
    const ws = rowsToWorkspace(metaOnlyResults([["documents", JSON.stringify([DOC])]]), diag);
    expect(ws.documents).toEqual([DOC]);
    expect(diag.truncatedEntries).toBeUndefined();
  });
});

describe("turso single-DB — documentVersions save", () => {
  it("writes a documentVersions meta row when versions exist", () => {
    const json = JSON.stringify(workspaceToStatements({ ...emptyWorkspace(), documentVersions: [VERSION] }));
    expect(json).toContain('"documentVersions"');
    expect(json).toContain("INSERT INTO meta");
    expect(json).toContain("Prior deck");
  });

  it("writes no documentVersions meta row when the array is empty", () => {
    expect(JSON.stringify(workspaceToStatements({ ...emptyWorkspace(), documentVersions: [] }))).not.toContain('"documentVersions"');
  });

  it("writes no documentVersions meta row when the field is absent", () => {
    expect(JSON.stringify(workspaceToStatements(emptyWorkspace()))).not.toContain('"documentVersions"');
  });

  it("skips the documentVersions row when meta is not dirty", () => {
    const stmts = workspaceToStatements({ ...emptyWorkspace(), documentVersions: [VERSION] }, new Set(["tasks"]));
    expect(JSON.stringify(stmts)).not.toContain('"documentVersions"');
  });
});

describe("turso multi-tenant — documentVersions save", () => {
  it("writes a documentVersions meta row when versions exist", () => {
    const json = JSON.stringify(tenantWorkspaceToStatements({ ...emptyWorkspace(), documentVersions: [VERSION] }, "p1"));
    expect(json).toContain('"documentVersions"');
    expect(json).toContain("Prior deck");
  });

  it("writes no documentVersions meta row when the array is empty", () => {
    expect(JSON.stringify(tenantWorkspaceToStatements({ ...emptyWorkspace(), documentVersions: [] }, "p1"))).not.toContain('"documentVersions"');
  });

  it("skips the documentVersions row when meta is not dirty", () => {
    const stmts = tenantWorkspaceToStatements({ ...emptyWorkspace(), documentVersions: [VERSION] }, "p1", new Set(["tasks"]));
    expect(versionsPayload(stmts)).toBeUndefined();
  });

  it("stores BYTE-IDENTICAL payload to the single-DB backend", () => {
    // ★ Same parity property as documents: the load side is SHARED
    // (rowsToWorkspace), so the tenant backend can only be correct if it
    // stores exactly what the single-DB backend stores.
    const ws = { ...emptyWorkspace(), documentVersions: [VERSION] };
    const single = versionsPayload(workspaceToStatements(ws));
    const tenant = versionsPayload(tenantWorkspaceToStatements(ws, "p1"));
    expect(single).toBeDefined();
    expect(tenant).toBe(single);
  });

  it("round-trips the tenant payload through the SHARED load", () => {
    const ws = { ...emptyWorkspace(), documentVersions: [VERSION] };
    const payload = versionsPayload(tenantWorkspaceToStatements(ws, "p1"));
    const back = rowsToWorkspace(metaOnlyResults([["documentVersions", payload ?? ""]]));
    expect(back.documentVersions).toEqual([VERSION]);
  });
});

describe("turso — documentVersions dirty detection", () => {
  it("marks meta dirty when the documentVersions reference changes", () => {
    // ★ Same trap as the documents suite: two separate emptyWorkspace() calls
    // would pass this even with the documentVersions line deleted, because
    // every other field also goes dirty. ONE base, spread into both.
    const base = emptyWorkspace();
    const prev = { ...base, documentVersions: [VERSION] };
    const next = { ...base, documentVersions: [{ ...VERSION, title: "Renamed" }] };
    expect([...dirtyWorkspaceTables(prev, next)]).toContain("meta");
  });

  it("does NOT mark meta dirty when the documentVersions reference is identical", () => {
    const versions = [VERSION];
    const base = emptyWorkspace();
    const prev = { ...base, documentVersions: versions };
    const next = { ...base, documentVersions: versions };
    expect([...dirtyWorkspaceTables(prev, next)]).not.toContain("meta");
  });

  it("adds no table other than meta for a documentVersions-only change", () => {
    // documentVersions has NO table of its own — it rides `meta`.
    const base = emptyWorkspace();
    const dirty = [...dirtyWorkspaceTables(
      { ...base, documentVersions: [VERSION] },
      { ...base, documentVersions: [{ ...VERSION, title: "x" }] },
    )];
    expect(dirty).toEqual(["meta"]);
    expect(TABLE_NAMES).not.toContain("documentVersions");
    expect(TABLE_NAMES).not.toContain("document_versions");
  });
});

describe("turso — documentVersions load", () => {
  it("round-trips documentVersions through save → load", () => {
    const ws = { ...emptyWorkspace(), documentVersions: [VERSION] };
    const back = rowsToWorkspace(resultsFromStatements(workspaceToStatements(ws)));
    expect(back.documentVersions).toEqual([VERSION]);
  });

  it("leaves documentVersions undefined when none were stored", () => {
    expect(rowsToWorkspace(metaOnlyResults([])).documentVersions).toBeUndefined();
  });

  it("leaves documentVersions undefined on a malformed blob instead of throwing", () => {
    let out: ReturnType<typeof rowsToWorkspace> | undefined;
    expect(() => { out = rowsToWorkspace(metaOnlyResults([["documentVersions", "{not json"]])); }).not.toThrow();
    expect(out?.documentVersions).toBeUndefined();
  });

  it("runs the HTML allow-list on version blocks, not only the structural sanitizer", () => {
    // Same three-assertion shape as the documents equivalent above — the
    // negative assertion alone would be satisfied by an over-eager sanitizer
    // that blanks the whole block, so the two positive ones prove the prose
    // survived and only the hostile markup was stripped.
    const hostile: DocVersion = {
      ...VERSION,
      blocks: [{
        type: "paragraph",
        html: "<p>Safe body</p><h3>Kept heading</h3><script>alert(1)</script>",
      }],
    };
    const ws = rowsToWorkspace(metaOnlyResults([["documentVersions", JSON.stringify([hostile])]]));
    const block = ws.documentVersions?.[0]?.blocks[0];
    expect(block).toBeDefined();
    expect(block?.type).toBe("paragraph");
    const html = block?.type === "paragraph" ? block.html : "";
    expect(html).toContain("Safe body");
    expect(html).toContain("Kept heading");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
  });

  it("reports per-version block truncation through the SAME diag", () => {
    // ★ A SECOND call site. The documents suite above proves the
    // sanitizeProjectDocuments call is threaded; only this one proves the
    // sanitizeDocumentVersions call is — they are separate arguments and a
    // missed one loses blocks in silence on both Turso modes.
    const blocks = Array.from({ length: MAX_BLOCKS_PER_DOC + 7 }, () => ({
      type: "paragraph" as const, html: "<p>x</p>",
    }));
    const diag: DocTruncationDiag = {};
    const ws = rowsToWorkspace(
      metaOnlyResults([["documentVersions", JSON.stringify([{ ...VERSION, blocks }])]]),
      diag,
    );
    expect(ws.documentVersions?.[0]?.blocks).toHaveLength(MAX_BLOCKS_PER_DOC);
    expect(diag.truncatedBlocks).toBe(7);
  });

  it("leaves truncatedBlocks untouched for an under-cap version", () => {
    // ★ CONTROL, same reason as the documents one.
    const diag: DocTruncationDiag = {};
    const ws = rowsToWorkspace(metaOnlyResults([["documentVersions", JSON.stringify([VERSION])]]), diag);
    expect(ws.documentVersions).toEqual([VERSION]);
    expect(diag.truncatedBlocks).toBeUndefined();
  });
});

describe("malformed meta blobs are reported, not swallowed", () => {
  it("logs a diagnostic naming the slice that failed to decode", () => {
    const seen: Array<{ level: string; code: string; fields?: Record<string, unknown> }> = [];
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation((level, code, fields) => {
      seen.push({ level, code, fields });
    });
    try {
      const ws = rowsToWorkspace(metaOnlyResults([["documents", "{not json"]]));
      expect(ws.documents).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
    const hit = seen.find((e) => e.code === "turso.metaSliceUnreadable");
    expect(hit, "a malformed documents blob must emit turso.metaSliceUnreadable").toBeDefined();
    expect(hit?.level).toBe("error");
    expect(hit?.fields?.slice).toBe("documents");
  });

  it("leaves sibling slices intact when one blob is malformed", () => {
    // ★ The sibling has to be a POSITIVE observable, not merely a slice that
    // "didn't throw". `insights` decodes with `if (ins.length) ws.insights =
    // ins;` — an EMPTY array never reaches the assignment, so a `[]` seed
    // (the shape this test used to carry) leaves `ws.insights` undefined
    // regardless of whether the decode ran at all, and the test was green
    // whether the sibling decode worked or was entirely broken. A
    // `knowledge_items` seed that survives `sanitizeKnowledgeItems` non-empty
    // gives the assertion something that can actually fail.
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    try {
      const ws = rowsToWorkspace(
        metaOnlyResults([
          ["documents", "{not json"],
          ["knowledge_items", JSON.stringify([
            { id: "ki-1", name: "Spec doc", url: "https://example.com/doc", kind: "file" },
          ])],
        ]),
      );
      expect(ws.documents).toBeUndefined();
      expect(ws.knowledgeItems).toHaveLength(1);
      expect(ws.knowledgeItems?.[0]?.id).toBe("ki-1");
    } finally {
      spy.mockRestore();
    }
  });
});
