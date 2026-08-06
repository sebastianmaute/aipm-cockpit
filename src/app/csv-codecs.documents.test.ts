// src/app/csv-codecs.documents.test.ts
//
// Documents ride the CSV backend as ONE `config,<json>` row under its own
// `# DOCUMENTS` section — the knowledgeItems ROW SHAPE, but the steering /
// timelog / settings-overrides EMISSION RULE. Three properties matter here:
//
//  (1) STORAGE-ONLY. `workspaceToCsv` serves both the CSV storage backend
//      (called with no config) and the user-facing CSV export (`export.ts`,
//      called with one), so the emit is gated on `config === undefined`.
//      Unlike knowledgeItems there is no `documents` export key to gate on.
//  (2) BYTE-STABILITY. `golden-workspace.test` pins the exact CSV bytes of the
//      sample workspace, so an absent or empty `documents` array must emit
//      NOTHING — not an empty section, not a trailing separator.
//  (3) CELL ESCAPING. The whole JSON blob rides in ONE cell, so a title
//      carrying a comma, a double quote or a newline has to survive the round
//      trip. CSV is CRLF-delimited in this repo (markdown is LF), and the
//      section splitter re-joins its lines with "\r\n".

import { describe, it, expect } from "vitest";
import { workspaceToCsv, csvToWorkspace, documentsToCsv, csvToDocuments } from "./csv-codecs";
import { defaultExportConfig } from "./settings-types";
import { defaultResourcePlan } from "./resource-foundation";
import type { ProjectDocument } from "./document-model";
import type { Workspace } from "./workspace";

const DOC: ProjectDocument = {
  id: 1,
  title: "Deck",
  blocks: [{ type: "heading", level: 1, text: "March" }],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

function emptyWs(): Workspace {
  return {
    tasks: [],
    raid: [],
    absences: [],
    shifts: [],
    resources: [],
    roles: [],
    disciplines: [],
    grades: [],
    plan: defaultResourcePlan("2026-01-01"),
  };
}

function withDocs(docs: readonly ProjectDocument[]): Workspace {
  return { ...emptyWs(), documents: docs };
}

/** Round-trips a single document through the STORAGE path and returns it. */
function roundTrip(doc: ProjectDocument): ProjectDocument | undefined {
  return csvToWorkspace(workspaceToCsv(withDocs([doc]))).documents?.[0];
}

describe("CSV codec — documents", () => {
  it("round-trips a document through the storage path", () => {
    const csv = workspaceToCsv(withDocs([DOC]));
    expect(csv).toContain("# DOCUMENTS");
    expect(csvToWorkspace(csv).documents).toEqual([DOC]);
  });

  // ★★ THE TEST THAT PINS THE STORAGE-ONLY GATE. `workspaceToCsv` serves BOTH
  // the CSV storage backend (no config) and the user-facing CSV export (config
  // supplied), and documents belong only to the former — a raw JSON blob in a
  // spreadsheet is noise, and it leaks document content into a file the user
  // believes holds their task table. Without this test the `config === undefined`
  // gate can be deleted and every other test here stays green.
  it("never emits documents on the export path, even when present", () => {
    const csv = workspaceToCsv(withDocs([DOC]), defaultExportConfig);
    expect(csv).not.toContain("# DOCUMENTS");
    expect(csv).not.toContain("Deck");
    // Byte-identical to the same export with no documents at all.
    expect(csv).toBe(workspaceToCsv(emptyWs(), defaultExportConfig));
    expect(csvToWorkspace(csv).documents).toBeUndefined();
  });

  it("emits no DOCUMENTS section when there are none", () => {
    expect(workspaceToCsv(emptyWs())).not.toContain("# DOCUMENTS");
    expect(workspaceToCsv(emptyWs(), defaultExportConfig)).not.toContain("# DOCUMENTS");
  });

  // ★ The real gate is byte equality, not the absence of the marker: an empty
  // section or a stray separator would still fail golden-workspace.test.
  it("is a byte-level no-op when documents are absent or empty", () => {
    const baseline = workspaceToCsv(emptyWs());
    expect(workspaceToCsv(withDocs([]))).toBe(baseline);
    const exported = workspaceToCsv(emptyWs(), defaultExportConfig);
    expect(workspaceToCsv(withDocs([]), defaultExportConfig)).toBe(exported);
  });

  it("round-trips a title containing a comma and a quote", () => {
    // ★ The JSON blob rides in one CSV cell, so cell escaping is the risk.
    const tricky = { ...DOC, title: 'Q1 "review", final' };
    expect(roundTrip(tricky)?.title).toBe('Q1 "review", final');
  });

  it("round-trips a title containing a newline and a CRLF", () => {
    // ★ The case that breaks naive escaping. It survives because
    // JSON.stringify escapes the break to a literal \n BEFORE the cell is
    // quoted — the blob never actually spans two CSV lines — but assert the
    // OUTCOME, since a future encoder that skips JSON would need the quoting.
    const tricky = { ...DOC, title: "Q1\nreview\r\nfinal" };
    expect(roundTrip(tricky)?.title).toBe("Q1\nreview\r\nfinal");
  });

  it("round-trips block text carrying a comma, a quote and a newline", () => {
    const tricky: ProjectDocument = {
      ...DOC,
      blocks: [
        { type: "heading", level: 2, text: 'Scope, "phase 1"' },
        { type: "paragraph", html: "<p>line one<br>line, two</p>" },
        { type: "bullets", items: ["a,b", 'c"d', "e\nf"] },
        { type: "table", columns: ["A,1"], rows: [['B"2']] },
      ],
    };
    expect(roundTrip(tricky)?.blocks).toEqual(tricky.blocks);
  });

  // ★★★ THE RICH-FIELD PASS. sanitizeProjectDocuments is DOM-FREE BY CONTRACT
  // and therefore CANNOT strip markup — it enforces STRUCTURE only. CSV and
  // Markdown were the only two of the six load paths that never chained
  // sanitizeDocumentRichFields, so paragraph HTML came back unfiltered here
  // while the same document loaded from JSON/IDB/Turso came back clean. Not a
  // live XSS (the render sinks re-sanitize), but a real content divergence: a
  // CSV→JSON migration would WRITE the unfiltered markup into a backend that
  // would have cleaned it, and any future consumer reading `paragraph.html`
  // directly turns it live.
  it("runs the rich-field allow-list on load, not just the structural pass", () => {
    const hostile: ProjectDocument = {
      ...DOC,
      blocks: [{ type: "paragraph", html: "<p>keep me</p><script>x()</script>" }],
    };
    const block = roundTrip(hostile)?.blocks[0];
    expect(block?.type).toBe("paragraph");
    const html = block?.type === "paragraph" ? block.html : "";
    // ★ BOTH halves are required. `not.toMatch(/script/i)` alone is satisfied
    // by html === "", which is exactly what a wrongly-wired sanitizeNoteHtml
    // (KEEP_CONTENT:false) produces — a passing test over deleted prose.
    expect(html).not.toMatch(/script/i);
    expect(html).toContain("keep me");
  });

  it("round-trips through the codec pair with the default neutralize flag", () => {
    // The assembler always passes `neutralize` explicitly, so the default
    // parameter is only reachable from a direct call.
    const line = documentsToCsv([DOC]);
    expect(line.startsWith("config,")).toBe(true);
    expect(csvToDocuments(line)).toEqual([DOC]);
  });

  it("drops a section whose blob is not valid JSON", () => {
    expect(csvToWorkspace("# DOCUMENTS\r\nconfig,not-json").documents).toBeUndefined();
  });

  it("drops a section whose blob sanitizes to nothing", () => {
    // An id-less entry is rejected by sanitizeProjectDocuments, leaving [].
    expect(csvToWorkspace('# DOCUMENTS\r\nconfig,"[{""title"":""x""}]"').documents).toBeUndefined();
    expect(csvToWorkspace("# DOCUMENTS\r\nconfig,[]").documents).toBeUndefined();
  });

  it("drops a section with no config row", () => {
    expect(csvToWorkspace("# DOCUMENTS\r\nfield,value").documents).toBeUndefined();
  });

  it("keeps the DOCUMENTS section out of the other sections", () => {
    // The splitter is a mode machine: a mis-ordered marker check would fold
    // the blob into whichever section precedes it.
    const ws = csvToWorkspace(workspaceToCsv(withDocs([DOC])));
    expect(ws.documents).toEqual([DOC]);
    expect(ws.tasks).toEqual([]);
    expect(ws.knowledgeItems).toBeUndefined();
    expect(ws.insights).toBeUndefined();
  });
});
